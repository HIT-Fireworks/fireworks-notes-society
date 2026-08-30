const DEFAULT_PROXY_NODES = [
  "https://gh-proxy.com",
  "https://gh.dpik.top",
  "https://github.tbap.top",
];
const PROBE_URL =
  "https://raw.githubusercontent.com/facebook/react/main/LICENSE";

function jsonResponse(value, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function configuredNodes(env) {
  const raw =
    env && typeof env.GH_PROXY_NODES === "string" ? env.GH_PROXY_NODES : "";
  const values = raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const nodes = values.length ? values : DEFAULT_PROXY_NODES;
  return nodes.filter((node) => {
    try {
      const url = new URL(node);
      return (
        url.protocol === "https:" &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
}

function isValidRawUrl(value, owner) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "raw.githubusercontent.com" ||
      url.username ||
      url.password ||
      url.port
    )
      return false;
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    return (
      parts.length >= 4 &&
      parts[0] === owner &&
      parts.every((part) => part !== "." && part !== "..")
    );
  } catch {
    return false;
  }
}

function decodeSourceToken(value) {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function decodeSegment(value) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded &&
      decoded !== "." &&
      decoded !== ".." &&
      !decoded.includes("/")
      ? decoded
      : "";
  } catch {
    return "";
  }
}

function routeInfo(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "gh" || parts.length < 3) return undefined;
  const repoId = decodeSegment(parts[1]);
  const fileParts = parts.slice(2).map(decodeSegment);
  if (!repoId || fileParts.some((part) => !part)) return undefined;
  return { url, repoId, filePath: fileParts.join("/") };
}

function encodePath(value) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function rawMatchesRoute(rawUrl, info, owner) {
  try {
    const parts = decodeURIComponent(new URL(rawUrl).pathname)
      .split("/")
      .filter(Boolean);
    return (
      parts[0] === owner &&
      parts[1] === info.repoId &&
      parts.slice(3).join("/") === info.filePath
    );
  } catch {
    return false;
  }
}

function resolveRawUrl(info, owner) {
  const token = info.url.searchParams.get("source");
  if (token) {
    const source = decodeSourceToken(token);
    return isValidRawUrl(source, owner) && rawMatchesRoute(source, info, owner)
      ? source
      : "";
  }
  const revision = info.url.searchParams.get("ref") || "main";
  if (!/^[A-Za-z0-9._-]+$/.test(revision)) return "";
  const raw = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(info.repoId)}/${encodeURIComponent(revision)}/${encodePath(info.filePath)}`;
  return isValidRawUrl(raw, owner) ? raw : "";
}

async function readCachedNode(cache, key) {
  try {
    const response = await cache.match(key);
    if (!response) return "";
    const value = await response.json();
    return typeof value.node === "string" ? value.node : "";
  } catch {
    return "";
  }
}

async function chooseNode(nodes, request) {
  const region =
    request.eo && request.eo.geo && request.eo.geo.countryName
      ? request.eo.geo.countryName
      : "global";
  const cacheKey = new Request(
    `https://fireworks.invalid/gh-node-choice/${encodeURIComponent(region)}`,
  );
  let cache;
  try {
    cache = await caches.open("fireworks-gh-proxy-choice");
    const cached = await readCachedNode(cache, cacheKey);
    if (cached && nodes.includes(cached)) return cached;
  } catch {
    cache = undefined;
  }
  const measurements = await Promise.all(
    nodes.map(async (node) => {
      const started = Date.now();
      try {
        const response = await fetch(`${node}/${PROBE_URL}`, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
        });
        await response.arrayBuffer();
        return response.ok
          ? { node, elapsed: Date.now() - started }
          : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const available = measurements
    .filter(Boolean)
    .sort((left, right) => left.elapsed - right.elapsed);
  const selected = available[0] && available[0].node;
  if (selected && cache) {
    try {
      await cache.put(
        cacheKey,
        new Response(JSON.stringify({ node: selected }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=600",
          },
        }),
      );
    } catch {
      // 缓存是优化项，不影响直连回退。
    }
  }
  return selected || "";
}

export async function onRequestGet(context) {
  const info = routeInfo(context.request);
  if (!info) return jsonResponse({ error: "invalid_resource_path" }, 400);
  const owner =
    context.env && typeof context.env.GH_ALLOWED_OWNER === "string"
      ? context.env.GH_ALLOWED_OWNER
      : "HIT-Fireworks";
  const rawUrl = resolveRawUrl(info, owner);
  if (!rawUrl) return jsonResponse({ error: "invalid_github_source" }, 400);
  if (info.url.searchParams.get("direct") === "1") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: rawUrl,
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }
  const node = await chooseNode(configuredNodes(context.env), context.request);
  const location = node ? `${node.replace(/\/$/, "")}/${rawUrl}` : rawUrl;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=60, s-maxage=600",
      Vary: "Accept-Encoding",
    },
  });
}

export const __test = {
  configuredNodes,
  decodeSourceToken,
  routeInfo,
  resolveRawUrl,
  isValidRawUrl,
  rawMatchesRoute,
};

const DEFAULT_PROXY_NODES = [
  "https://gh-proxy.com",
  "https://gh.dpik.top",
  "https://github.tbap.top",
  "https://gh.inkchills.cn",
];
const PROBE_URL =
  "https://raw.githubusercontent.com/facebook/react/main/LICENSE";

function response(
  value,
  status = 200,
  cacheControl = "public, max-age=300, s-maxage=600",
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function nodesFromEnv(env) {
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
        !url.username &&
        !url.password &&
        !url.port &&
        /^[A-Za-z0-9.-]+$/.test(url.hostname)
      );
    } catch {
      return false;
    }
  });
}

async function measure(node) {
  const started = Date.now();
  try {
    const result = await fetch(`${node.replace(/\/$/, "")}/${PROBE_URL}`, {
      headers: { Range: "bytes=0-0" },
    });
    await result.arrayBuffer();
    return { node, ok: result.ok, latencyMs: Date.now() - started };
  } catch {
    return { node, ok: false, latencyMs: null };
  }
}

export async function onRequestGet(context) {
  let cache;
  const cacheKey = new Request("https://fireworks.invalid/gh-proxy-nodes");
  try {
    cache = await caches.open("fireworks-gh-proxy-nodes");
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    cache = undefined;
  }
  const results = await Promise.all(nodesFromEnv(context.env).map(measure));
  results.sort((left, right) => {
    if (left.ok !== right.ok) return Number(right.ok) - Number(left.ok);
    return (
      (left.latencyMs ?? Number.MAX_SAFE_INTEGER) -
      (right.latencyMs ?? Number.MAX_SAFE_INTEGER)
    );
  });
  const payload = response({
    nodes: results,
    selected: results.find((item) => item.ok)?.node || null,
  });
  if (cache) {
    try {
      await cache.put(cacheKey, payload.clone());
    } catch {
      // 缓存是优化项。
    }
  }
  return payload;
}

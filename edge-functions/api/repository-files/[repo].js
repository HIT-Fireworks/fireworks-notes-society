const DEFAULT_OWNER = "HIT-Fireworks";

function jsonResponse(
  value,
  status = 200,
  cacheControl = "public, max-age=300, s-maxage=600",
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function validRepository(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

function encodedPath(value) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function fileUrl(owner, repository, filePath, branch) {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodedPath(branch)}/${encodedPath(filePath)}`;
}

async function readCache(cache, key) {
  if (!cache) return undefined;
  try {
    return await cache.match(key);
  } catch {
    return undefined;
  }
}

export async function onRequestGet(context) {
  const repository = context.params && context.params.repo;
  if (!validRepository(repository)) {
    return jsonResponse({ error: "invalid_repository" }, 400, "no-store");
  }
  const owner =
    context.env && typeof context.env.GH_ALLOWED_OWNER === "string"
      ? context.env.GH_ALLOWED_OWNER
      : DEFAULT_OWNER;
  const cacheKey = new Request(
    `https://fireworks.invalid/repository-files/${owner}/${repository}`,
  );
  let cache;
  try {
    cache = await caches.open("fireworks-repository-files");
    const cached = await readCache(cache, cacheKey);
    if (cached) return cached;
  } catch {
    cache = undefined;
  }
  const apiHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "HIT-Fireworks-course-site",
  };
  if (
    context.env &&
    typeof context.env.GITHUB_TOKEN === "string" &&
    context.env.GITHUB_TOKEN
  ) {
    apiHeaders.Authorization = `Bearer ${context.env.GITHUB_TOKEN}`;
  }
  let metadataResponse;
  try {
    metadataResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
      { headers: apiHeaders },
    );
  } catch {
    return jsonResponse({ error: "github_unavailable" }, 502, "no-store");
  }
  if (!metadataResponse.ok) {
    return jsonResponse(
      {
        error: "github_repository_unavailable",
        status: metadataResponse.status,
      },
      metadataResponse.status === 404 ? 404 : 502,
      "no-store",
    );
  }
  const metadata = await metadataResponse.json();
  const branch =
    typeof metadata.default_branch === "string" && metadata.default_branch
      ? metadata.default_branch
      : "main";
  let treeResponse;
  try {
    treeResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodedPath(branch)}?recursive=1`,
      { headers: apiHeaders },
    );
  } catch {
    return jsonResponse({ error: "github_unavailable" }, 502, "no-store");
  }
  if (!treeResponse.ok) {
    return jsonResponse(
      { error: "github_tree_unavailable", status: treeResponse.status },
      502,
      "no-store",
    );
  }
  const payload = await treeResponse.json();
  const files = Array.isArray(payload.tree)
    ? payload.tree
        .filter(
          (item) =>
            item && item.type === "blob" && typeof item.path === "string",
        )
        .slice(0, 5000)
        .map((item) => ({
          path: item.path,
          name: item.path.split("/").pop() || item.path,
          size: typeof item.size === "number" ? item.size : 0,
          htmlUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/blob/${encodedPath(branch)}/${encodedPath(item.path)}`,
          downloadUrl: fileUrl(owner, repository, item.path, branch),
        }))
    : [];
  const result = jsonResponse({
    owner,
    repo: repository,
    branch,
    truncated: payload.truncated === true,
    files,
  });
  if (cache) {
    try {
      await cache.put(cacheKey, result.clone());
    } catch {
      // 缓存是优化项。
    }
  }
  return result;
}

export const __test = { validRepository, encodedPath };

const DEFAULT_OPENLIST_HOST = "https://olist-eo.jwyihao.top";
const STATIC_PATH_RE = /(?:^|\s)path\s*=\s*(["'])(.*?)\1/s;
const STATIC_HOST_RE = /(?:^|\s)host\s*=\s*(["'])(.*?)\1/s;
const DYNAMIC_PATH_RE = /(?:^|\s)(?::path|v-bind:path)\s*=/s;
const COMPONENT_RE = /<(OList|OListItem)\b([^>]*)\/?>/gs;

export function normalizeOpenListPath(input = "/") {
  const raw = String(input).trim().replace(/\\/g, "/");
  const collapsed = raw.replace(/\/+/g, "/");
  const withoutLeading = collapsed.replace(/^\/+/g, "");
  const withoutTrailing = withoutLeading.replace(/\/+$/g, "");
  return withoutTrailing ? `/${withoutTrailing}` : "/";
}

export function stripMarkdownCode(markdown) {
  return String(markdown)
    .replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "")
    .replace(/^~~~[^\n]*\n[\s\S]*?^~~~\s*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "");
}

export function extractOListUses(markdown, file) {
  const uses = [];
  const clean = stripMarkdownCode(markdown);

  for (const match of clean.matchAll(COMPONENT_RE)) {
    const component = match[1];
    const attrs = match[2] ?? "";
    const hostMatch = attrs.match(STATIC_HOST_RE);
    const pathMatch = attrs.match(STATIC_PATH_RE);
    const host = hostMatch ? hostMatch[2] : null;

    if (DYNAMIC_PATH_RE.test(attrs)) {
      uses.push({
        component,
        file,
        host,
        path: null,
        unsupported: "dynamic-path",
      });
      continue;
    }

    uses.push({
      component,
      file,
      host,
      path: normalizeOpenListPath(pathMatch ? pathMatch[2] : "/"),
      unsupported:
        host && host !== DEFAULT_OPENLIST_HOST ? "custom-host" : null,
    });
  }

  return uses;
}

export function isAuditedMarkdownPath(relativePath) {
  const normalized = String(relativePath).replace(/\\/g, "/");
  if (!normalized.endsWith(".md")) return false;
  if (normalized === "README.md") return false;
  if (normalized === "CONTRIBUTING.md") return false;
  if (normalized === "team.md") return false;
  if (normalized.startsWith("docs/")) return false;
  if (normalized.startsWith("parts/")) return false;
  return true;
}

export function classifyOpenListFailure(errorOrPayload) {
  if (
    errorOrPayload &&
    typeof errorOrPayload === "object" &&
    "message" in errorOrPayload &&
    /object not found/i.test(String(errorOrPayload.message))
  ) {
    return "path-not-found";
  }

  return "remote-failure";
}

export function markdownRoutePath(relativePath) {
  const normalized = String(relativePath).replace(/\\/g, "/");
  if (normalized === "index.md") return "/";
  if (normalized.endsWith("/index.md")) {
    return `/${normalized.slice(0, -"/index.md".length)}`;
  }
  if (normalized.endsWith(".md")) {
    return `/${normalized.slice(0, -".md".length)}`;
  }
  return `/${normalized}`;
}

export function buildAuditResult({
  remoteDirs,
  localUses,
  localMarkdownFiles = [],
  warningExemptions = [],
  orphanPageAllowances = [],
}) {
  const remoteSet = new Set(remoteDirs.map(normalizeOpenListPath));
  const warningExemptionMap = new Map(
    warningExemptions.map((item) => [
      normalizeOpenListPath(item.path),
      item.reason,
    ]),
  );
  const orphanAllowanceMap = new Map(
    orphanPageAllowances.map((item) => [
      String(item.file).replace(/\\/g, "/"),
      item.reason,
    ]),
  );
  const covered = new Set();
  const errors = [];
  const warnings = [];
  const info = [];

  for (const use of localUses) {
    if (use.unsupported) {
      warnings.push({ type: "unsupported-component", use });
      continue;
    }

    if (!use.path) continue;
    const localPath = normalizeOpenListPath(use.path);
    if (localPath === "/") continue;

    covered.add(localPath);
    if (!remoteSet.has(localPath)) {
      errors.push({ type: "missing-remote-path", use });
    }
  }

  for (const remotePath of remoteSet) {
    if (remotePath === "/" || covered.has(remotePath)) continue;

    if (warningExemptionMap.has(remotePath)) {
      info.push({
        type: "warning-exemption",
        path: remotePath,
        reason: warningExemptionMap.get(remotePath),
      });
      continue;
    }

    warnings.push({
      type: "remote-without-markdown-entry",
      path: remotePath,
    });
  }

  for (const file of localMarkdownFiles.map((item) =>
    String(item).replace(/\\/g, "/"),
  )) {
    if (orphanAllowanceMap.has(file)) {
      info.push({
        type: "orphan-page-allowance",
        file,
        reason: orphanAllowanceMap.get(file),
      });
    }
  }

  return { errors, warnings, info };
}

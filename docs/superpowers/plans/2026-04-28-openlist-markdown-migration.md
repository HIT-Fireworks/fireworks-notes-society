# OpenList 与 Markdown 课程树迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 OpenList 只读审计、防止失效 `<OList path>` 继续进入站点，并手动迁移 Markdown 课程树到当前 OpenList 目录结构。

**Architecture:** 手写 Markdown 继续作为站点路由和 sidebar 的权威源；OpenList 审计脚本只读远端目录和本地 Markdown，输出 error/warning/info，不自动修改课程页面。普通 VitePress 构建移除 OpenList 构建期硬依赖，运行时 `<OList>` 失败时在资料区显示错误状态。

**Tech Stack:** Bun 1.3.12、VitePress 1.6、Vue 3、PrimeVue、Node/Bun ESM 脚本、GitHub Actions。

**Implementation Worktree:** `C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\openlist-markdown-migration`，分支 `openlist-markdown-migration`。该 worktree 已执行 `bun ci`，并已用 `bun run docs:build` 验证基线构建通过。

**Spec:** `C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\specs\2026-04-28-openlist-markdown-migration-design.md`

**Repository Rule:** 不创建 commit，除非用户明确要求。每个任务末尾使用 `rtk git status --short --untracked-files=all` 和 `rtk git diff --stat` 做检查点。

---

## File Structure

Create `scripts/openlist-audit.config.mjs` for connection defaults, scan exclusions, warning exceptions, and orphan allowances. This file is configuration only and must not contain secrets.

Create `scripts/openlist-audit-lib.mjs` for pure, unit-testable audit helpers: path normalization, Markdown code stripping, component extraction, scan filtering, API error classification, and diff construction.

Create `scripts/openlist-audit-lib.test.mjs` using Node built-in `node:test` and `node:assert/strict`. This avoids adding a test framework.

Create `scripts/audit-openlist-structure.mjs` as the CLI entrypoint. It parses args, optionally runs `--self-test`, fetches OpenList with bounded recursion, scans Markdown, prints reports, optionally writes a report file, and exits with the documented codes.

Modify `.vitepress/theme/components/alist.data.mts` so ordinary VitePress build does not require OpenList to respond successfully.

Modify `.vitepress/theme/components/OListItem.vue` to add initial-load and lazy-load error states without changing download source or campus verification behavior.

Modify `package.json` to add `audit:openlist` and `audit:openlist:self-test` scripts.

Create `.github/workflows/openlist-audit.yml` as an independent workflow. Enable report-only mode first; the normal audit error gate is enabled after the manual Markdown migration removes known errors.

Create or modify Markdown pages under `数学学院/` to mirror `专业基础课` and `细分专业课` manually.

Create missing top-level classification pages and observed course pages under public-course, traffic, telecom, mechanical, physics, and instrument directories.

Modify `README.md` and `CONTRIBUTING.md` to document Markdown authority, OpenList reference role, and the audit workflow.

---

### Task 1: Audit Helper Tests And Pure Functions

**Files:**

- Create: `scripts/openlist-audit-lib.test.mjs`
- Create: `scripts/openlist-audit-lib.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `scripts/openlist-audit-lib.test.mjs` with this content:

````js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditResult,
  classifyOpenListFailure,
  extractOListUses,
  isAuditedMarkdownPath,
  normalizeOpenListPath,
  stripMarkdownCode,
} from "./openlist-audit-lib.mjs";

describe("normalizeOpenListPath", () => {
  it("normalizes empty and slash-only paths to root", () => {
    assert.equal(normalizeOpenListPath(""), "/");
    assert.equal(normalizeOpenListPath("///"), "/");
  });

  it("adds one leading slash and collapses repeated slashes", () => {
    assert.equal(
      normalizeOpenListPath("数学学院//专业基础课/数学分析"),
      "/数学学院/专业基础课/数学分析",
    );
    assert.equal(
      normalizeOpenListPath("//【公共课】/大学物理"),
      "/【公共课】/大学物理",
    );
  });
});

describe("stripMarkdownCode", () => {
  it("removes fenced code blocks and inline code", () => {
    const markdown = [
      "# 页面",
      "```md",
      '<OList path="/代码块" />',
      "```",
      '正文 `inline <OList path="/行内" />`',
      '<OList path="/真实路径" />',
    ].join("\n");

    assert.equal(stripMarkdownCode(markdown).includes("/代码块"), false);
    assert.equal(stripMarkdownCode(markdown).includes("/行内"), false);
    assert.equal(stripMarkdownCode(markdown).includes("/真实路径"), true);
  });
});

describe("extractOListUses", () => {
  it("extracts static OList and OListItem paths", () => {
    const markdown = [
      '<OList path="/数学学院/专业基础课/数学分析" />',
      "<OListItem path='/仪器学院/工程光学' />",
    ].join("\n");

    assert.deepEqual(extractOListUses(markdown, "数学学院/数学分析/index.md"), [
      {
        component: "OList",
        file: "数学学院/数学分析/index.md",
        host: null,
        path: "/数学学院/专业基础课/数学分析",
        unsupported: null,
      },
      {
        component: "OListItem",
        file: "数学学院/数学分析/index.md",
        host: null,
        path: "/仪器学院/工程光学",
        unsupported: null,
      },
    ]);
  });

  it("treats bare components as root without covering a course path", () => {
    assert.deepEqual(extractOListUses("<OList />", "lessons/index.md"), [
      {
        component: "OList",
        file: "lessons/index.md",
        host: null,
        path: "/",
        unsupported: null,
      },
    ]);
  });

  it("reports dynamic path and non-default host as unsupported", () => {
    const markdown =
      '<OList :path="coursePath" host="https://example.invalid" />';
    assert.deepEqual(extractOListUses(markdown, "x.md"), [
      {
        component: "OList",
        file: "x.md",
        host: "https://example.invalid",
        path: null,
        unsupported: "dynamic-path",
      },
    ]);
  });
});

describe("isAuditedMarkdownPath", () => {
  it("mirrors VitePress course-page boundaries", () => {
    assert.equal(isAuditedMarkdownPath("数学学院/index.md"), true);
    assert.equal(isAuditedMarkdownPath("docs/superpowers/specs/x.md"), false);
    assert.equal(isAuditedMarkdownPath("parts/wip.md"), false);
    assert.equal(isAuditedMarkdownPath("README.md"), false);
    assert.equal(isAuditedMarkdownPath("CONTRIBUTING.md"), false);
    assert.equal(isAuditedMarkdownPath("team.md"), false);
  });
});

describe("classifyOpenListFailure", () => {
  it("classifies object-not-found responses as path errors", () => {
    assert.equal(
      classifyOpenListFailure({
        code: 500,
        message: "failed get objs: failed get dir: object not found",
      }),
      "path-not-found",
    );
  });

  it("classifies other failures as remote failures", () => {
    assert.equal(
      classifyOpenListFailure({ code: 500, message: "upstream timeout" }),
      "remote-failure",
    );
    assert.equal(
      classifyOpenListFailure(new SyntaxError("bad json")),
      "remote-failure",
    );
  });
});

describe("buildAuditResult", () => {
  it("keeps invalid OList paths as errors and applies configured info entries", () => {
    const result = buildAuditResult({
      remoteDirs: ["/", "/询问中", "/数学学院/专业基础课/数学分析"],
      localUses: [
        {
          component: "OList",
          file: "数学学院/数学分析/index.md",
          host: null,
          path: "/数学学院/专业基础课/数学分析",
          unsupported: null,
        },
        {
          component: "OList",
          file: "数学学院/坏路径/index.md",
          host: null,
          path: "/数学学院/坏路径",
          unsupported: null,
        },
      ],
      localMarkdownFiles: ["数学学院/集合论图论/index.md"],
      warningExemptions: [{ path: "/询问中", reason: "临时待确认目录" }],
      orphanPageAllowances: [
        { file: "数学学院/集合论图论/index.md", reason: "等待维护者确认" },
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].use.path, "/数学学院/坏路径");
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(
      result.info.map((item) => item.type),
      ["warning-exemption", "orphan-page-allowance"],
    );
  });
});
````

- [ ] **Step 2: Run helper tests and verify RED**

Run: `node --test scripts/openlist-audit-lib.test.mjs`

Expected: FAIL with an import error because `scripts/openlist-audit-lib.mjs` does not exist.

- [ ] **Step 3: Implement pure helpers**

Create `scripts/openlist-audit-lib.mjs` with this content:

````js
const STATIC_PATH_RE = /\bpath\s*=\s*(["'])(.*?)\1/s;
const STATIC_HOST_RE = /\bhost\s*=\s*(["'])(.*?)\1/s;
const DYNAMIC_PATH_RE = /(?:^|\s)(?::path|v-bind:path)\s*=/s;
const COMPONENT_RE = /<(OList|OListItem)\b([^>]*)\/?>/gs;

export function normalizeOpenListPath(input = "/") {
  const raw = String(input).trim().replace(/\\/g, "/");
  const collapsed = raw.replace(/\/+/g, "/");
  const withoutLeading = collapsed.replace(/^\/+/, "");
  const withoutTrailing = withoutLeading.replace(/\/+$/, "");
  return withoutTrailing ? `/${withoutTrailing}` : "/";
}

export function stripMarkdownCode(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`]*`/g, "");
}

export function extractOListUses(markdown, file) {
  const clean = stripMarkdownCode(markdown);
  const uses = [];
  for (const match of clean.matchAll(COMPONENT_RE)) {
    const component = match[1];
    const attrs = match[2] ?? "";
    const hostMatch = attrs.match(STATIC_HOST_RE);
    const host = hostMatch ? hostMatch[2] : null;
    const pathMatch = attrs.match(STATIC_PATH_RE);

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
      unsupported: host ? "custom-host" : null,
    });
  }
  return uses;
}

export function isAuditedMarkdownPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
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
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.endsWith("/index.md")) {
    return `/${normalized.slice(0, -"/index.md".length)}`;
  }
  return `/${normalized.slice(0, -".md".length)}`;
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
      item.file.replace(/\\/g, "/"),
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
    if (use.path === "/") continue;
    covered.add(use.path);
    if (!remoteSet.has(use.path)) {
      errors.push({ type: "missing-remote-path", use });
    }
  }

  for (const remotePath of remoteSet) {
    if (remotePath !== "/" && !covered.has(remotePath)) {
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
  }

  for (const file of localMarkdownFiles.map((item) =>
    item.replace(/\\/g, "/"),
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
````

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `node --test scripts/openlist-audit-lib.test.mjs`

Expected: PASS with all helper tests passing.

- [ ] **Step 5: Checkpoint**

Run: `rtk git status --short --untracked-files=all`

Expected: `scripts/openlist-audit-lib.mjs` and `scripts/openlist-audit-lib.test.mjs` appear as new files.

---

### Task 2: Audit CLI, Config, And Self-Test

**Files:**

- Create: `scripts/openlist-audit.config.mjs`
- Create: `scripts/audit-openlist-structure.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write config file**

Create `scripts/openlist-audit.config.mjs`:

```js
export default {
  host: "https://olist-eo.jwyihao.top",
  base: "Fireworks",
  password: "",
  depth: 4,
  requestTimeoutMs: 10_000,
  concurrency: 1,
  retries: 2,
  maxDirectories: 600,
  warningExemptions: [
    {
      path: "/询问中",
      reason: "临时待确认目录，不默认按普通课程页迁移",
    },
  ],
  orphanPageAllowances: [
    {
      file: "数学学院/集合论图论/index.md",
      reason: "远端暂未找到对应目录，等待维护者确认删除、归档或重新映射",
    },
  ],
};
```

- [ ] **Step 2: Write failing CLI self-test expectation**

Run: `bun scripts/audit-openlist-structure.mjs --self-test`

Expected: FAIL with `Cannot find module` because the CLI file does not exist.

- [ ] **Step 3: Implement CLI**

Create `scripts/audit-openlist-structure.mjs`:

```js
#!/usr/bin/env bun
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "./openlist-audit.config.mjs";
import {
  buildAuditResult,
  classifyOpenListFailure,
  extractOListUses,
  isAuditedMarkdownPath,
  normalizeOpenListPath,
} from "./openlist-audit-lib.mjs";

const EXIT_OK = 0;
const EXIT_AUDIT_ERROR = 1;
const EXIT_REMOTE_FAILURE = 2;
const EXIT_CONFIG_ERROR = 3;

function parseArgs(argv) {
  const args = {
    host: process.env.OPENLIST_AUDIT_HOST || config.host,
    base: process.env.OPENLIST_AUDIT_BASE || config.base,
    password: process.env.OPENLIST_AUDIT_PASSWORD || config.password,
    depth: config.depth,
    report: null,
    reportOnly: false,
    selfTest: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--report-only") args.reportOnly = true;
    else if (arg === "--depth") args.depth = Number(argv[++i]);
    else if (arg === "--host") args.host = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--password") args.password = argv[++i];
    else if (arg === "--report") args.report = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.depth) || args.depth < 0) {
    throw new Error(`Invalid --depth: ${args.depth}`);
  }
  return args;
}

async function selfTest() {
  const { spawn } = await import("node:child_process");
  const testFile = fileURLToPath(
    new URL("./openlist-audit-lib.test.mjs", import.meta.url),
  );
  await new Promise((resolve, reject) => {
    const child = spawn("node", ["--test", testFile], {
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Self-test failed with ${code}`)),
    );
  });
}

async function fetchOpenList(path, options) {
  let lastError;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(`${options.host}/api/fs/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "" },
        body: JSON.stringify({
          path: `/${options.base}${normalizeOpenListPath(path)}`,
          password: options.password,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (payload.code !== 200) {
        const kind = classifyOpenListFailure(payload);
        const error = new Error(
          `OpenList ${kind} for ${path}: ${JSON.stringify(payload)}`,
        );
        error.kind = kind;
        throw error;
      }
      return payload.data?.content ?? [];
    } catch (error) {
      lastError = error;
      if (error.kind === "path-not-found" || attempt === config.retries)
        throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchRemoteDirs(options) {
  if (config.concurrency !== 1) {
    throw new Error(
      "Audit v1 uses a sequential queue; keep config.concurrency at 1",
    );
  }
  const root = "/";
  const dirs = new Set([root]);
  const queue = [{ path: root, depth: 0 }];

  while (queue.length > 0) {
    if (dirs.size > config.maxDirectories) {
      throw new Error(
        `OpenList audit stopped after ${config.maxDirectories} directories`,
      );
    }
    const current = queue.shift();
    const items = await fetchOpenList(current.path, options);
    if (current.depth >= options.depth) continue;
    for (const item of items) {
      if (!item.is_dir) continue;
      const childPath = normalizeOpenListPath(`${current.path}/${item.name}`);
      if (!dirs.has(childPath)) {
        dirs.add(childPath);
        queue.push({ path: childPath, depth: current.depth + 1 });
      }
    }
  }

  return Array.from(dirs).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function listMarkdownFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".vitepress" ||
        entry.name === ".worktrees" ||
        entry.name === "dist"
      )
        continue;
      const absolute = join(dir, entry.name);
      const rel = relative(rootDir, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (isAuditedMarkdownPath(rel)) {
        results.push({ absolute, relative: rel });
      }
    }
  }
  await walk(rootDir);
  return results;
}

async function scanLocalUses(rootDir) {
  const files = await listMarkdownFiles(rootDir);
  const uses = [];
  for (const file of files) {
    const markdown = await readFile(file.absolute, "utf8");
    uses.push(...extractOListUses(markdown, file.relative));
  }
  return uses;
}

async function validateMissingLocalPaths(remoteDirs, localUses, args) {
  const remoteSet = new Set(remoteDirs);
  for (const use of localUses) {
    if (
      use.unsupported ||
      !use.path ||
      use.path === "/" ||
      remoteSet.has(use.path)
    )
      continue;
    const items = await fetchOpenList(use.path, args).catch((error) => {
      if (error.kind === "path-not-found") return null;
      throw error;
    });
    if (items !== null) remoteSet.add(use.path);
  }
  return Array.from(remoteSet).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function formatReport(result) {
  const lines = [];
  lines.push("# OpenList Audit Report");
  lines.push("");
  lines.push(`Errors: ${result.errors.length}`);
  lines.push(`Warnings: ${result.warnings.length}`);
  lines.push(`Info: ${result.info.length}`);
  lines.push("");
  for (const error of result.errors) {
    lines.push(`ERROR ${error.type}: ${error.use.file} -> ${error.use.path}`);
  }
  for (const warning of result.warnings) {
    if (warning.use) lines.push(`WARNING ${warning.type}: ${warning.use.file}`);
    else lines.push(`WARNING ${warning.type}: ${warning.path}`);
  }
  for (const item of result.info) {
    lines.push(
      `INFO ${item.type}: ${item.path ?? item.file} - ${item.reason ?? ""}`.trim(),
    );
  }
  return lines.join("\n");
}

function assertReportPath(rootDir, report) {
  if (!report) return;
  const reportsDir = resolve(rootDir, "docs/superpowers/reports");
  const target = resolve(rootDir, report);
  const relativeReportPath = relative(reportsDir, target);
  if (
    relativeReportPath === "" ||
    relativeReportPath.startsWith("..") ||
    isAbsolute(relativeReportPath)
  ) {
    throw new Error(
      `Report path must be under docs/superpowers/reports/: ${report}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    await selfTest();
    return EXIT_OK;
  }

  const rootDir = process.cwd();
  assertReportPath(rootDir, args.report);
  const remoteDirs = await fetchRemoteDirs(args);
  const localFiles = await listMarkdownFiles(rootDir);
  const localUses = await scanLocalUses(rootDir);
  const verifiedRemoteDirs = await validateMissingLocalPaths(
    remoteDirs,
    localUses,
    args,
  );
  const result = buildAuditResult({
    remoteDirs: verifiedRemoteDirs,
    localUses,
    localMarkdownFiles: localFiles.map((file) => file.relative),
    warningExemptions: config.warningExemptions,
    orphanPageAllowances: config.orphanPageAllowances,
  });
  const report = formatReport(result);
  console.log(report);
  if (args.report) {
    await mkdir(dirname(args.report), { recursive: true });
    await writeFile(args.report, `${report}\n`, "utf8");
  }
  if (result.errors.length > 0 && !args.reportOnly) return EXIT_AUDIT_ERROR;
  return EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error.message);
    if (error.kind === "path-not-found") process.exit(EXIT_AUDIT_ERROR);
    if (
      /Unknown argument|Invalid --depth|Audit v1 uses|Report path must/.test(
        error.message,
      )
    )
      process.exit(EXIT_CONFIG_ERROR);
    process.exit(EXIT_REMOTE_FAILURE);
  });
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts to include:

```json
"audit:openlist": "bun scripts/audit-openlist-structure.mjs",
"audit:openlist:self-test": "bun scripts/audit-openlist-structure.mjs --self-test",
"format": "bun --bun prettier --write ."
```

Keep existing `docs:dev`, `docs:build`, `docs:preview`, and `update-campus` scripts unchanged.

- [ ] **Step 5: Run CLI self-test and verify GREEN**

Run: `bun run audit:openlist:self-test`

Expected: PASS, invoking `node --test scripts/openlist-audit-lib.test.mjs` with all helper tests passing.

- [ ] **Step 6: Run audit report mode**

Run: `bun run audit:openlist -- --depth 1 --report-only`

Expected: command completes with exit code 0 in report-only mode and prints `Errors:`, `Warnings:`, and `Info:` counts. It may list known invalid math paths until migration tasks run.

- [ ] **Step 7: Checkpoint**

Run: `rtk git status --short --untracked-files=all`

Expected: config, CLI, helper, helper test, and `package.json` are changed or new.

---

### Task 3: Build-Time OpenList Decoupling And Runtime Error States

**Files:**

- Modify: `.vitepress/theme/components/alist.data.mts`
- Modify: `.vitepress/theme/components/OListItem.vue`

- [ ] **Step 1: Verify current build-time dependency exists**

Run: `Get-Content ".vitepress/theme/components/alist.data.mts"`

Expected: file contains `return await fetchList();`, confirming the current build-time remote dependency.

- [ ] **Step 2: Modify data loader to avoid remote failure**

Replace `.vitepress/theme/components/alist.data.mts` with:

```ts
import { defineLoader } from "vitepress";
import type { DataItem } from "./alist.api.mjs";

declare const data: DataItem[];
export { data };

export default defineLoader({
  async load(): Promise<DataItem[]> {
    return [];
  },
});
```

- [ ] **Step 3: Add loading-error state in `OListItem.vue`**

In `.vitepress/theme/components/OListItem.vue`, after `const filters = ref<Record<string, string>>({});`, add:

```ts
const initialLoadError = ref<string | null>(null);
const failedExpansionKeys = ref<Record<string, boolean>>({});

function createLoadingNode(key: string): TreeDataNode {
  return {
    key,
    data: {
      name: "",
      is_dir: true,
      modified: new Date(),
      size: 0,
      path: "",
    },
    loading: true,
  };
}

function mapItemsToTreeNodes(
  items: DataItem[],
  parentKey = "",
): TreeDataNode[] {
  return items.map((item: DataItem, index: number) => {
    const key = parentKey ? `${parentKey}-${index}` : `${index}`;
    return {
      key,
      data: item,
      children: item.is_dir ? [createLoadingNode(`${key}-loading`)] : undefined,
    };
  });
}

function errorMessageForPath(targetPath: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `资料目录 ${targetPath} 加载失败。请刷新页面重试，或联系维护者检查 OpenList 路径。${detail}`;
}
```

- [ ] **Step 4: Replace repeated loading-node construction**

Change the `data` initialization to:

```ts
const data = ref<TreeDataNode[]>(
  path === "/"
    ? mapItemsToTreeNodes(defaultData)
    : [createLoadingNode("loading")],
);
```

Change `onExpand` to:

```ts
const onExpand = async (node: TreeDataNode) => {
  const key = String(node.key);
  if (
    node.children &&
    !node.children[0]?.loading &&
    !failedExpansionKeys.value[key]
  )
    return;
  try {
    failedExpansionKeys.value[key] = false;
    node.children = [createLoadingNode(`${node.key}-loading`)];
    const children = await fetchList(node.data.path, host);
    node.children = mapItemsToTreeNodes(children, String(node.key));
  } catch (error) {
    failedExpansionKeys.value[key] = true;
    node.children = undefined;
    expandedKeys.value[key] = false;
    toast.add({
      severity: "error",
      summary: "资料目录加载失败",
      detail: errorMessageForPath(node.data.path, error),
      life: 8000,
    });
    console.error(`[OList] Failed to expand ${node.data.path}:`, error);
  }
};
```

Change `onMounted` to:

```ts
onMounted(async () => {
  try {
    initialLoadError.value = null;
    data.value = mapItemsToTreeNodes(await fetchList(path, host));
  } catch (error) {
    initialLoadError.value = errorMessageForPath(path, error);
    data.value = [];
    console.error(`[OList] Failed to load ${path}:`, error);
    return;
  }

  if (path === "/") {
    tryCampusNetworkDetection();
  }
});
```

- [ ] **Step 5: Render initial-load error in the template**

Inside the `<Fieldset>` before `<TreeTable>`, add:

```vue
<div
  v-if="initialLoadError"
  class="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
>
  {{ initialLoadError }}
</div>
```

Wrap the existing `<TreeTable>` with `v-else`:

```vue
<TreeTable
  v-else
  v-model:expandedKeys="expandedKeys"
  v-model:selectionKeys="selectedKeys"
  :value="filteredData"
  selectionMode="checkbox"
  lazy
  scrollable
  @nodeExpand="onExpand"
  @sort="onSort"
>
```

- [ ] **Step 6: Verify build and formatting**

Run: `bun --bun prettier --check .vitepress/theme/components/alist.data.mts .vitepress/theme/components/OListItem.vue`

Expected: Prettier reports both files use the configured style.

Run: `bun run docs:build`

Expected: VitePress build completes. OpenList availability must not be required by `alist.data.mts`.

- [ ] **Step 7: Checkpoint**

Run: `rtk git diff --stat`

Expected: only `alist.data.mts` and `OListItem.vue` are changed for this task.

---

### Task 4: Manual Math学院 Markdown Migration

**Files:**

- Create: `数学学院/专业基础课/index.md`
- Create: `数学学院/专业基础课/常微分方程/index.md`
- Create: `数学学院/专业基础课/初等数论/index.md`
- Create: `数学学院/专业基础课/泛函分析/index.md`
- Create: `数学学院/专业基础课/复变函数/index.md`
- Create: `数学学院/专业基础课/高等代数/index.md`
- Create: `数学学院/专业基础课/计算概论/index.md`
- Create: `数学学院/专业基础课/实变函数/index.md`
- Create: `数学学院/专业基础课/数学分析/index.md`
- Create: `数学学院/专业基础课/微分方程数值解/index.md`
- Create: `数学学院/细分专业课/index.md`
- Create: `数学学院/细分专业课/信息与计算科学/index.md`
- Create: `数学学院/细分专业课/信息与计算科学/信息论基础/index.md`
- Create: `docs/superpowers/reports/openlist-orphans.md`
- Delete after replacement: old math course folders whose only useful content has been migrated.

- [ ] **Step 1: Record the migration table**

Create `docs/superpowers/reports/openlist-orphans.md` with:

```md
# OpenList 孤儿页与手动映射记录

## 数学学院首轮迁移

| 旧 Markdown 路径                                     | 旧 OpenList path                             | 新 OpenList path                                 | 新 Markdown 路径                                         | 状态       |
| ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ---------- |
| `数学学院/常微分方程/index.md`                       | `/数学学院/常微分方程`                       | `/数学学院/专业基础课/常微分方程`                | `数学学院/专业基础课/常微分方程/index.md`                | 计划迁移   |
| `数学学院/初等数论/index.md`                         | `/数学学院/初等数论`                         | `/数学学院/专业基础课/初等数论`                  | `数学学院/专业基础课/初等数论/index.md`                  | 计划迁移   |
| `数学学院/泛函分析/index.md`                         | `/数学学院/泛函分析`                         | `/数学学院/专业基础课/泛函分析`                  | `数学学院/专业基础课/泛函分析/index.md`                  | 计划迁移   |
| `数学学院/复变函数/index.md`                         | `/数学学院/复变函数`                         | `/数学学院/专业基础课/复变函数`                  | `数学学院/专业基础课/复变函数/index.md`                  | 计划迁移   |
| `数学学院/高等代数 版本一/index.md`                  | `/数学学院/高等代数 版本一`                  | `/数学学院/专业基础课/高等代数`                  | `数学学院/专业基础课/高等代数/index.md`                  | 计划迁移   |
| `数学学院/计算概论/index.md`                         | `/数学学院/计算概论`                         | `/数学学院/专业基础课/计算概论`                  | `数学学院/专业基础课/计算概论/index.md`                  | 计划迁移   |
| `数学学院/实变函数/index.md`                         | `/数学学院/实变函数`                         | `/数学学院/专业基础课/实变函数`                  | `数学学院/专业基础课/实变函数/index.md`                  | 计划迁移   |
| `数学学院/数学分析/index.md`                         | `/数学学院/数学分析`                         | `/数学学院/专业基础课/数学分析`                  | `数学学院/专业基础课/数学分析/index.md`                  | 计划迁移   |
| `数学学院/微分方程数值解院士完整版/index.md`         | `/数学学院/微分方程数值解院士完整版`         | `/数学学院/专业基础课/微分方程数值解`            | `数学学院/专业基础课/微分方程数值解/index.md`            | 计划迁移   |
| `数学学院/【信息与计算科学】信息论基础讲义/index.md` | `/数学学院/【信息与计算科学】信息论基础讲义` | `/数学学院/细分专业课/信息与计算科学/信息论基础` | `数学学院/细分专业课/信息与计算科学/信息论基础/index.md` | 计划迁移   |
| `数学学院/集合论图论/index.md`                       | `/数学学院/集合论图论`                       | 未找到                                           | 未建立                                                   | 孤儿页候选 |

## 孤儿页候选

`数学学院/集合论图论/index.md` 对应 OpenList 目录暂未找到。首轮迁移不得默认删除该页面；应先移除失效 `<OList path>` 并保留说明，或在维护者明确确认后删除、归档或重新映射。
```

- [ ] **Step 2: Create math index pages**

Create `数学学院/专业基础课/index.md`:

```md
# 专业基础课

数学学院专业基础课资料入口。

## 资料下载

<OList path="/数学学院/专业基础课" />
```

Create `数学学院/细分专业课/index.md`:

```md
# 细分专业课

数学学院细分专业课资料入口。

## 资料下载

<OList path="/数学学院/细分专业课" />
```

Create `数学学院/细分专业课/信息与计算科学/index.md`:

```md
# 信息与计算科学

信息与计算科学方向资料入口。

## 资料下载

<OList path="/数学学院/细分专业课/信息与计算科学" />
```

- [ ] **Step 3: Create math course pages**

Use the following exact mapping. Each page body is `# 标题`、one sentence、`## 资料下载`、the listed `<OList path>`.

| File                                                     | Title            | Sentence                             | OList path                                       |
| -------------------------------------------------------- | ---------------- | ------------------------------------ | ------------------------------------------------ |
| `数学学院/专业基础课/常微分方程/index.md`                | `常微分方程`     | `包含常微分方程课程的相关资料。`     | `/数学学院/专业基础课/常微分方程`                |
| `数学学院/专业基础课/初等数论/index.md`                  | `初等数论`       | `包含初等数论课程的相关资料。`       | `/数学学院/专业基础课/初等数论`                  |
| `数学学院/专业基础课/泛函分析/index.md`                  | `泛函分析`       | `包含泛函分析课程的相关资料。`       | `/数学学院/专业基础课/泛函分析`                  |
| `数学学院/专业基础课/复变函数/index.md`                  | `复变函数`       | `包含复变函数课程的相关资料。`       | `/数学学院/专业基础课/复变函数`                  |
| `数学学院/专业基础课/高等代数/index.md`                  | `高等代数`       | `包含高等代数课程的相关资料。`       | `/数学学院/专业基础课/高等代数`                  |
| `数学学院/专业基础课/计算概论/index.md`                  | `计算概论`       | `包含计算概论课程的相关资料。`       | `/数学学院/专业基础课/计算概论`                  |
| `数学学院/专业基础课/实变函数/index.md`                  | `实变函数`       | `包含实变函数课程的相关资料。`       | `/数学学院/专业基础课/实变函数`                  |
| `数学学院/专业基础课/数学分析/index.md`                  | `数学分析`       | `包含数学分析课程的相关资料。`       | `/数学学院/专业基础课/数学分析`                  |
| `数学学院/专业基础课/微分方程数值解/index.md`            | `微分方程数值解` | `包含微分方程数值解课程的相关资料。` | `/数学学院/专业基础课/微分方程数值解`            |
| `数学学院/细分专业课/信息与计算科学/信息论基础/index.md` | `信息论基础`     | `包含信息论基础课程的相关资料。`     | `/数学学院/细分专业课/信息与计算科学/信息论基础` |

For example, `数学学院/专业基础课/数学分析/index.md` must be:

```md
# 数学分析

包含数学分析课程的相关资料。

## 资料下载

<OList path="/数学学院/专业基础课/数学分析" />
```

- [ ] **Step 4: Safely retire old invalid math pages**

Before removing any old math directory, list its contents and read `index.md`. If the directory contains files other than a template `index.md`, stop and migrate that content into the new page or ask for maintainer confirmation. If the directory only contains an already-migrated template `index.md`, delete it after the new page exists:

```text
数学学院/【信息与计算科学】信息论基础讲义
数学学院/初等数论
数学学院/复变函数
数学学院/实变函数
数学学院/常微分方程
数学学院/微分方程数值解院士完整版
数学学院/数学分析
数学学院/泛函分析
数学学院/计算概论
数学学院/高等代数 版本一
```

Do not delete `数学学院/集合论图论` by default. Replace its `index.md` with this explanation page so the invalid OpenList binding is removed while the orphan decision remains visible:

```md
# 集合论图论

集合论图论资料目录暂未在当前 OpenList 数学学院结构中找到。

该页面作为孤儿页候选暂时保留，不展示资料下载列表。维护者确认远端资料位置后，可以重新映射到新的 `<OList path="..." />`，或归档、删除该页面。
```

- [ ] **Step 5: Verify math paths**

Run: `bun run audit:openlist -- --depth 4`

Expected: no `ERROR missing-remote-path` entries for math pages. If other non-math errors appear, record them and handle in the relevant task.

After this command succeeds, update `docs/superpowers/reports/openlist-orphans.md` so the migrated math rows change from `计划迁移` to `已迁移`. Keep `集合论图论` as `孤儿页候选` until a maintainer chooses delete, archive, or remap.

- [ ] **Step 6: Checkpoint**

Run: `rtk git status --short --untracked-files=all`

Expected: new math directories exist, old invalid math directories are deleted, and `docs/superpowers/reports/openlist-orphans.md` exists.

---

### Task 5: Missing Top-Level And Observed Course Pages

**Files:**

- Create: top-level `index.md` files for missing OpenList directories.
- Create: observed course pages listed below.

This task only adds missing entries. Do not delete or rename existing valid pages such as `【公共课】/【公共课】计算思维与人工智能/index.md`、`【公共课】/【公共课】思想道德与法治/index.md` or existing `人文社科学部/**/index.md` pages.

- [ ] **Step 1: Create missing top-level classification pages**

For each row, create the file and use the exact body pattern shown after the table.

| File                                | Title                      | Sentence                                                 | OList path                  |
| ----------------------------------- | -------------------------- | -------------------------------------------------------- | --------------------------- |
| `电信学院/index.md`                 | `电信学院`                 | `电信学院资料入口。`                                     | `/电信学院`                 |
| `化工与化学学院/index.md`           | `化工与化学学院`           | `化工与化学学院资料入口。`                               | `/化工与化学学院`           |
| `环境学院/index.md`                 | `环境学院`                 | `环境学院资料入口。`                                     | `/环境学院`                 |
| `机电工程学院/index.md`             | `机电工程学院`             | `机电工程学院资料入口。`                                 | `/机电工程学院`             |
| `经管学院/index.md`                 | `经管学院`                 | `经管学院资料入口。`                                     | `/经管学院`                 |
| `生命科学和医学学部/index.md`       | `生命科学和医学学部`       | `生命科学和医学学部资料入口。`                           | `/生命科学和医学学部`       |
| `实验报告/index.md`                 | `实验报告`                 | `实验报告资料分类入口，不按普通学院课程结构维护。`       | `/实验报告`                 |
| `土木工程学院/index.md`             | `土木工程学院`             | `土木工程学院资料入口。`                                 | `/土木工程学院`             |
| `未来技术学院/index.md`             | `未来技术学院`             | `未来技术学院资料入口。`                                 | `/未来技术学院`             |
| `物理学院/index.md`                 | `物理学院`                 | `物理学院资料入口。`                                     | `/物理学院`                 |
| `薪火笔记社-竞赛/index.md`          | `薪火笔记社-竞赛`          | `竞赛资料分类入口，不按普通学院课程结构维护。`           | `/薪火笔记社-竞赛`          |
| `薪火笔记社-PPT及报告模板/index.md` | `薪火笔记社-PPT及报告模板` | `PPT 及报告模板资料分类入口，不按普通学院课程结构维护。` | `/薪火笔记社-PPT及报告模板` |
| `询问中/index.md`                   | `询问中`                   | `待确认资料分类入口，后续由维护者确认归属。`             | `/询问中`                   |
| `仪器学院/index.md`                 | `仪器学院`                 | `仪器学院资料入口。`                                     | `/仪器学院`                 |

Body pattern for each file:

```md
# 标题

Sentence

## 资料下载

<OList path="OList path" />
```

- [ ] **Step 2: Create observed public-course pages**

Create these pages under `【公共课】/` with the same body pattern, using the title as the heading, `包含标题课程的相关资料。` as the sentence, and the listed path:

```text
【公共课】/【工科公共课】工程制图/index.md -> /【公共课】/【工科公共课】工程制图
【公共课】/【工科公共课】理论力学/index.md -> /【公共课】/【工科公共课】理论力学
【公共课】/【公共课】大学化学/index.md -> /【公共课】/【公共课】大学化学
【公共课】/【公共课】大学物理/index.md -> /【公共课】/【公共课】大学物理
【公共课】/【公共课】电路类课程/index.md -> /【公共课】/【公共课】电路类课程
【公共课】/【公共课】概率论与数理统计/index.md -> /【公共课】/【公共课】概率论与数理统计
【公共课】/【公共课】工科数学分析（微积分）/index.md -> /【公共课】/【公共课】工科数学分析（微积分）
【公共课】/【公共课】近现代史纲要/index.md -> /【公共课】/【公共课】近现代史纲要
【公共课】/【公共课】马克思主义原理/index.md -> /【公共课】/【公共课】马克思主义原理
【公共课】/【公共课】毛概/index.md -> /【公共课】/【公共课】毛概
【公共课】/【公共课】习概/index.md -> /【公共课】/【公共课】习概
【公共课】/【公共课】线性代数与空间解析几何/index.md -> /【公共课】/【公共课】线性代数与空间解析几何
```

- [ ] **Step 3: Create observed college course pages**

Create these pages with the same body pattern:

```text
交通科学与工程学院/交通管理/index.md -> /交通科学与工程学院/交通管理
交通科学与工程学院/智能交通导论/index.md -> /交通科学与工程学院/智能交通导论
电信学院/信号与系统/index.md -> /电信学院/信号与系统
机电工程学院/数字电路/index.md -> /机电工程学院/数字电路
机电工程学院/电工技术/index.md -> /机电工程学院/电工技术
仪器学院/工程光学/index.md -> /仪器学院/工程光学
```

- [ ] **Step 4: Create physics grouping and course pages**

Create `物理学院/专业基础课/index.md` with `<OList path="/物理学院/专业基础课" />` and `物理学院/细分专业课/index.md` with `<OList path="/物理学院/细分专业课" />`.

Create these course pages with the same body pattern:

```text
物理学院/专业基础课/光学/index.md -> /物理学院/专业基础课/光学
物理学院/专业基础课/力学/index.md -> /物理学院/专业基础课/力学
物理学院/专业基础课/原子物理/index.md -> /物理学院/专业基础课/原子物理
物理学院/专业基础课/数学物理方法/index.md -> /物理学院/专业基础课/数学物理方法
物理学院/专业基础课/热力学与统计物理/index.md -> /物理学院/专业基础课/热力学与统计物理
物理学院/专业基础课/热学/index.md -> /物理学院/专业基础课/热学
物理学院/专业基础课/理论力学/index.md -> /物理学院/专业基础课/理论力学
物理学院/专业基础课/电动力学/index.md -> /物理学院/专业基础课/电动力学
物理学院/专业基础课/电磁学/index.md -> /物理学院/专业基础课/电磁学
物理学院/专业基础课/量子力学/index.md -> /物理学院/专业基础课/量子力学
物理学院/细分专业课/光学/index.md -> /物理学院/细分专业课/光学
```

- [ ] **Step 5: Verify new pages against OpenList**

Run: `bun run audit:openlist -- --depth 4`

Expected: no `ERROR missing-remote-path` entries for the pages created in this task.

- [ ] **Step 6: Build after Markdown additions**

Run: `bun run docs:build`

Expected: VitePress build completes and sidebar generation does not error on new Chinese paths.

---

### Task 6: README And Contributing Documentation

**Files:**

- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Update README authority model**

In `README.md`, replace any wording that implies the existing local folder list is the complete course tree with this section:

Also remove or rewrite the old flat `数学学院/数学分析`、`数学学院/高等代数` style project-structure example so README no longer implies the current local folders are complete or still match OpenList exactly.

```md
## 课程入口与资料目录

站点内的课程入口以仓库中的手写 Markdown 为准。VitePress 根据这些 Markdown 文件生成页面、侧边栏、标题和站内搜索内容。

OpenList 的 `/Fireworks` 目录是资料下载目录参考。课程页中的 `<OList path="..." />` 必须指向真实存在的 OpenList 目录，但 OpenList 不会在构建时自动生成站点页面。

当 OpenList 新增或重排目录时，维护者需要手动新增、移动或更新 Markdown 页面，然后运行 `bun run audit:openlist` 检查 `<OList path>` 是否有效。
```

- [ ] **Step 2: Update CONTRIBUTING checklist**

Add this section to `CONTRIBUTING.md`:

```md
## 课程页与 OpenList 目录维护

新增、移动或删除课程页时，请按以下顺序检查：

1. 确认 Markdown 路径是站点内希望展示的分类或课程入口。
2. 确认页面标题和课程说明由维护者手写，不由脚本生成。
3. 确认 `<OList path="..." />` 指向真实存在的 OpenList `/Fireworks` 子目录。
4. 判断页面类型是普通课程页、中间分组页，还是实验报告、竞赛、模板等非普通资料分类。
5. 运行 `bun run audit:openlist` 查看当前差距报告。
6. 运行 `bun run audit:openlist`，确保没有新增 `error`。

审计脚本只读 OpenList 和本地 Markdown。它可以输出报告，但不会自动创建、移动、删除或修改课程 Markdown 页面。审计报告不得作为课程入口提交到课程目录。
```

- [ ] **Step 3: Verify docs formatting**

Run: `bun --bun prettier --check README.md CONTRIBUTING.md`

Expected: both Markdown files pass formatting.

---

### Task 7: Independent Audit Workflow

**Files:**

- Create: `.github/workflows/openlist-audit.yml`

- [ ] **Step 1: Add report-only audit workflow**

Create `.github/workflows/openlist-audit.yml`:

```yaml
name: OpenList Audit

on:
  workflow_dispatch:
  schedule:
    - cron: "0 20 * * 0"

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun ci

      - name: Run OpenList audit self-test
        run: bun run audit:openlist:self-test

      - name: Run OpenList audit report
        run: bun run audit:openlist -- --depth 4 --report-only --report docs/superpowers/reports/openlist-audit.md

      - name: Upload audit report
        uses: actions/upload-artifact@v6
        with:
          name: openlist-audit
          path: docs/superpowers/reports/openlist-audit.md
```

Do not add this audit to `.github/workflows/deploy.yml` in this task.

- [ ] **Step 2: Verify workflow does not affect deploy build**

Run: `bun run audit:openlist:self-test`

Expected: self-test passes.

Run: `bun run docs:build`

Expected: deploy build remains independent of the new audit workflow.

- [ ] **Step 3: Enable the audit error gate only after audit is clean**

After Task 4 and Task 5 remove all `ERROR missing-remote-path` entries, add `pull_request` to the workflow triggers and update the audit report step to:

```yaml
on:
  pull_request:
  workflow_dispatch:
  schedule:
    - cron: "0 20 * * 0"
```

```yaml
- name: Run OpenList audit report
  run: bun run audit:openlist -- --depth 4 --report docs/superpowers/reports/openlist-audit.md
```

Run: `bun run audit:openlist -- --depth 4`

Expected: exit code 0. If warning entries remain, they do not fail the command.

---

### Task 8: Final Verification And Review Handoff

**Files:**

- No new files expected.

- [ ] **Step 1: Run all local verification commands**

Run: `bun run audit:openlist:self-test`

Expected: helper tests pass.

Run: `bun run audit:openlist -- --depth 4`

Expected: no `error` entries and exit code 0.

Run: `bun run docs:build`

Expected: VitePress build completes.

Run: `bun --bun prettier --check .`

Expected: all matched files use Prettier code style.

- [ ] **Step 2: Inspect final changes**

Run: `rtk git status --short --untracked-files=all`

Expected: changed files match this plan.

Run: `rtk git diff --stat`

Expected: changes include audit scripts, component error handling, Markdown migration, docs, and audit workflow.

- [ ] **Step 3: Request subagent code review**

Dispatch 3 read-only review subagents with the full spec path and this plan path. Required review angles: audit script correctness, VitePress/OList runtime behavior, and Markdown migration/documentation completeness.

Expected: all review subagents return “审查通过” or only non-blocking residual risks. If any blocking or important issue is reported, apply the review loop before reporting completion.

---

## Self-Review

Spec coverage: The plan covers Markdown authority, OpenList read-only audit, no automatic Markdown generation, current gap reporting, math migration, runtime error handling, build-time OpenList decoupling, audit exit codes, CI sequencing, README/CONTRIBUTING updates, and verification.

Placeholder scan: The plan contains no unresolved marker words or unspecified implementation placeholders. Repeated Markdown page creation is defined by exact file tables, titles, sentences, and OList paths.

Type consistency: Audit helper names used by tests match `scripts/openlist-audit-lib.mjs`: `normalizeOpenListPath`, `stripMarkdownCode`, `extractOListUses`, `isAuditedMarkdownPath`, `classifyOpenListFailure`, and `buildAuditResult`.

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
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vitepress",
  ".worktrees",
  "dist",
]);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

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
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--report-only") {
      args.reportOnly = true;
    } else if (arg === "--depth") {
      args.depth = Number(readOptionValue(argv, i, arg));
      i++;
    } else if (arg === "--host") {
      args.host = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === "--base") {
      args.base = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === "--password") {
      args.password = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === "--report") {
      args.report = readOptionValue(argv, i, arg);
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.depth) || args.depth < 0) {
    throw new Error(`Invalid --depth: ${args.depth}`);
  }

  return args;
}

async function selfTest() {
  const { spawn } = await import("node:child_process");
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "node",
      ["--test", "scripts/openlist-audit-lib.test.mjs"],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Self-test failed with exit code ${code}`));
    });
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
        headers: { "Content-Type": "application/json" },
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
          `OpenList ${kind} for ${normalizeOpenListPath(path)}: ${JSON.stringify(payload)}`,
        );
        error.kind = kind;
        throw error;
      }

      if (!payload.data || !Array.isArray(payload.data.content)) {
        const error = new Error(
          `OpenList protocol error for ${normalizeOpenListPath(path)}: ${JSON.stringify(payload).slice(0, 500)}`,
        );
        error.kind = "remote-failure";
        throw error;
      }

      return payload.data.content;
    } catch (error) {
      lastError = error;
      if (error.kind === "path-not-found" || attempt === config.retries) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function fetchRemoteDirs(options) {
  if (config.concurrency !== 1) {
    throw new Error(
      "Invalid config.concurrency: audit v1 uses a sequential queue and requires concurrency 1",
    );
  }

  const remoteRoot = "/";
  const dirs = new Set([remoteRoot]);
  const queue = [{ path: remoteRoot, depth: 0 }];

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
      if (dirs.has(childPath)) continue;

      dirs.add(childPath);
      if (dirs.size > config.maxDirectories) {
        throw new Error(
          `OpenList audit stopped after ${config.maxDirectories} directories`,
        );
      }
      if (current.depth + 1 < options.depth) {
        queue.push({ path: childPath, depth: current.depth + 1 });
      }
    }
  }

  return Array.from(dirs).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function listMarkdownFiles(rootDirectory) {
  const results = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;

      const absolute = join(directory, entry.name);
      const rel = relative(rootDirectory, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (isAuditedMarkdownPath(rel)) {
        results.push({ absolute, relative: rel });
      }
    }
  }

  await walk(rootDirectory);
  return results;
}

async function scanLocalUses(files) {
  const uses = [];

  for (const file of files) {
    const markdown = await readFile(file.absolute, "utf8");
    uses.push(...extractOListUses(markdown, file.relative));
  }

  return uses;
}

async function validateMissingLocalPaths(remoteDirs, localUses, args) {
  const remoteSet = new Set(remoteDirs.map(normalizeOpenListPath));

  for (const use of localUses) {
    if (use.unsupported || !use.path) continue;

    const localPath = normalizeOpenListPath(use.path);
    if (localPath === "/" || remoteSet.has(localPath)) continue;

    try {
      await fetchOpenList(localPath, args);
      remoteSet.add(localPath);
    } catch (error) {
      if (error.kind === "path-not-found") continue;
      throw error;
    }
  }

  return Array.from(remoteSet).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function formatReport(result) {
  const lines = [
    "# OpenList Audit Report",
    "",
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`,
    `Info: ${result.info.length}`,
    "",
  ];

  for (const error of result.errors) {
    lines.push(`ERROR ${error.type}: ${error.use.file} -> ${error.use.path}`);
  }

  for (const warning of result.warnings) {
    if (warning.use) {
      const { use } = warning;
      lines.push(
        `WARNING ${warning.type}: ${use.file} component=${use.component} unsupported=${use.unsupported} host=${use.host ?? ""} path=${use.path ?? ""}`,
      );
    } else {
      lines.push(`WARNING ${warning.type}: ${warning.path}`);
    }
  }

  for (const item of result.info) {
    lines.push(
      `INFO ${item.type}: ${item.path ?? item.file} - ${item.reason ?? ""}`.trim(),
    );
  }

  return lines.join("\n");
}

function assertReportPath(rootDirectory, report) {
  if (!report) return null;

  const target = resolve(rootDirectory, report);
  const reportsDir = resolve(rootDirectory, "docs/superpowers/reports");
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
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    await selfTest();
    return EXIT_OK;
  }

  const reportPath = assertReportPath(rootDir, args.report);
  const remoteDirs = await fetchRemoteDirs(args);
  const localMarkdownFiles = await listMarkdownFiles(rootDir);
  const localUses = await scanLocalUses(localMarkdownFiles);
  const verifiedRemoteDirs = await validateMissingLocalPaths(
    remoteDirs,
    localUses,
    args,
  );
  const result = buildAuditResult({
    remoteDirs: verifiedRemoteDirs,
    localUses,
    localMarkdownFiles: localMarkdownFiles.map((file) => file.relative),
    warningExemptions: config.warningExemptions,
    orphanPageAllowances: config.orphanPageAllowances,
  });
  const report = formatReport(result);
  console.log(report);

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${report}\n`, "utf8");
  }

  if (result.errors.length > 0 && !args.reportOnly) {
    return EXIT_AUDIT_ERROR;
  }
  return EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error.message);
    if (
      /Unknown argument|Missing value|Invalid --depth|Invalid config\.concurrency|Report path must/.test(
        error.message,
      )
    ) {
      process.exit(EXIT_CONFIG_ERROR);
    }
    process.exit(EXIT_REMOTE_FAILURE);
  });

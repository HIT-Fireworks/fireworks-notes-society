#!/usr/bin/env bun
import { rm, rename } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");
const temporary = path.join(root, "data/resource-tree-cache.next");
const target = path.join(root, "data/resource-tree-cache");
await rm(temporary, { recursive: true, force: true });
const result = spawnSync(
  "bun",
  [path.join(root, "scripts/build-resource-tree.mts"), temporary],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      FIREWORKS_RESOURCE_TREE_REFRESH: "1",
      FIREWORKS_RESOURCE_TREE_PERSISTENT_DIR: target,
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(target, { recursive: true, force: true });
await rename(temporary, target);

#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";

const source = "https://github.akams.cn/";
const fallback = [
  "https://gh-proxy.com",
  "https://gh.dpik.top",
  "https://github.tbap.top",
  "https://gh.inkchills.cn",
];

const html = await fetch(source).then(async (response) => {
  if (!response.ok) throw new Error(`节点页面返回 ${response.status}`);
  return response.text();
});
const discovered = Array.from(
  html.matchAll(
    /https:\/\/([A-Za-z0-9.-]+)\/https:\/\/raw\.githubusercontent\.com/gi,
  ),
  (match) => `https://${match[1].toLowerCase()}`,
);
const nodes = Array.from(new Set(discovered)).filter(
  (node) => !node.includes("github.akams.cn"),
);
const selected = (nodes.length ? nodes : fallback).slice(0, 12);
await mkdir("data", { recursive: true });
await writeFile(
  "data/gh-proxy-nodes.json",
  `${JSON.stringify({ source, updatedAt: new Date().toISOString(), nodes: selected }, null, 2)}\n`,
  "utf8",
);
console.log(`已写入 ${selected.length} 个 gh-proxy 节点`);

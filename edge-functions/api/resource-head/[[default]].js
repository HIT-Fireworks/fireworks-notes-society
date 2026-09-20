const API = "https://api.github.com";
const OWNER = "HIT-Fireworks";
const CATEGORIES = new Set(["教材", "笔记", "课件", "试卷", "作业", "实验", "软件", "教程", "模板", "项目", "其他"]);
const HEAD_CACHE = "public, max-age=600, s-maxage=600";
const TREE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";
function json(value, status = 200, cache = "no-store") { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } }); }
function segment(value) { try { const decoded = decodeURIComponent(value); return decoded && !decoded.includes("/") && decoded !== "." && decoded !== ".." ? decoded : ""; } catch { return ""; } }
function repoFrom(url) { const parts = url.pathname.split("/").filter(Boolean); const index = parts.indexOf("resource-head"); return index >= 0 ? segment(parts[index + 1]) : ""; }
function authHeaders(env) { const headers = { Accept: "application/vnd.github+json", "User-Agent": "HIT-Fireworks-resource-head", "X-GitHub-Api-Version": "2022-11-28" }; if (env?.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`; return headers; }
async function github(path, env) { const response = await fetch(`${API}${path}`, { headers: authHeaders(env) }); if (!response.ok) throw new Error(`GitHub API ${response.status}`); return response.json(); }
export async function onRequestGet(context) { const repoId = repoFrom(new URL(context.request.url)); if (!repoId) return json({ error: "invalid_repo" }, 400); try { const commit = await github(`/repos/${OWNER}/${encodeURIComponent(repoId)}/commits/main`, context.env); return json({ repoId, commit: commit.sha, treeSha: commit.commit.tree.sha }, 200, HEAD_CACHE); } catch { return json({ error: "resource_head_unavailable" }, 502); } }
export const __test = { repoFrom };

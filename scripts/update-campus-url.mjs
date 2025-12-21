/**
 * 校园网检测 URL 更新脚本
 *
 * 功能：
 * 1. 从 today.hit.edu.cn/category/11 获取第一篇文章的 URL
 * 2. 获取该 URL 的 HTML 并计算 MD5
 * 3. 调用 OpenList API 更新"校内资源"文件夹的密码
 * 4. 将 URL 保存到 public/campus-url.txt
 *
 * 使用方法：
 *   node scripts/update-campus-url.mjs
 */

import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// OpenList API 配置
const OLIST_HOSTS = ["https://olist-eo.jwyihao.top"];

// 需要更新密码的路径
const TARGET_PATHS = ["/Fireworks/校内资源", "/Fireworks（EdgeOne）/校内资源"];

/**
 * 交互式读取用户输入
 */
function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 交互式读取密码（不回显）
 */
function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (ch === "\u007F" || ch === "\b") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (ch === "\u0003") {
        // Ctrl+C
        process.exit();
      } else {
        password += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * 从 zb.hit.edu.cn/help 随机获取一篇帮助文章的 URL
 */
async function getRandomHelpArticleUrl() {
  // 1. 先获取第一页，解析总页数
  console.log("正在获取 zb.hit.edu.cn 帮助中心 (第1页)...");
  const firstRes = await fetch("https://zb.hit.edu.cn/help?page=1");
  if (!firstRes.ok) {
    throw new Error(`无法访问 zb.hit.edu.cn: ${firstRes.status}`);
  }
  const firstHtml = await firstRes.text();

  // 解析分页，获取总页数
  // 页面结构：<a href="https://zb.hit.edu.cn/help?page=24">24</a>
  const pageMatches = firstHtml.matchAll(/help\?page=(\d+)/g);
  const pageNumbers = [...new Set([...pageMatches].map((m) => parseInt(m[1])))];
  const totalPages = Math.max(...pageNumbers, 1);
  console.log(`共 ${totalPages} 页`);

  // 2. 随机选择一页
  const randomPage = Math.floor(Math.random() * totalPages) + 1;

  // 如果随机到第1页，直接使用已获取的内容
  let html = firstHtml;
  if (randomPage !== 1) {
    console.log(`随机选择第 ${randomPage} 页...`);
    const res = await fetch(`https://zb.hit.edu.cn/help?page=${randomPage}`);
    if (!res.ok) {
      throw new Error(`无法访问第 ${randomPage} 页: ${res.status}`);
    }
    html = await res.text();
  } else {
    console.log(`随机选择第 1 页...`);
  }

  // 3. 解析文章链接并随机选择
  const matches = html.matchAll(/<a\s+href="(\/help\/detail\/\d+)"/g);
  const uniquePaths = [...new Set([...matches].map((m) => m[1]))];

  if (uniquePaths.length === 0) {
    throw new Error("无法找到帮助文章链接");
  }

  const randomIndex = Math.floor(Math.random() * uniquePaths.length);
  const articlePath = uniquePaths[randomIndex];
  const articleUrl = `https://zb.hit.edu.cn${articlePath}`;
  console.log(
    `随机选择文章 (${randomIndex + 1}/${uniquePaths.length}): ${articleUrl}`,
  );
  return articleUrl;
}

/**
 * 获取 URL 内容并计算 MD5
 */
async function fetchAndComputeMd5(url) {
  console.log("正在获取文章内容...");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`无法获取文章内容: ${res.status}`);
  }
  const html = await res.text();

  const md5 = createHash("md5").update(html).digest("hex");
  console.log(`MD5: ${md5}`);
  return md5;
}

/**
 * OpenList 登录获取 token
 */
async function login(host, username, password) {
  console.log(`正在登录 ${host}...`);
  const res = await fetch(`${host}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw new Error(`登录失败: ${data.message}`);
  }
  console.log("登录成功");
  return data.data.token;
}

/**
 * 获取所有 meta 配置
 */
async function listMetas(host, token) {
  const res = await fetch(`${host}/api/admin/meta/list`, {
    headers: { Authorization: token },
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw new Error(`获取 meta 列表失败: ${data.message}`);
  }
  return data.data.content || data.data || [];
}

/**
 * 更新 meta 密码
 */
async function updateMetaPassword(host, token, metaId, path, password) {
  const res = await fetch(`${host}/api/admin/meta/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ id: metaId, path, password }),
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw new Error(`更新密码失败: ${data.message}`);
  }
}

/**
 * 创建新的 meta 配置
 */
async function createMeta(host, token, path, password) {
  const res = await fetch(`${host}/api/admin/meta/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ path, password }),
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw new Error(`创建 meta 失败: ${data.message}`);
  }
  return data.data;
}

/**
 * 主函数
 */
async function main() {
  try {
    // 1. 从帮助中心随机获取文章 URL
    const articleUrl = await getRandomHelpArticleUrl();

    // 2. 计算 MD5
    const md5 = await fetchAndComputeMd5(articleUrl);

    // 3. 交互式获取凭据
    console.log("\n请输入 OpenList 管理员凭据:");
    const username = await prompt("用户名: ");
    const password = await promptPassword("密码: ");

    // 4. 更新每个 host 上的 meta
    for (const host of OLIST_HOSTS) {
      console.log(`\n处理 ${host}...`);

      // 登录
      const token = await login(host, username, password);

      // 获取 meta 列表
      const metas = await listMetas(host, token);
      console.log(`找到 ${metas.length} 个 meta 配置`);

      // 查找并更新目标路径
      for (const targetPath of TARGET_PATHS) {
        const meta = metas.find((m) => m.path === targetPath);
        if (meta) {
          console.log(`更新 ${targetPath} (ID: ${meta.id})...`);
          await updateMetaPassword(host, token, meta.id, targetPath, md5);
          console.log(`✓ 已更新`);
        } else {
          console.log(`⚠ 未找到 ${targetPath} 的 meta 配置`);
          const answer = await prompt(
            `是否为 ${targetPath} 创建新配置? (y/n): `,
          );
          if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
            console.log(`创建 ${targetPath}...`);
            await createMeta(host, token, targetPath, md5);
            console.log(`✓ 已创建`);
          } else {
            console.log(`跳过 ${targetPath}`);
          }
        }
      }
    }

    // 5. 保存 URL 到文件
    const outputPath = join(__dirname, "..", "public", "campus-url.txt");
    writeFileSync(outputPath, articleUrl, "utf-8");
    console.log(`\n✓ URL 已保存到 ${outputPath}`);

    console.log("\n========================================");
    console.log("完成！请提交 public/campus-url.txt 并部署。");
    console.log(`使用的 URL: ${articleUrl}`);
    console.log(`密码 MD5: ${md5}`);
    console.log("========================================");
  } catch (error) {
    console.error("错误:", error.message);
    process.exit(1);
  }
}

main();

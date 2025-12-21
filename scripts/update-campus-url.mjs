/**
 * 校园网检测 URL 更新脚本
 *
 * 功能：
 * 1. 从 mytoday.hit.edu.cn/category/11 获取文章列表
 * 2. 提取文章中的图片，收集20张图片信息
 * 3. 计算每张图片的 MD5 和尺寸
 * 4. 使用 MD5(realMd5 + 尺寸) 作为密码更新 OpenList
 * 5. 保存图片验证数据到配置文件
 *
 * 使用方法：
 *   node scripts/update-campus-url.mjs
 */

import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { get } from "https";
import { get as httpGet } from "http";
import { promisify } from "util";
import { Buffer } from "buffer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// OpenList API 配置
const OLIST_HOSTS = ["https://olist-eo.jwyihao.top"];

// 需要更新密码的路径
const TARGET_PATHS = ["/Fireworks/校内资源", "/Fireworks（EdgeOne）/校内资源"];

// 配置
const TARGET_IMAGE_COUNT = 20;
const MYTODAY_BASE = "http://mytoday.hit.edu.cn";

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
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (ch === "\u0003") {
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
 * HTTP/HTTPS GET 请求，返回Buffer（用于图片）
 */
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? get : httpGet;
    getter(url, (res) => {
      // 处理重定向
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        // 检查是否重定向到登录页面
        if (res.headers.location.includes("ids.hit.edu.cn")) {
          reject(new Error("需要登录"));
          return;
        }
        fetchBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * HTTP/HTTPS GET 请求，返回文本
 */
async function fetchText(url) {
  const buffer = await fetchBuffer(url);
  return buffer.toString("utf-8");
}

/**
 * 从 PNG/JPEG 图片获取尺寸（无需第三方库）
 */
function getImageDimensions(buffer) {
  // PNG: 宽高在第16-23字节（大端序）
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // JPEG: 需要解析SOF段
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length - 1) {
      if (buffer[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buffer[i + 1];
      // SOF0, SOF1, SOF2 markers
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = buffer.readUInt16BE(i + 5);
        const width = buffer.readUInt16BE(i + 7);
        return { width, height };
      }
      // 跳过非SOF段
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
      } else {
        const len = buffer.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
  }

  // GIF: 宽高在第6-9字节（小端序）
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  }

  return null;
}

/**
 * 从 mytoday.hit.edu.cn 收集图片验证数据
 */
async function collectImageVerificationData() {
  console.log("=== 收集图片验证数据 ===\n");

  const images = [];
  let page = 0;

  while (images.length < TARGET_IMAGE_COUNT) {
    // 获取文章列表
    const listUrl =
      page === 0
        ? `${MYTODAY_BASE}/category/11`
        : `${MYTODAY_BASE}/category/11?page=${page}`;

    console.log(`获取文章列表: ${listUrl}`);

    let listHtml;
    try {
      listHtml = await fetchText(listUrl);
    } catch (e) {
      console.log(`无法获取列表: ${e.message}`);
      break;
    }

    // 提取文章链接
    const articleMatches = listHtml.matchAll(/<a\s+href="(\/article\/[^"]+)"/g);
    const articlePaths = [...new Set([...articleMatches].map((m) => m[1]))];

    if (articlePaths.length === 0) {
      console.log("没有更多文章");
      break;
    }

    console.log(`找到 ${articlePaths.length} 篇文章`);

    for (const articlePath of articlePaths) {
      if (images.length >= TARGET_IMAGE_COUNT) break;

      const articleUrl = `${MYTODAY_BASE}${articlePath}`;
      console.log(`\n检查文章: ${articlePath}`);

      // 获取文章内容
      let articleHtml;
      try {
        articleHtml = await fetchText(articleUrl);
      } catch (e) {
        console.log(`  跳过 (${e.message})`);
        continue;
      }

      // 检查是否重定向到登录页
      if (
        articleHtml.includes("ids.hit.edu.cn") ||
        articleHtml.includes("统一身份认证")
      ) {
        console.log("  跳过 (需要登录)");
        continue;
      }

      // 提取文章中的图片
      const imgMatches = articleHtml.matchAll(/<img[^>]+src="([^"]+)"/g);
      const imgUrls = [...imgMatches]
        .map((m) => m[1])
        .filter((src) => src.includes("/sites/") && !src.includes("logo"));

      if (imgUrls.length === 0) {
        console.log("  没有找到图片");
        continue;
      }

      console.log(`  找到 ${imgUrls.length} 张图片`);

      for (const imgSrc of imgUrls) {
        if (images.length >= TARGET_IMAGE_COUNT) break;

        // 构建完整URL
        const imgUrl = imgSrc.startsWith("http")
          ? imgSrc
          : `${MYTODAY_BASE}${imgSrc}`;

        try {
          console.log(`  获取图片: ${imgUrl.substring(0, 80)}...`);
          const buffer = await fetchBuffer(imgUrl);

          // 计算MD5
          const md5 = createHash("md5").update(buffer).digest("hex");

          // 获取尺寸
          const dims = getImageDimensions(buffer);
          if (!dims) {
            console.log(`    跳过 (无法解析尺寸)`);
            continue;
          }

          // 计算最终密码: MD5(realMd5 + 尺寸)
          const dimsStr = `${dims.width}x${dims.height}`;
          const password = createHash("md5")
            .update(md5 + dimsStr)
            .digest("hex");

          images.push({
            url: imgUrl,
            md5: md5,
            password: password, // 存储计算好的密码，用于验证
          });

          console.log(
            `    ✓ ${dims.width}x${dims.height}, MD5: ${md5.substring(0, 8)}...`,
          );
          console.log(`    密码: ${password}`);
        } catch (e) {
          console.log(`    跳过 (${e.message})`);
        }
      }
    }

    page++;
    if (page > 10) break; // 最多检查10页
  }

  console.log(`\n收集到 ${images.length} 张图片`);
  return images;
}

/**
 * 计算综合密码（基于所有图片的MD5和尺寸）
 */
function computeFinalPassword(images) {
  // 使用第一张图片计算密码（前端也会尝试多张图片直到成功）
  if (images.length === 0) {
    throw new Error("没有收集到图片");
  }

  // 这里我们返回一个placeholder，实际密码需要前端获取尺寸后计算
  // 脚本需要获取图片尺寸来计算密码并更新服务器
  return images[0];
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
    // 1. 收集图片验证数据
    const images = await collectImageVerificationData();

    if (images.length === 0) {
      throw new Error("没有收集到任何图片");
    }

    // 2. 使用所有图片的特征生成综合密码
    console.log("\n=== 服务器密码 ===");
    // 将所有单独密码排序后拼接，再计算综合MD5
    const allPasswords = images.map((img) => img.password).sort();
    const serverPassword = createHash("md5")
      .update(allPasswords.join(""))
      .digest("hex");
    console.log(`使用 ${images.length} 张图片的特征`);
    console.log(`服务器密码: ${serverPassword}`);

    // 3. 交互式获取凭据
    console.log("\n请输入 OpenList 管理员凭据:");
    const username = await prompt("用户名: ");
    const password = await promptPassword("密码: ");

    // 4. 更新每个 host 上的 meta
    for (const host of OLIST_HOSTS) {
      console.log(`\n处理 ${host}...`);

      const token = await login(host, username, password);
      const metas = await listMetas(host, token);
      console.log(`找到 ${metas.length} 个 meta 配置`);

      for (const targetPath of TARGET_PATHS) {
        const meta = metas.find((m) => m.path === targetPath);
        if (meta) {
          console.log(`更新 ${targetPath} (ID: ${meta.id})...`);
          await updateMetaPassword(
            host,
            token,
            meta.id,
            targetPath,
            serverPassword,
          );
          console.log(`✓ 已更新`);
        } else {
          console.log(`⚠ 未找到 ${targetPath} 的 meta 配置`);
          const answer = await prompt(
            `是否为 ${targetPath} 创建新配置? (y/n): `,
          );
          if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
            console.log(`创建 ${targetPath}...`);
            await createMeta(host, token, targetPath, serverPassword);
            console.log(`✓ 已创建`);
          } else {
            console.log(`跳过 ${targetPath}`);
          }
        }
      }
    }

    // 5. 保存验证数据到配置文件
    const configData = {
      images: images.map((img) => ({
        url: img.url,
        md5: img.md5,
      })),
      generatedAt: new Date().toISOString(),
    };

    const outputPath = join(__dirname, "..", "public", "campus-verify.json");
    writeFileSync(outputPath, JSON.stringify(configData, null, 2), "utf-8");
    console.log(`\n✓ 验证数据已保存到 ${outputPath}`);

    console.log("\n========================================");
    console.log("完成！请提交 public/campus-verify.json 并部署。");
    console.log(`收集了 ${images.length} 张图片`);
    console.log(`服务器密码: ${serverPassword}`);
    console.log("========================================");
  } catch (error) {
    console.error("错误:", error.message);
    process.exit(1);
  }
}

main();

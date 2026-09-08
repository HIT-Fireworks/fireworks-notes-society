import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

const MAX_BYTES = 8 * 1024 * 1024;
const RESERVED = "$fireworks_shards";
type JsonObject = Record<string, unknown>;
interface CachedJson {
  value: unknown;
  dependencies: Map<string, string>;
}
// Vite 分别打包配置、动态路由和数据加载器；按绝对路径共享同一份已校验数据。
const cacheKey = Symbol.for("fireworks.manifest-store.v1");
const cacheOwner = globalThis as typeof globalThis & {
  [cacheKey]?: Map<string, CachedJson>;
};
const cache = (cacheOwner[cacheKey] ??= new Map<string, CachedJson>());

function fail(message: string): never {
  throw new Error(`JSON 分片读取失败：${message}`);
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stamp(file: string): string {
  const stat = fs.lstatSync(file, { bigint: true });
  if (stat.isSymbolicLink()) fail("不允许符号链接或目录联接");
  return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${fs.realpathSync(file)}`;
}

function parse(bytes: Buffer): unknown {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return fail("文件不是有效的 UTF-8 JSON");
  }
  // 原生解析负责语法；单遍扫描仅检查每个对象的解码后键，避免重复键被静默覆盖。
  const containers: (Set<string> | null)[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "{" || character === "[") {
      containers.push(character === "{" ? new Set() : null);
      if (containers.length > 256) fail("JSON 嵌套或分片引用层级过深");
    } else if (character === "}" || character === "]") {
      containers.pop();
    } else if (character === '"') {
      const start = index++;
      let escaped = false;
      while (text[index] !== '"') {
        if (text[index] === "\\") {
          escaped = true;
          index++;
        }
        index++;
      }
      let next = index + 1;
      while (text[next] === " " || text[next] === "\t" || text[next] === "\r" || text[next] === "\n") next++;
      if (text[next] === ":") {
        const key = escaped ? JSON.parse(text.slice(start, index + 1)) as string : text.slice(start + 1, index);
        const keys = containers[containers.length - 1]!;
        if (keys.has(key)) fail("JSON 对象包含重复键");
        keys.add(key);
      }
    }
  }
  return value;
}

function load(file: string): CachedJson {
  const absolute = path.resolve(file);
  try {
    const previous = cache.get(absolute);
    if (previous && [...previous.dependencies].every(([dependency, version]) => stamp(dependency) === version)) {
      return previous;
    }
    cache.delete(absolute);
    const dependencies = new Map<string, string>();
    function track(dependency: string): void {
      dependencies.set(dependency, stamp(dependency));
    }
    track(absolute);
    const rootDirectory = fs.realpathSync(path.dirname(absolute));
    const store = path.join(rootDirectory, ".fireworks-json");
    const active = new Set<string>();
    const parts = new Map<string, { bytes: number; value: unknown }>();
    let hasShards = false;
    let storeChecked = false;
    function resolve(value: unknown, depth = 0): unknown {
      if (depth > 256) fail("JSON 嵌套或分片引用层级过深");
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) value[index] = resolve(value[index], depth + 1);
        return value;
      }
      if (!object(value)) return value;
      if (!Object.hasOwn(value, RESERVED)) {
        for (const key of Object.keys(value)) value[key] = resolve(value[key], depth + 1);
        return value;
      }
      hasShards = true;
      if (Object.keys(value).length !== 3 || value[RESERVED] !== 1 ||
          (value.kind !== "array" && value.kind !== "object") ||
          !Array.isArray(value.parts) || value.parts.length === 0) {
        fail("保留字段对应的分片协议无效");
      }
      const kind = value.kind;
      const result: unknown[] | JsonObject = kind === "array" ? [] : {};
      for (const reference of value.parts) {
        if (!object(reference) || Object.keys(reference).length !== 2 ||
            typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256) ||
            !Number.isSafeInteger(reference.bytes) || typeof reference.bytes !== "number" ||
            reference.bytes <= 0 || reference.bytes > MAX_BYTES) {
          fail("分片引用的哈希、字节数或字段无效");
        }
        const hash = reference.sha256;
        if (active.has(hash)) fail("检测到循环分片引用");
        if (!storeChecked) {
          track(store);
          if (!fs.lstatSync(store).isDirectory()) fail("分片存储路径不是目录");
          const relativeStore = path.relative(rootDirectory, fs.realpathSync(store));
          if (relativeStore !== ".fireworks-json") fail("分片存储目录越界");
          storeChecked = true;
        }
        let part = parts.get(hash);
        if (part && part.bytes !== reference.bytes) fail("分片引用字节数不一致");
        if (!part) {
          const partFile = path.join(store, `${hash}.json`);
          track(partFile);
          const stat = fs.lstatSync(partFile);
          if (!stat.isFile() || stat.size !== reference.bytes || stat.size > MAX_BYTES) fail("分片文件类型或字节数不符");
          const relative = path.relative(store, fs.realpathSync(partFile));
          if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || relative !== `${hash}.json`) fail("分片文件越界");
          const bytes = fs.readFileSync(partFile);
          if (bytes.length !== reference.bytes || createHash("sha256").update(bytes).digest("hex") !== hash) fail("分片文件哈希或字节数不符");
          active.add(hash);
          try {
            part = { bytes: bytes.length, value: resolve(parse(bytes), depth + 1) };
            parts.set(hash, part);
          } finally {
            active.delete(hash);
          }
        }
        if (kind === "array") {
          if (!Array.isArray(part.value)) fail("数组分片内容不是数组");
          for (const item of part.value) (result as unknown[]).push(item);
        } else {
          if (!object(part.value)) fail("对象分片内容不是对象");
          for (const [key, item] of Object.entries(part.value)) {
            if (Object.hasOwn(result, key)) fail("对象分片包含重复键");
            Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
          }
        }
      }
      return result;
    }
    const bytes = fs.readFileSync(absolute);
    const value = resolve(parse(bytes));
    if (hasShards && bytes.length > MAX_BYTES) fail("分片根文件超过 8MiB");
    if (![...dependencies].every(([dependency, version]) => stamp(dependency) === version)) fail("读取期间源文件发生变化");
    const loaded = { value, dependencies };
    cache.set(absolute, loaded);
    return loaded;
  } catch (error) {
    cache.delete(absolute);
    if (error instanceof Error && error.message.startsWith("JSON 分片读取失败：")) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    return fail(`无法读取源文件${typeof code === "string" ? `（${code}）` : ""}`);
  }
}

/** 构建期共享只读结果；根、分片或存储目录的元数据变化会使缓存失效。 */
export function readManifestJson<T>(file: string): T {
  return load(file).value as T;
}

/** 返回实际读取的根及分片文件；复用同一解析结果，不重复解析 JSON。 */
export function manifestJsonSourceFiles(file: string): string[] {
  return [...load(file).dependencies.keys()].filter((dependency) => path.extname(dependency) === ".json");
}

/** 数据准备结束后释放原始清单；下一次读取仍重新校验所有依赖。 */
export function releaseManifestJsonCache(): void {
  cache.clear();
}

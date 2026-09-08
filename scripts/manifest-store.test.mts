import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadConfigFromFile } from "vite";
import { manifestJsonSourceFiles, readManifestJson } from "../.vitepress/theme/manifest-store.ts";

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fireworks-json-"));
  const root = path.join(directory, "manifest.json");
  const store = path.join(directory, ".fireworks-json");
  fs.mkdirSync(store);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory, root, store,
    rootValue(value: unknown) {
      fs.writeFileSync(root, JSON.stringify(value));
    },
    part(value: unknown) {
      const bytes = Buffer.from(JSON.stringify(value));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      fs.writeFileSync(path.join(store, `${sha256}.json`), bytes);
      return { sha256, bytes: bytes.length };
    },
  };
}

function wrapper(kind: string, parts: unknown[]) {
  return { $fireworks_shards: 1, kind, parts };
}

test("普通旧 JSON 完整保留未知字段、空值和对象键", (t) => {
  const f = fixture(t);
  const original = JSON.parse('{"unknown":{"__proto__":{"safe":true}},"empty":"","array":[],"object":{},"null":null}');
  f.rootValue(original);
  assert.deepEqual(readManifestJson(f.root), original);
  assert.deepEqual(manifestJsonSourceFiles(f.root), [f.root]);
});

test("数组多分片无损保留方案身份、重复课程 occurrence 和未知字段", (t) => {
  const f = fixture(t);
  const record = {
    source_kind: "execution", entry_cohort: "2024", plan_version: "修订版",
    major_full_name: "同名专业（方向）", program_type: "本科",
    record_id: "record-1", relation: "execution-module", course_code: "001",
    unknown: { empty: "", values: [null, {}] },
  };
  const second = { ...record, record_id: "record-2" };
  f.rootValue(wrapper("array", [f.part([record, record]), f.part([second, "", {}])]));
  assert.deepEqual(readManifestJson(f.root), [record, record, second, "", {}]);
});

test("对象分片、多层嵌套引用始终相对原始根目录恢复", (t) => {
  const f = fixture(t);
  const leaf = f.part(["甲", "乙"]);
  const middle = f.part([{ courses: wrapper("array", [leaf]) }]);
  const first = f.part({ plans: wrapper("array", [middle]) });
  const second = f.part(JSON.parse('{"__proto__":{"safe":true},"unknown":0}'));
  f.rootValue(wrapper("object", [first, second]));
  const result = readManifestJson<Record<string, unknown>>(f.root);
  assert.deepEqual(result.plans, [{ courses: ["甲", "乙"] }]);
  assert.deepEqual(Object.keys(result), ["plans", "__proto__", "unknown"]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(result.__proto__, { safe: true });
  assert.deepEqual(new Set(manifestJsonSourceFiles(f.root)), new Set([
    f.root, ...[leaf, middle, first, second].map((part) => path.join(f.store, `${part.sha256}.json`)),
  ]));
});

test("合法共享分片可多次引用且不会被判为循环或去重", (t) => {
  const f = fixture(t);
  const shared = f.part([{ record_id: "same" }]);
  f.rootValue({ left: wrapper("array", [shared, shared]), right: wrapper("array", [shared]) });
  assert.deepEqual(readManifestJson(f.root), {
    left: [{ record_id: "same" }, { record_id: "same" }], right: [{ record_id: "same" }],
  });
});

test("保留键、版本、类型、空引用和额外字段无效时抛错", (t) => {
  const f = fixture(t);
  const part = f.part([]);
  for (const invalid of [
    { $fireworks_shards: 2, kind: "array", parts: [part] },
    { $fireworks_shards: 1 }, wrapper("other", [part]), wrapper("array", []),
    { $fireworks_shards: 1, kind: "array", parts: {} },
    { ...wrapper("array", [part]), extra: true },
  ]) {
    f.rootValue({ nested: invalid });
    assert.throws(() => readManifestJson(f.root), /分片协议无效/);
  }
});

test("拒绝非法哈希、路径字段及负数、溢出或超限字节数", (t) => {
  const f = fixture(t);
  const valid = f.part([]);
  for (const invalid of [
    { ...valid, sha256: "../escape" }, { ...valid, sha256: "A".repeat(64) },
    { ...valid, sha256: "/absolute" }, { ...valid, path: "../outside.json" },
    ...[-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, 8 * 1024 * 1024 + 1, "2"].map((bytes) => ({ ...valid, bytes })),
  ]) {
    f.rootValue(wrapper("array", [invalid]));
    assert.throws(() => readManifestJson(f.root), /分片引用/);
  }
});

test("缺失分片、错误字节数及哈希不符均阻止读取", (t) => {
  const f = fixture(t);
  const part = f.part([1]);
  f.rootValue(wrapper("array", [{ ...part, bytes: part.bytes + 1 }]));
  assert.throws(() => readManifestJson(f.root), /字节数/);
  f.rootValue(wrapper("array", [part]));
  fs.writeFileSync(path.join(f.store, `${part.sha256}.json`), "[2]");
  assert.throws(() => readManifestJson(f.root), /哈希/);
  fs.unlinkSync(path.join(f.store, `${part.sha256}.json`));
  assert.throws(() => readManifestJson(f.root), /无法读取源文件/);
});

test("对象跨分片重复键和分片类型不匹配均抛错", (t) => {
  const f = fixture(t);
  f.rootValue(wrapper("object", [f.part({ same: 1 }), f.part({ same: 2 })]));
  assert.throws(() => readManifestJson(f.root), /重复键/);
  for (const [kind, value] of [["array", {}], ["object", []], ["array", null], ["object", "text"]] as const) {
    f.rootValue(wrapper(kind, [f.part(value)]));
    assert.throws(() => readManifestJson(f.root), /分片内容不是/);
  }
});

test("同一路径共享解析缓存且根变化后返回新内容", (t) => {
  const f = fixture(t);
  f.rootValue({ value: 1 });
  const first = readManifestJson(f.root);
  assert.equal(readManifestJson(path.join(f.directory, ".", "manifest.json")), first);
  f.rootValue({ value: 200 });
  assert.deepEqual(readManifestJson(f.root), { value: 200 });
  assert.notEqual(readManifestJson(f.root), first);
});

test("独立 Vite 构建入口共享解析结果且分片变化后共同失效", { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const part = f.part([{ record_id: "shared-record" }]);
  f.rootValue(wrapper("array", [part]));
  const source = path.resolve(import.meta.dirname, "../.vitepress/theme/manifest-store.ts");
  const loaders = await Promise.all(["first", "second"].map(async (name) => {
    const file = path.join(f.directory, `${name}.mts`);
    fs.writeFileSync(file, `import { readManifestJson } from ${JSON.stringify(source)};\nexport default { load: () => readManifestJson(${JSON.stringify(f.root)}) };\n`);
    const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, file);
    assert.ok(loaded);
    return loaded.config as { load(): unknown };
  }));
  const first = loaders[0].load();
  assert.equal(loaders[1].load(), first);
  fs.writeFileSync(path.join(f.store, `${part.sha256}.json`), "[0]");
  for (const loader of loaders) assert.throws(() => loader.load(), /字节数|哈希/);
  f.part([{ record_id: "shared-record" }]);
  const restored = loaders[1].load();
  assert.deepEqual(restored, first);
  assert.notEqual(restored, first);
  assert.equal(loaders[0].load(), restored);
});

test("缓存后分片篡改或删除不会返回过期数据，修复后可恢复", (t) => {
  const f = fixture(t);
  const part = f.part([1]);
  f.rootValue(wrapper("array", [part]));
  assert.deepEqual(readManifestJson(f.root), [1]);
  const file = path.join(f.store, `${part.sha256}.json`);
  fs.writeFileSync(file, "[2]");
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.throws(() => readManifestJson(f.root), /哈希/);
  f.part([1]);
  assert.deepEqual(readManifestJson(f.root), [1]);
  fs.unlinkSync(file);
  assert.throws(() => readManifestJson(f.root), /无法读取源文件/);
});

test("缓存后的存储目录替换为越界联接时拒绝读取", (t) => {
  const f = fixture(t);
  const part = f.part([1]);
  f.rootValue(wrapper("array", [part]));
  assert.deepEqual(readManifestJson(f.root), [1]);
  const outside = path.join(f.directory, "outside");
  fs.renameSync(f.store, outside);
  fs.symlinkSync(outside, f.store, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readManifestJson(f.root), /符号链接或目录联接/);
});

test("分片文件符号链接即使内容和哈希有效也会拒绝", (t) => {
  const f = fixture(t);
  const part = f.part([1]);
  const file = path.join(f.store, `${part.sha256}.json`);
  const outside = path.join(f.directory, "outside.json");
  fs.renameSync(file, outside);
  try {
    fs.symlinkSync(outside, file, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    t.skip("当前系统未授予创建文件符号链接权限");
    return;
  }
  f.rootValue(wrapper("array", [part]));
  assert.throws(() => readManifestJson(f.root), /符号链接或目录联接/);
});

test("深层分片链明确报错而非递归栈溢出", (t) => {
  const f = fixture(t);
  let value: unknown = [];
  for (let index = 0; index < 260; index++) value = wrapper("array", [f.part([value])]);
  f.rootValue(value);
  assert.throws(() => readManifestJson(f.root), /层级过深/);
});

test("根及单个分片内的重复键包含转义等价键均拒绝", (t) => {
  const f = fixture(t);
  for (const content of ['{"key":1,"key":2}', '{"nested":{"key":1,"\\u006bey":2}}']) {
    fs.writeFileSync(f.root, content);
    assert.throws(() => readManifestJson(f.root), /重复键/);
    const bytes = Buffer.from(content);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(path.join(f.store, `${sha256}.json`), bytes);
    f.rootValue(wrapper("object", [{ sha256, bytes: bytes.length }]));
    assert.throws(() => readManifestJson(f.root), /重复键/);
  }
});

test("JSON 键扫描不会将字符串内容或不同对象同名键视作重复", (t) => {
  const f = fixture(t);
  const original = { key: '"key":1,\\"key\\":2', nested: { key: 2 }, list: [{ key: 3 }, { key: 4 }] };
  f.rootValue(original);
  assert.deepEqual(readManifestJson(f.root), original);
});

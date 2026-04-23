# OpenList GitHub Driver 准确修改时间增强设计

## 背景

当前 OpenList 的 GitHub Driver 在目录列表场景下会把 `model.Object.Modified` 固定写成 `time.Unix(0, 0)`，导致下游看到的修改时间恒为 `1970-01-01T00:00:00Z`。本地项目已经验证这一点：请求链路和字段映射正常，问题源头在上游 Driver。

本设计不把它表述成“默认行为必须立刻修正的 bugfix”，而是把它定义为一个默认关闭、显式开启的 best-effort 准确 mtime 增强能力。这样可以同时满足准确性诉求与上游兼容性诉求。

## 目标

1. 在显式启用新能力时，为 GitHub Driver 的目录列表返回 best-effort 的真实最近修改时间。
2. 尽量减少额外 GitHub API 请求，避免明显放大 rate-limit 压力。
3. 不改变现有用户的默认行为，提升上游接受补丁的概率。
4. 当未配置 token、达到保守阈值或遇到 GraphQL 失败时快速止损，不继续额外时间查询逻辑。
5. 当附加查询失败时，不影响列表功能，回退到现有 zero-time 行为。
6. 只改变 `modified` 的增强语义，不顺带改变 `created` 的旧语义。

## 非目标

1. 不修改 OpenList 的通用列表响应结构。
2. 不尝试为所有 Driver 抽象统一的 mtime 补齐框架。
3. 不在默认配置下无感增加额外请求成本。
4. 不保证所有目录、所有条目、所有 GitHub 环境都一定返回真实时间。

## 方案对比

### 方案 A：REST `commits?path=` 逐条查询

优点：实现简单，完全复用现有 REST client。

缺点：请求数与目录项数量线性增长，目录稍大就会明显增加延迟与 rate-limit 压力。

### 方案 B：GraphQL 批量 `history(first: 1, path: ...)`

优点：可在单次请求中批量获取多个路径最近一次触达该路径的提交时间，整体请求数更低。

缺点：需要新增 GraphQL 查询构造、alias 解析与批处理逻辑，实现复杂度较高。

### 方案 C：仅修正 1970 语义，不补真实时间

优点：最稳，不增加请求。

缺点：无法满足“优先准确”的需求。

## 选定方案

采用方案 B，并增加显式开关控制：

1. 在 GitHub Driver `Addition` 中新增可选配置，例如 `accurate_modified_time`。
2. 默认值为 `false`，保持现有行为不变。
3. 开启后，在 `List()` 拿到目录项之后批量查询最近提交时间，并回填到 `model.Object.Modified`。
4. 如果未配置 token，则在实际查询阶段快速退出，直接跳过该能力并保留现有 zero-time 逻辑。这里的 fast-fail 是防御性运行时分支，不改变 `meta.go` 对 token 的既有配置约束。
5. 该能力只面向当前 `github.com` GitHub Driver 的固定 API 端点；GraphQL 不可用、权限不足、rate-limit、超时、schema/transport 异常都视为非致命失败，只回退旧行为。

## 详细设计

### 配置

新增公开配置项：

1. `accurate_modified_time: bool`

该配置项需要在 `meta.go` 中提供明确 help 文案，至少说明：

1. 这是 best-effort 的准确 mtime 增强。
2. 默认关闭。
3. 开启后会增加额外 GitHub GraphQL 请求。
4. 查询失败时会保留旧的 zero-time 行为。

内部保守常量：

1. `mtimeBatchSize = 50`
2. `mtimeMaxEntries = 200`

这组常量的成本意图是：把单次 list 的最坏附加 GraphQL 请求数控制在 4 个 batch 以内。

其中：

1. `accurate_modified_time=false` 时，完全保持当前实现。
2. `accurate_modified_time=true` 且 token 为空时，快速跳过补时间逻辑，不做额外请求。
3. 当前目录条目数超过 `mtimeMaxEntries` 时，直接跳过增强逻辑并记录低噪音日志，避免把一次 list 放大成大量 GraphQL 请求。
4. `mtimeBatchSize` 和 `mtimeMaxEntries` 先作为内部实现常量，不额外扩大公开配置面。

### 可测试的实现边界

为保证后续 TDD 和实现计划可落地，增强逻辑应拆成可测试 helper，而不是直接把所有逻辑塞回 `List()`。建议至少形成以下边界：

1. `shouldUseAccurateMtime()`：判断开关、token、目录大小阈值。
2. `collectMtimePaths()`：从 `contents` / `tree` 两个分支提取用于查询的规范化 repo path。
3. `buildMtimeBatchQuery()`：为一批 path 生成 GraphQL query 与 alias 映射。
4. `parseMtimeBatchResult()`：把 GraphQL 返回解析成 `path -> time.Time` 映射。
5. `applyModifiedTimes()`：将命中的时间回填到 `model.Object.Modified`，并显式保持 `Ctime` 旧语义不变。

### List 流程

1. 继续沿用现有 `contents` / `git/trees` 获取目录项。
2. 先把目录项转换为 `model.Obj` 列表。
3. 若未开启 `accurate_modified_time`，直接返回。
4. 若 token 为空，直接返回，不进入 GraphQL。
5. 若当前目录条目数大于 `mtimeMaxEntries`，直接返回，不进入 GraphQL。
6. 收集当前目录下所有条目的规范化 repo path。
7. v1 在当前 `mtimeMaxEntries=200` 的保守策略下，实际只会对 `contents` 分支执行准确 mtime 增强；触发 `tree` fallback 的目录会在阈值检查处止损并直接返回旧行为。
8. `contents` 分支直接使用对象自身 path；`tree` fallback 分支的 path 规范仍需在 helper 中定义为 `stdpath.Join(dir.GetPath(), t.Path)` 后再清理，避免未来放宽阈值时出现非根目录 path 误拼。
9. 查询前需要把当前 `ref` 解析到稳定 commit 语义；若 `ref` 指向 tag，需要在 GraphQL 层明确 peel 到 commit 后再查询 `history`。
10. 按 `mtimeBatchSize` 分批调用 GitHub GraphQL。
11. 查询当前 `ref` 对应 commit 的 `history(first: 1, path: ...)`，取每个 path 最近一次提交的 `committedDate`。
12. 每一批以 alias/path 映射回填结果，不允许依赖返回顺序。
13. 将命中的时间回填到对应 `model.Object.Modified`。
14. `Ctime` 必须显式保持当前 API 可见的 legacy 值，不随本次增强一起变成伪“创建时间”。
15. 一旦某批出现 transport、鉴权、权限、rate-limit、resource-limit、timeout 或 GraphQL 顶层错误，立即停止当前列表剩余批次；已成功回填的前序批次保留，其余条目继续 zero time fallback。
16. 该止损只影响增强逻辑，不影响 `List()` 主流程成功返回。

### GraphQL 传输约束

1. GraphQL 请求走 `https://api.github.com/graphql`。
2. 认证继续复用现有 Bearer token。
3. GraphQL 请求使用独立 JSON body，而不是直接复用当前 `application/vnd.github.object+json` 的 REST 解析假设。
4. 需要读取响应头中的 rate-limit 信息，用于日志与止损判断。

### 路径与对象范围

1. 文件 path 查询其文件自身最近一次提交时间。
2. 目录 path 查询其目录范围内最近一次变更时间，而不是传统文件系统意义上的目录 mtime。
3. `tree` fallback 的 path 规则在 v1 作为 helper 约束保留，为未来放宽阈值时复用；当前版本不要求对 `tree` 分支执行实际增强。

### 用户可见语义

1. 这是 best-effort 增强，不承诺所有条目都拿到真实时间。
2. 同一个列表响应中允许同时出现真实 `modified` 和 zero-time `modified`。
3. 按 `modified` 排序时，zero-time 条目继续按旧语义参与排序。
4. `created` 不作为本次增强目标，应保持当前 API 可见的 legacy 值，避免让 API 消费方误以为拿到了真实创建时间。

### 缓存关系

1. v1 设计依赖现有 `op.List` 目录缓存减少重复请求。
2. 准确 mtime 的最坏成本主要出现在 cache miss、显式 refresh、或存储禁用缓存时。
3. 本次设计不额外引入独立 mtime cache。
4. 当目录缓存命中时，不应重复发起 GraphQL 查询。

### 失败策略

1. token 为空：快速退出，不发 GraphQL 请求。
2. 目录条目数超过 `mtimeMaxEntries`：快速退出，不发 GraphQL 请求。
3. GraphQL transport/auth/permission/rate-limit/resource-limit/timeout 失败：停止剩余批次并回退未完成部分。
4. GraphQL 顶层 `errors`：视为该批失败，不应用该批 partial data。
5. 某个 path 无历史记录或 alias 缺失：仅该条目保留 zero time。
6. 当响应头表明剩余额度耗尽或需要等待重置时：停止剩余批次，不继续请求。
7. 记录低噪音日志，日志应包含目录路径、条目数、已执行批次数和止损原因。

## 验证计划

1. 为 `shouldUseAccurateMtime`、`collectMtimePaths`、`buildMtimeBatchQuery`、`parseMtimeBatchResult`、`applyModifiedTimes` 添加单元测试。
2. 覆盖 `accurate_modified_time=false` 的完全无变化路径：零额外 GraphQL 调用，输出字段和旧行为一致。
3. 覆盖“开启但无 token”“开启但条目数超过阈值”“开启且查询成功”“首批失败止损”“中途某批失败止损”。
4. 覆盖 GraphQL `errors`、alias 缺失、单个 path 空 history、结果顺序与输入顺序不同。
5. `contents` 分支覆盖成功增强行为用例；`tree` 分支在 v1 只要求覆盖“超过阈值时直接止损且零 GraphQL 调用”的行为用例。
6. `tree` 分支的 path 拼接规则放到 `collectMtimePaths()` helper 单元测试中验证，且必须是非根目录场景。
7. 增加一个目录缓存命中场景，断言不会重复发起 GraphQL 查询。
8. 明确区分 helper 级单元测试与 `List()` 级行为测试；后者使用 HTTP transport stub 验证请求数、止损和回填结果。

## 风险

1. GraphQL schema 与 REST 不同，解析代码更脆弱。
2. 即使有批处理和阈值保护，启用后仍会增加一定额外延迟。
3. 目录 path 的 `history(path=dir)` 语义依赖 GitHub 的路径过滤行为，需要测试锁定。
4. 该能力默认关闭，有助于兼容性，但也意味着它更像增强能力而不是默认修复。

## 预期结果

在显式启用配置且 token 可用、目录规模处于保守阈值内时，GitHub Driver 可以为目录列表返回 best-effort 的真实最近修改时间；未启用、超出阈值、无 token 或查询失败时，保持当前兼容行为。

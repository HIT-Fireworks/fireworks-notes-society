# OpenList GitHub Driver 准确修改时间增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OpenList 的 GitHub Driver 增加一个默认关闭、显式开启的 accurate modified time 增强，在小型目录上用 GitHub GraphQL best-effort 回填真实 `modified`，同时保留 legacy `created` 与所有失败回退语义。

**Architecture:** 在 `drivers/github` 内新增一层 mtime helper，把开关判断、路径收集、GraphQL query 构造、结果解析与回填从 `List()` 中拆开。`List()` 只在 `contents` 分支、小目录、token 非空时触发增强；GraphQL 任何 transport/auth/rate-limit/top-level error 都立即止损，但不影响列表返回；目录缓存继续由 `internal/op.List` 负责，缓存命中时不重复请求 GraphQL。

**Tech Stack:** Go 1.24、resty v2、GitHub REST + GraphQL、OpenList `internal/op` 目录缓存。

---

## 工作区与约束

- 外层隔离 worktree：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\openlist-github-mtime`
- 实际上游代码仓库：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\openlist-github-mtime\upstream\OpenList`
- 设计文档：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\specs\2026-04-21-openlist-github-mtime-design.md`
- 当前仓库自己的 `pnpm docs:build` 基线会因为 `.vitepress/theme/components/alist.data.mts` 构建期外部请求失败；不要把这个前端构建当成 OpenList Go 补丁的验收条件。
- 除非用户随后明确要求，否则不要创建 git commit。

## 文件结构

- 修改：`upstream/OpenList/drivers/github/meta.go`
  责任：新增 `accurate_modified_time` 开关及 help 文案。
- 修改：`upstream/OpenList/drivers/github/types.go`
  责任：把 GitHub Driver 现有 zero-time 语义显式落到 `Ctime`，避免 `modified` 增强时连带改变 API 可见的 `created`。
- 新建：`upstream/OpenList/drivers/github/mtime.go`
  责任：集中放置 accurate mtime 的 helper、GraphQL query/body/response 解析、批处理止损逻辑。
- 修改：`upstream/OpenList/drivers/github/driver.go`
  责任：在 `List()` 的 `contents` 分支接入 accurate mtime helper，并在 `tree` fallback / 超阈值 / token 为空时保留旧行为。
- 新建：`upstream/OpenList/drivers/github/mtime_test.go`
  责任：helper 级单测、`List()` 级 transport stub 测试、`op.List` 缓存命中回归测试。

## 先决操作

### Task 0: 准备上游分支

**Files:**
- Working repo: `upstream/OpenList`

- [ ] **Step 1: 在上游副本中创建工作分支**

Run: `git checkout -b opencode/github-accurate-mtime`
Expected: 输出 `Switched to a new branch 'opencode/github-accurate-mtime'`

- [ ] **Step 2: 记录当前验证命令基线**

Run: `go test ./drivers/github`
Expected: 当前没有 GitHub driver 专项测试，命令应以 `ok` 或 `?` 成功结束。

### Task 1: 落地配置、legacy 时间语义与纯 helper 边界

**Files:**
- Create: `upstream/OpenList/drivers/github/mtime.go`
- Create: `upstream/OpenList/drivers/github/mtime_test.go`
- Modify: `upstream/OpenList/drivers/github/meta.go:8-27`
- Modify: `upstream/OpenList/drivers/github/types.go:16-76`

- [ ] **Step 1: 先写失败测试，锁定开关判断、路径收集和 legacy `created` 语义**

```go
package github

import (
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

func TestShouldUseAccurateMtime(t *testing.T) {
	tests := []struct {
		name      string
		enabled   bool
		token     string
		entryCount int
		want      bool
		wantReason string
	}{
		{name: "disabled", enabled: false, token: "token", entryCount: 2, want: false, wantReason: "disabled"},
		{name: "missing token", enabled: true, token: "   ", entryCount: 2, want: false, wantReason: "missing_token"},
		{name: "over limit", enabled: true, token: "token", entryCount: 201, want: false, wantReason: "entry_limit"},
		{name: "enabled", enabled: true, token: "token", entryCount: 200, want: true, wantReason: ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, reason := shouldUseAccurateMtime(tc.enabled, tc.token, tc.entryCount)
			if got != tc.want || reason != tc.wantReason {
				t.Fatalf("got (%v, %q), want (%v, %q)", got, reason, tc.want, tc.wantReason)
			}
		})
	}
}

func TestCollectMtimePaths(t *testing.T) {
	contents := collectMtimePaths("/docs", []Object{{Path: "docs/a.md"}, {Path: "/docs/b.md"}}, nil)
	if len(contents) != 2 || contents[0] != "/docs/a.md" || contents[1] != "/docs/b.md" {
		t.Fatalf("unexpected contents paths: %#v", contents)
	}

	tree := collectMtimePaths("/docs/sub", nil, []TreeObjResp{{TreeObjReq: TreeObjReq{Path: "a.md"}}, {TreeObjReq: TreeObjReq{Path: "dir/b.md"}}})
	if len(tree) != 2 || tree[0] != "/docs/sub/a.md" || tree[1] != "/docs/sub/dir/b.md" {
		t.Fatalf("unexpected tree paths: %#v", tree)
	}
}

func TestApplyModifiedTimesPreservesLegacyCreateTime(t *testing.T) {
	obj := &model.Object{Name: "a.md", Path: "/docs/a.md", Modified: githubZeroTime, Ctime: githubZeroTime}
	other := &model.Object{Name: "b.md", Path: "/docs/b.md", Modified: githubZeroTime, Ctime: githubZeroTime}
	stamp := time.Date(2025, 12, 22, 4, 52, 41, 0, time.UTC)

	applyModifiedTimes([]model.Obj{obj, other}, map[string]time.Time{"/docs/a.md": stamp})

	if !obj.Modified.Equal(stamp) {
		t.Fatalf("modified not updated: %v", obj.Modified)
	}
	if !obj.CreateTime().Equal(githubZeroTime) {
		t.Fatalf("created should stay legacy zero time: %v", obj.CreateTime())
	}
	if !other.Modified.Equal(githubZeroTime) {
		t.Fatalf("unmatched path should stay zero time: %v", other.Modified)
	}
}

func TestDriverInfoIncludesAccurateModifiedTimeDefault(t *testing.T) {
	info := op.GetDriverInfoMap()["GitHub API"]
	var found bool
	for _, item := range info.Additional {
		if item.Name != "accurate_modified_time" {
			continue
		}
		found = true
		if item.Default != "false" {
			t.Fatalf("unexpected default: %q", item.Default)
		}
		if !strings.Contains(item.Help, "Best-effort") {
			t.Fatalf("unexpected help: %q", item.Help)
		}
	}
	if !found {
		t.Fatal("accurate_modified_time item not registered")
	}
}
```

- [ ] **Step 2: 运行测试，确认 helper 还不存在且测试失败**

Run: `go test ./drivers/github -run "TestShouldUseAccurateMtime|TestCollectMtimePaths|TestApplyModifiedTimesPreservesLegacyCreateTime|TestDriverInfoIncludesAccurateModifiedTimeDefault"`
Expected: FAIL，报出 `undefined: shouldUseAccurateMtime`、`undefined: collectMtimePaths`、`undefined: applyModifiedTimes` 或等价未实现错误。

- [ ] **Step 3: 先落地最小实现骨架，并把 legacy `created` 固定下来**

`upstream/OpenList/drivers/github/meta.go`

```go
type Addition struct {
	driver.RootPath
	Token                string `json:"token" type:"string" required:"true"`
	Owner                string `json:"owner" type:"string" required:"true"`
	Repo                 string `json:"repo" type:"string" required:"true"`
	Ref                  string `json:"ref" type:"string" help:"A branch, a tag or a commit SHA, main branch by default."`
	AccurateModifiedTime bool   `json:"accurate_modified_time" type:"bool" default:"false" help:"Best-effort accurate modified time for small directory listings. Default disabled. Adds extra GitHub GraphQL requests and falls back to legacy zero-time values on failure."`
	GitHubProxy          string `json:"gh_proxy" type:"string" help:"GitHub proxy, e.g. https://ghproxy.net/raw.githubusercontent.com or https://gh-proxy.com/raw.githubusercontent.com"`
	// ... keep existing fields unchanged
}
```

`upstream/OpenList/drivers/github/types.go`

```go
func (o *Object) toModelObj() *model.Object {
	return &model.Object{
		Name:     o.Name,
		Size:     o.Size,
		Modified: githubZeroTime,
		Ctime:    githubZeroTime,
		IsFolder: o.Type == "dir",
		Path:     utils.FixAndCleanPath(o.Path),
	}
}

func (o *TreeObjResp) toModelObj() *model.Object {
	return &model.Object{
		Name:     o.Path,
		Size:     o.Size,
		Modified: githubZeroTime,
		Ctime:    githubZeroTime,
		IsFolder: o.Type == "tree",
		Path:     utils.FixAndCleanPath(o.Path),
	}
}
```

`upstream/OpenList/drivers/github/mtime.go`

```go
package github

import (
	stdpath "path"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
)

const (
	mtimeBatchSize = 50
	mtimeMaxEntries = 200
	githubGraphQLEndpoint = "https://api.github.com/graphql"
)

var githubZeroTime = time.Unix(0, 0)

func shouldUseAccurateMtime(enabled bool, token string, entryCount int) (bool, string) {
	switch {
	case !enabled:
		return false, "disabled"
	case strings.TrimSpace(token) == "":
		return false, "missing_token"
	case entryCount > mtimeMaxEntries:
		return false, "entry_limit"
	default:
		return true, ""
	}
}

func collectMtimePaths(dirPath string, contents []Object, tree []TreeObjResp) []string {
	if len(contents) > 0 {
		paths := make([]string, 0, len(contents))
		for _, entry := range contents {
			paths = append(paths, utils.FixAndCleanPath(entry.Path))
		}
		return paths
	}
	paths := make([]string, 0, len(tree))
	for _, entry := range tree {
		paths = append(paths, utils.FixAndCleanPath(stdpath.Join(dirPath, entry.Path)))
	}
	return paths
}

func applyModifiedTimes(objs []model.Obj, modified map[string]time.Time) {
	for _, obj := range objs {
		raw, ok := obj.(*model.Object)
		if !ok {
			continue
		}
		if stamp, exists := modified[raw.GetPath()]; exists {
			raw.Modified = stamp
		}
		if raw.Ctime.IsZero() {
			raw.Ctime = githubZeroTime
		}
	}
}
```

- [ ] **Step 4: 再跑一轮 helper 测试，确认骨架通过**

Run: `go test ./drivers/github -run "TestShouldUseAccurateMtime|TestCollectMtimePaths|TestApplyModifiedTimesPreservesLegacyCreateTime|TestDriverInfoIncludesAccurateModifiedTimeDefault"`
Expected: PASS

### Task 2: 先解析稳定 commit，再写 GraphQL query / parser，并把失败语义锁死

**Files:**
- Modify: `upstream/OpenList/drivers/github/mtime.go`
- Modify: `upstream/OpenList/drivers/github/mtime_test.go`

- [ ] **Step 1: 写失败测试，锁定 query 结构、tag peel、top-level error 与 alias/empty-history 行为**

```go
func TestBuildMtimeBatchQueryIncludesCommitAndTagPaths(t *testing.T) {
	query, aliasToPath := buildMtimeBatchQuery("owner", "repo", "release", []string{"/docs/a.md", "/docs/dir"})

	if aliasToPath["p0"] != "/docs/a.md" || aliasToPath["p1"] != "/docs/dir" {
		t.Fatalf("unexpected alias map: %#v", aliasToPath)
	}
	for _, want := range []string{
		`repository(owner: "owner", name: "repo")`,
		`object(expression: "release")`,
		`... on Commit {`,
		`oid`,
		`... on Tag {`,
		`target {`,
		`p0: history(first: 1, path: "docs/a.md")`,
		`p1: history(first: 1, path: "docs/dir")`,
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("query missing %q:\n%s", want, query)
		}
	}
}

func TestParseMtimeBatchResultReturnsStableCommitAndHandlesAliasLoss(t *testing.T) {
	body := []byte(`{
		"data": {
			"repository": {
				"refTarget": {
					"__typename": "Tag",
					"target": {
						"__typename": "Commit",
						"oid": "abc123",
						"p0": {"nodes": [{"committedDate": "2025-12-22T04:52:41Z"}]},
						"p1": {"nodes": []}
					}
				}
			}
		}
	}`)

	commitExpr, got, err := parseMtimeBatchResult(body, map[string]string{"p0": "/docs/a.md", "p1": "/docs/b.md", "p2": "/docs/c.md"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if commitExpr != "abc123" {
		t.Fatalf("expected resolved commit expr, got %q", commitExpr)
	}
	if _, ok := got["/docs/a.md"]; !ok {
		t.Fatalf("expected p0 timestamp in %#v", got)
	}
	if _, ok := got["/docs/b.md"]; ok {
		t.Fatalf("empty history should not backfill: %#v", got)
	}
	if _, ok := got["/docs/c.md"]; ok {
		t.Fatalf("missing alias should be ignored: %#v", got)
	}
}

func TestParseMtimeBatchResultRejectsTopLevelErrors(t *testing.T) {
	_, _, err := parseMtimeBatchResult([]byte(`{"errors":[{"message":"rate limited"}]}`), map[string]string{"p0": "/docs/a.md"})
	if err == nil {
		t.Fatal("expected top-level GraphQL errors to fail the whole batch")
	}
}
```

- [ ] **Step 2: 运行测试，确认 query / parser 仍未实现**

Run: `go test ./drivers/github -run "TestBuildMtimeBatchQueryIncludesCommitAndTagPaths|TestParseMtimeBatchResultReturnsStableCommitAndHandlesAliasLoss|TestParseMtimeBatchResultRejectsTopLevelErrors"`
Expected: FAIL，报出 `undefined: buildMtimeBatchQuery`、`undefined: parseMtimeBatchResult` 或等价断言失败。

- [ ] **Step 3: 实现 query builder 与 parser，不依赖返回顺序**

`upstream/OpenList/drivers/github/mtime.go`

```go
type graphQLHistoryNode struct {
	CommittedDate time.Time `json:"committedDate"`
}

type graphQLHistory struct {
	Nodes []graphQLHistoryNode `json:"nodes"`
}

type graphQLBatchResponse struct {
	Data struct {
		Repository struct {
			RefTarget map[string]any `json:"refTarget"`
		} `json:"repository"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func buildMtimeBatchQuery(owner, repo, expression string, paths []string) (string, map[string]string) {
	aliasToPath := make(map[string]string, len(paths))
	fields := make([]string, 0, len(paths))
	for i, path := range paths {
		alias := fmt.Sprintf("p%d", i)
		normalized := utils.FixAndCleanPath(path)
		aliasToPath[alias] = normalized
		fields = append(fields, fmt.Sprintf(`%s: history(first: 1, path: %q) { nodes { committedDate } }`, alias, strings.TrimPrefix(normalized, "/")))
	}
	joined := strings.Join(fields, "\n")
	return fmt.Sprintf(`query {
		repository(owner: %q, name: %q) {
			refTarget: object(expression: %q) {
				__typename
				... on Commit {
					oid
					%s
				}
				... on Tag {
					target {
						__typename
						... on Commit {
							oid
							%s
						}
					}
				}
			}
		}
	}` , owner, repo, expression, joined, joined), aliasToPath
}

func parseMtimeBatchResult(body []byte, aliasToPath map[string]string) (string, map[string]time.Time, error) {
	var resp graphQLBatchResponse
	if err := utils.Json.Unmarshal(body, &resp); err != nil {
		return "", nil, err
	}
	if len(resp.Errors) > 0 {
		return "", nil, fmt.Errorf("graphql returned %d top-level errors", len(resp.Errors))
	}
	node := resp.Data.Repository.RefTarget
	if node == nil {
		return "", nil, fmt.Errorf("graphql returned empty ref target")
	}
	if node["__typename"] == "Tag" {
		target, ok := node["target"].(map[string]any)
		if !ok {
			return "", nil, fmt.Errorf("tag target is not a commit")
		}
		node = target
	}
	commitExpr, ok := node["oid"].(string)
	if !ok || commitExpr == "" {
		return "", nil, fmt.Errorf("graphql did not resolve a commit oid")
	}
	result := make(map[string]time.Time, len(aliasToPath))
	for alias, path := range aliasToPath {
		rawHistory, ok := node[alias]
		if !ok {
			continue
		}
		encoded, err := utils.Json.Marshal(rawHistory)
		if err != nil {
			return "", nil, err
		}
		var history graphQLHistory
		if err := utils.Json.Unmarshal(encoded, &history); err != nil {
			return "", nil, err
		}
		if len(history.Nodes) == 0 {
			continue
		}
		result[path] = history.Nodes[0].CommittedDate
	}
	return commitExpr, result, nil
}
```

- [ ] **Step 4: 再跑 query / parser 测试**

Run: `go test ./drivers/github -run "TestBuildMtimeBatchQueryIncludesCommitAndTagPaths|TestParseMtimeBatchResultReturnsStableCommitAndHandlesAliasLoss|TestParseMtimeBatchResultRejectsTopLevelErrors"`
Expected: PASS

### Task 3: 把 accurate mtime 接进 `List()`，并补 transport / cache 行为测试

**Files:**
- Modify: `upstream/OpenList/drivers/github/driver.go:134-165,669-879`
- Modify: `upstream/OpenList/drivers/github/mtime.go`
- Modify: `upstream/OpenList/drivers/github/mtime_test.go`

- [ ] **Step 1: 先写 `List()` 级行为测试与 `op.List` 缓存回归测试**

```go
import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	odriver "github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/go-resty/resty/v2"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func newGithubTestDriver(rt roundTripFunc, token string, enabled bool) *Github {
	return &Github{
		Storage: model.Storage{MountPath: "/github-test", CacheExpiration: 10},
		Addition: Addition{
			RootPath: odriver.RootPath{RootFolderPath: "/"},
			Token: token,
			Owner: "owner",
			Repo: "repo",
			Ref: "main",
			AccurateModifiedTime: enabled,
		},
		client: resty.New().SetTransport(rt),
	}
}

func newJSONResponse(status int, headers map[string]string, body string) *http.Response {
	h := make(http.Header)
	for key, value := range headers {
		h.Set(key, value)
	}
	return &http.Response{
		StatusCode: status,
		Header:     h,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestListAppliesAccurateModifiedTimeAndKeepsLegacyCreated(t *testing.T) {
	graphqlCalls := 0
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
			switch {
			case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
				return newJSONResponse(200, nil, `{"type":"dir","sha":"tree-sha","entries":[{"name":"a.md","path":"docs/a.md","type":"file","size":1},{"name":"b.md","path":"docs/b.md","type":"file","size":1}]}`), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, map[string]string{"X-Ratelimit-Remaining": "42"}, `{"data":{"repository":{"refTarget":{"__typename":"Commit","oid":"abc123","p0":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p1":{"nodes":[]}}}}}`), nil
			default:
				return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
			}
		}), "token", true)

	objs, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 1 {
		t.Fatalf("expected one GraphQL batch, got %d", graphqlCalls)
	}
	first := objs[0].(*model.Object)
	if !first.ModTime().Equal(time.Date(2025, 12, 22, 4, 52, 41, 0, time.UTC)) {
		t.Fatalf("expected accurate modified time, got %v", first.ModTime())
	}
	if first.CreateTime() != githubZeroTime {
		t.Fatalf("created should stay legacy zero time: %v", first.CreateTime())
	}
}

func TestListStopsBeforeGraphQLForMissingTokenAndEntryLimit(t *testing.T) {
	for _, tc := range []struct {
		name string
		token string
		entries int
	}{
		{name: "missing token", token: "", entries: 1},
		{name: "entry limit", token: "token", entries: 201},
	} {
			t.Run(tc.name, func(t *testing.T) {
				graphqlCalls := 0
				entries := make([]string, 0, tc.entries)
				for i := 0; i < tc.entries; i++ {
					entries = append(entries, fmt.Sprintf(`{"name":"%d.md","path":"docs/%d.md","type":"file","size":1}`, i, i))
				}
				payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
				drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
					if r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint {
						graphqlCalls++
					}
					return newJSONResponse(200, nil, payload), nil
				}), tc.token, true)

				_, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if graphqlCalls != 0 {
				t.Fatalf("expected zero GraphQL calls, got %d", graphqlCalls)
			}
		})
	}
}

func TestListKeepsLegacyBehaviorWhenAccurateMtimeDisabled(t *testing.T) {
	graphqlCalls := 0
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, `{"type":"dir","sha":"tree-sha","entries":[{"name":"a.md","path":"docs/a.md","type":"file","size":1}]}`), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, nil, `{"data":{}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", false)

	objs, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 0 {
		t.Fatalf("disabled mode should make zero GraphQL calls, got %d", graphqlCalls)
	}
	if !objs[0].ModTime().Equal(githubZeroTime) || !objs[0].CreateTime().Equal(githubZeroTime) {
		t.Fatalf("disabled mode should preserve legacy timestamps: mod=%v create=%v", objs[0].ModTime(), objs[0].CreateTime())
	}
}

func TestListStopsAfterFirstFailedBatchAndKeepsRemainingZeroTime(t *testing.T) {
	graphqlCalls := 0
	entries := make([]string, 0, 51)
	for i := 0; i < 51; i++ {
		entries = append(entries, fmt.Sprintf(`{"name":"%02d.md","path":"docs/%02d.md","type":"file","size":1}`, i, i))
	}
	payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, payload), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(401, map[string]string{"X-Ratelimit-Remaining": "41"}, `{"message":"bad credentials"}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	objs, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 1 {
		t.Fatalf("expected stop after first failed batch, got %d calls", graphqlCalls)
	}
	for _, obj := range objs {
		if !obj.ModTime().Equal(githubZeroTime) {
			t.Fatalf("failed batch should keep zero time, got %v", obj.ModTime())
		}
	}
}

func TestListStopsAfterSecondBatchFailureAndKeepsFirstBatchBackfill(t *testing.T) {
	graphqlCalls := 0
	entries := make([]string, 0, 51)
	for i := 0; i < 51; i++ {
		entries = append(entries, fmt.Sprintf(`{"name":"%02d.md","path":"docs/%02d.md","type":"file","size":1}`, i, i))
	}
	payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, payload), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			if graphqlCalls == 1 {
				return newJSONResponse(200, map[string]string{"X-Ratelimit-Remaining": "41"}, `{"data":{"repository":{"refTarget":{"__typename":"Commit","oid":"abc123","p0":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p1":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p2":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p3":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p4":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p5":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p6":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p7":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p8":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p9":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p10":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p11":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p12":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p13":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p14":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p15":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p16":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p17":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p18":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p19":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p20":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p21":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p22":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p23":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p24":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p25":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p26":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p27":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p28":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p29":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p30":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p31":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p32":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p33":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p34":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p35":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p36":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p37":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p38":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p39":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p40":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p41":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p42":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p43":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p44":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p45":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p46":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p47":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p48":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]},"p49":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]}}}}}`), nil
			}
			return newJSONResponse(401, map[string]string{"X-Ratelimit-Remaining": "41"}, `{"message":"bad credentials"}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	objs, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 2 {
		t.Fatalf("expected two GraphQL calls, got %d", graphqlCalls)
	}
	for i, obj := range objs {
		if i < 50 && obj.ModTime().Equal(githubZeroTime) {
			t.Fatalf("first batch should stay backfilled at index %d", i)
		}
		if i == 50 && !obj.ModTime().Equal(githubZeroTime) {
			t.Fatalf("second batch failure should keep tail zero time, got %v", obj.ModTime())
		}
	}
}

func TestListStopsWhenRateLimitRemainingIsZero(t *testing.T) {
	graphqlCalls := 0
	entries := make([]string, 0, 51)
	for i := 0; i < 51; i++ {
		entries = append(entries, fmt.Sprintf(`{"name":"%02d.md","path":"docs/%02d.md","type":"file","size":1}`, i, i))
	}
	payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, payload), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, map[string]string{"X-Ratelimit-Remaining": "0"}, `{"data":{"repository":{"refTarget":{"__typename":"Commit","oid":"abc123","p0":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]}}}}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	_, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 1 {
		t.Fatalf("rate-limit header should stop remaining batches, got %d calls", graphqlCalls)
	}
}

func TestListUsesFourGraphQLBatchesAtEntryLimit(t *testing.T) {
	graphqlCalls := 0
	entries := make([]string, 0, 200)
	for i := 0; i < 200; i++ {
		entries = append(entries, fmt.Sprintf(`{"name":"%03d.md","path":"docs/%03d.md","type":"file","size":1}`, i, i))
	}
	payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, payload), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, map[string]string{"X-Ratelimit-Remaining": "42"}, `{"data":{"repository":{"refTarget":{"__typename":"Commit","oid":"abc123"}}}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	_, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graphqlCalls != 4 {
		t.Fatalf("200 entries should use exactly 4 batches, got %d", graphqlCalls)
	}
}

func TestListKeepsTreeFallbackOnLegacyPath(t *testing.T) {
	graphqlCalls := 0
	entries := make([]string, 0, 1000)
	for i := 0; i < 1000; i++ {
		entries = append(entries, fmt.Sprintf(`{"name":"dir-%d","path":"docs/dir-%d","type":"dir","size":0}`, i, i))
	}
	treeBody := `{"sha":"tree-sha","truncated":false,"tree":[{"path":"child.md","mode":"100644","type":"blob","sha":"blob-sha","size":1,"url":"https://example.invalid/blob"}]}`
	payload := fmt.Sprintf(`{"type":"dir","sha":"tree-sha","entries":[%s]}`, strings.Join(entries, ","))
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, payload), nil
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/git/trees/"):
			return newJSONResponse(200, nil, treeBody), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, nil, `{"data":{}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	objs, err := drv.List(context.Background(), &model.Object{Path: "/docs", Name: "docs", IsFolder: true}, model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(objs) != 1 || objs[0].GetPath() != "/child.md" {
		t.Fatalf("unexpected tree fallback result: %#v", objs)
	}
	if graphqlCalls != 0 {
		t.Fatalf("tree fallback should skip GraphQL, got %d calls", graphqlCalls)
	}
}

func TestOpListCacheHitDoesNotRepeatGraphQL(t *testing.T) {
	op.Cache.ClearAll()
	graphqlCalls := 0
	drv := newGithubTestDriver(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/contents/"):
			return newJSONResponse(200, nil, `{"type":"dir","sha":"tree-sha","entries":[{"name":"a.md","path":"a.md","type":"file","size":1}]}`), nil
		case r.Method == http.MethodPost && r.URL.String() == githubGraphQLEndpoint:
			graphqlCalls++
			return newJSONResponse(200, map[string]string{"X-Ratelimit-Remaining": "40"}, `{"data":{"repository":{"refTarget":{"__typename":"Commit","oid":"abc123","p0":{"nodes":[{"committedDate":"2025-12-22T04:52:41Z"}]}}}}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}), "token", true)

	first, err := op.List(context.Background(), drv, "/", model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected first list error: %v", err)
	}
	second, err := op.List(context.Background(), drv, "/", model.ListArgs{})
	if err != nil {
		t.Fatalf("unexpected second list error: %v", err)
	}
	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("unexpected cached results: first=%d second=%d", len(first), len(second))
	}
	if graphqlCalls != 1 {
		t.Fatalf("expected one GraphQL call across cached lists, got %d", graphqlCalls)
	}
}
```

- [ ] **Step 2: 运行行为测试，确认 `List()` 还没有增强逻辑**

Run: `go test ./drivers/github -run "TestList|TestOpListCacheHitDoesNotRepeatGraphQL"`
Expected: FAIL，至少会在 GraphQL 次数、`modified` 未回填、或缓存命中计数不符合预期处失败。

- [ ] **Step 3: 实现批量查询、rate-limit 止损与 `List()` 接线**

`upstream/OpenList/drivers/github/mtime.go`

```go
func (d *Github) fetchAccurateModifiedTimes(ctx context.Context, dirPath string, objs []model.Obj, contents []Object) {
	ok, reason := shouldUseAccurateMtime(d.AccurateModifiedTime, d.Token, len(objs))
	if !ok {
		if reason != "" {
			log.Debugf("github accurate mtime skipped for %s: %s", dirPath, reason)
		}
		return
	}

	paths := collectMtimePaths(dirPath, contents, nil)
	commitExpr := d.Ref
	for start := 0; start < len(paths); start += mtimeBatchSize {
		end := start + mtimeBatchSize
		if end > len(paths) {
			end = len(paths)
		}
		query, aliasToPath := buildMtimeBatchQuery(d.Owner, d.Repo, commitExpr, paths[start:end])
		res, err := d.client.R().
			SetContext(ctx).
			SetHeader("Accept", "application/vnd.github+json").
			SetBody(map[string]string{"query": query}).
			Post(githubGraphQLEndpoint)
		if err != nil {
			log.WithError(err).Warnf("github accurate mtime stopped for %s after %d/%d batches: transport", dirPath, start/mtimeBatchSize+1, (len(paths)+mtimeBatchSize-1)/mtimeBatchSize)
			return
		}
		if res.StatusCode() != http.StatusOK {
			log.Warnf("github accurate mtime stopped for %s after %d/%d batches: http_%d", dirPath, start/mtimeBatchSize+1, (len(paths)+mtimeBatchSize-1)/mtimeBatchSize, res.StatusCode())
			return
		}
		resolvedCommitExpr, modified, err := parseMtimeBatchResult(res.Body(), aliasToPath)
		if err != nil {
			log.WithError(err).Warnf("github accurate mtime stopped for %s after %d/%d batches: graphql", dirPath, start/mtimeBatchSize+1, (len(paths)+mtimeBatchSize-1)/mtimeBatchSize)
			return
		}
		commitExpr = resolvedCommitExpr
		applyModifiedTimes(objs, modified)
		if remaining := res.Header().Get("X-Ratelimit-Remaining"); remaining == "0" {
			log.Warnf("github accurate mtime stopped for %s after %d/%d batches: rate_limit", dirPath, start/mtimeBatchSize+1, (len(paths)+mtimeBatchSize-1)/mtimeBatchSize)
			return
		}
	}
}
```

`upstream/OpenList/drivers/github/driver.go`

```go
func (d *Github) List(ctx context.Context, dir model.Obj, args model.ListArgs) ([]model.Obj, error) {
	obj, err := d.get(dir.GetPath())
	if err != nil {
		return nil, err
	}
	if obj.Entries == nil {
		return nil, errs.NotFolder
	}
	if len(obj.Entries) >= 1000 {
		tree, err := d.getTree(obj.Sha)
		if err != nil {
			return nil, err
		}
		if tree.Truncated {
			return nil, fmt.Errorf("tree %s is truncated", dir.GetPath())
		}
		ret := make([]model.Obj, 0, len(tree.Trees))
		for _, t := range tree.Trees {
			if t.Path != ".gitkeep" {
				ret = append(ret, t.toModelObj())
			}
		}
		return ret, nil
	}

	ret := make([]model.Obj, 0, len(obj.Entries))
	entries := make([]Object, 0, len(obj.Entries))
	for _, entry := range obj.Entries {
		if entry.Name == ".gitkeep" {
			continue
		}
		ret = append(ret, entry.toModelObj())
		entries = append(entries, entry)
	}
	d.fetchAccurateModifiedTimes(ctx, dir.GetPath(), ret, entries)
	return ret, nil
}
```

- [ ] **Step 4: 跑 GitHub driver 包测试，确认 helper + 行为 + cache 回归全部通过**

Run: `go test ./drivers/github`
Expected: PASS

- [ ] **Step 5: 格式化受影响文件并再验一遍**

Run: `gofmt -w drivers/github/meta.go drivers/github/types.go drivers/github/driver.go drivers/github/mtime.go drivers/github/mtime_test.go && go test ./drivers/github`
Expected: `gofmt` 无报错，随后 `go test` 继续 PASS

## 自审清单

- spec 覆盖检查：
  - `accurate_modified_time` 默认关闭与 help 文案：Task 1
  - token fast-fail、`mtimeMaxEntries=200`、`mtimeBatchSize=50`：Task 1 + Task 3
  - `modified` 增强、`created` 保持 legacy：Task 1 + Task 3
  - `contents` 分支启用、`tree` fallback 保持旧行为：Task 3
  - GraphQL top-level error / alias 缺失 / empty history / rate-limit 止损：Task 2 + Task 3
  - `ref -> commit` / tag peel：Task 2
  - `200/201` 边界、首批失败、中途失败、缓存命中不重复 GraphQL：Task 3
- placeholder 扫描：全文没有占位标记或“以后补上”的描述。
- 类型一致性：helper 名称统一为 `shouldUseAccurateMtime`、`collectMtimePaths`、`buildMtimeBatchQuery`、`parseMtimeBatchResult`、`applyModifiedTimes`，执行阶段不要再改名。

## 执行方式

用户已预先选择 **Subagent-Driven**。写完并通过 review 后，直接用 `superpowers:subagent-driven-development` 风格执行本计划：

1. 复用现有 review 子代理会话做 plan review / 修订循环。
2. review 全部 PASS 后，不再等待用户确认，直接进入实现。
3. 为实现新开的子代理提供完整路径：
   - plan：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\plans\2026-04-21-openlist-github-mtime.md`
   - spec：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\specs\2026-04-21-openlist-github-mtime-design.md`
   - upstream repo：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\openlist-github-mtime\upstream\OpenList`
4. 每个实现子代理完成后都要在主会话复核 diff 与测试输出，再决定下一步。

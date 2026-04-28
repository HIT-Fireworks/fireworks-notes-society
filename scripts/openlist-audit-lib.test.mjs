import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditResult,
  classifyOpenListFailure,
  extractOListUses,
  isAuditedMarkdownPath,
  normalizeOpenListPath,
  stripMarkdownCode,
} from "./openlist-audit-lib.mjs";

describe("normalizeOpenListPath", () => {
  it("normalizes empty and slash-only paths to root", () => {
    assert.equal(normalizeOpenListPath(""), "/");
    assert.equal(normalizeOpenListPath("///"), "/");
  });

  it("adds one leading slash and collapses repeated slashes", () => {
    assert.equal(
      normalizeOpenListPath("数学学院//专业基础课/数学分析"),
      "/数学学院/专业基础课/数学分析",
    );
    assert.equal(
      normalizeOpenListPath("//【公共课】/大学物理"),
      "/【公共课】/大学物理",
    );
  });
});

describe("stripMarkdownCode", () => {
  it("removes fenced code blocks and inline code", () => {
    const markdown = [
      "# 页面",
      "```md",
      '<OList path="/代码块" />',
      "```",
      '正文 `inline <OList path="/行内" />`',
      '<OList path="/真实路径" />',
    ].join("\n");

    assert.equal(stripMarkdownCode(markdown).includes("/代码块"), false);
    assert.equal(stripMarkdownCode(markdown).includes("/行内"), false);
    assert.equal(stripMarkdownCode(markdown).includes("/真实路径"), true);
  });
});

describe("extractOListUses", () => {
  it("extracts static OList and OListItem paths", () => {
    const markdown = [
      '<OList path="/数学学院/专业基础课/数学分析" />',
      "<OListItem path='/仪器学院/工程光学' />",
    ].join("\n");

    assert.deepEqual(extractOListUses(markdown, "数学学院/数学分析/index.md"), [
      {
        component: "OList",
        file: "数学学院/数学分析/index.md",
        host: null,
        path: "/数学学院/专业基础课/数学分析",
        unsupported: null,
      },
      {
        component: "OListItem",
        file: "数学学院/数学分析/index.md",
        host: null,
        path: "/仪器学院/工程光学",
        unsupported: null,
      },
    ]);
  });

  it("ignores OList components inside double-backtick inline code spans", () => {
    const markdown = [
      '<OList path="/real" />',
      'Inline code: ``<OList path="/inline" />``',
    ].join("\n");

    assert.deepEqual(
      extractOListUses(markdown, "x.md").map((use) => use.path),
      ["/real"],
    );
  });

  it("treats bare components as root without covering a course path", () => {
    assert.deepEqual(extractOListUses("<OList />", "lessons/index.md"), [
      {
        component: "OList",
        file: "lessons/index.md",
        host: null,
        path: "/",
        unsupported: null,
      },
    ]);
  });

  it("reports dynamic path and non-default host as unsupported", () => {
    const markdown =
      '<OList :path="coursePath" host="https://example.invalid" />';
    assert.deepEqual(extractOListUses(markdown, "x.md"), [
      {
        component: "OList",
        file: "x.md",
        host: "https://example.invalid",
        path: null,
        unsupported: "dynamic-path",
      },
    ]);
  });
});

describe("isAuditedMarkdownPath", () => {
  it("mirrors VitePress course-page boundaries", () => {
    assert.equal(isAuditedMarkdownPath("数学学院/index.md"), true);
    assert.equal(isAuditedMarkdownPath("docs/superpowers/specs/x.md"), false);
    assert.equal(isAuditedMarkdownPath("parts/wip.md"), false);
    assert.equal(isAuditedMarkdownPath("README.md"), false);
    assert.equal(isAuditedMarkdownPath("CONTRIBUTING.md"), false);
    assert.equal(isAuditedMarkdownPath("team.md"), false);
  });
});

describe("classifyOpenListFailure", () => {
  it("classifies object-not-found responses as path errors", () => {
    assert.equal(
      classifyOpenListFailure({
        code: 500,
        message: "failed get objs: failed get dir: object not found",
      }),
      "path-not-found",
    );
  });

  it("classifies other failures as remote failures", () => {
    assert.equal(
      classifyOpenListFailure({ code: 500, message: "upstream timeout" }),
      "remote-failure",
    );
    assert.equal(
      classifyOpenListFailure(new SyntaxError("bad json")),
      "remote-failure",
    );
  });
});

describe("buildAuditResult", () => {
  it("keeps invalid OList paths as errors and applies configured info entries", () => {
    const result = buildAuditResult({
      remoteDirs: ["/", "/询问中", "/数学学院/专业基础课/数学分析"],
      localUses: [
        {
          component: "OList",
          file: "数学学院/数学分析/index.md",
          host: null,
          path: "/数学学院/专业基础课/数学分析",
          unsupported: null,
        },
        {
          component: "OList",
          file: "数学学院/坏路径/index.md",
          host: null,
          path: "/数学学院/坏路径",
          unsupported: null,
        },
      ],
      localMarkdownFiles: ["数学学院/集合论图论/index.md"],
      warningExemptions: [{ path: "/询问中", reason: "临时待确认目录" }],
      orphanPageAllowances: [
        { file: "数学学院/集合论图论/index.md", reason: "等待维护者确认" },
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].use.path, "/数学学院/坏路径");
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(
      result.info.map((item) => item.type),
      ["warning-exemption", "orphan-page-allowance"],
    );
  });
});

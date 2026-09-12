import assert from "node:assert/strict";
import { readManifestJson } from "../.vitepress/theme/manifest-store.ts";
import { basename } from "node:path";
import { test } from "node:test";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  buildCourseCatalogDelivery,
  courseCatalogDeliveryPlugin,
  courseDetailFileName,
} from "../.vitepress/theme/course-catalog-delivery.ts";
import { loadCoursePlan } from "../.vitepress/theme/course-catalog-client.ts";
import { createHash } from "node:crypto";
import {
  buildCourseCatalog,
  courseCatalogSourceFiles,
  courseCatalogWatchFiles,
  getCourseDetailPage,
  courseSlug,
  getCourseDetailCatalog,
  getCourseCatalogIndex,
  getCourseDetails,
  sortTerms,
  selectDiverseCourseNames,
} from "../.vitepress/theme/course-catalog.ts";
import { createServer } from "vite";
import coursePaths from "../courses/[code].paths.ts";

const catalog = getCourseCatalogIndex();
const details = getCourseDetails();
const coursesByCode = new Map(
  catalog.courses.map((course) => [course.code, course]),
);

const manifest = readManifestJson<any>(courseCatalogSourceFiles()[0]);

const routes = readManifestJson<any>(courseCatalogSourceFiles()[1]);

const recordsByCode = new Map<string, any[]>();
for (const record of manifest.curriculum_records) {
  const records = recordsByCode.get(record.course_code) ?? [];
  records.push(record);
  recordsByCode.set(record.course_code, records);
}
const descriptorByCode = new Map<string, any>(
  manifest.course_descriptors.map((item) => [item.course_code, item]),
);
const fileIdsByCode = new Map<string, string[]>();
for (const file of routes.files) {
  for (const code of file.course_codes ?? []) {
    const ids = fileIdsByCode.get(code) ?? [];
    ids.push(`${file.repo_id}\0${file.path}`);
    fileIdsByCode.set(code, ids);
  }
}
for (const ids of fileIdsByCode.values()) ids.sort();

test("课程名称与检索别名只来自同一课程代码，不继承合仓别名", () => {
  for (const course of catalog.courses) {
    const descriptor = descriptorByCode.get(course.code);
    const officialNames = new Set<string>(
      [
        descriptor?.course_name,
        ...(recordsByCode.get(course.code) ?? []).map(
          (record) => record.course_name,
        ),
      ]
        .filter((name) => typeof name === "string" && name.trim())
        .map((name: string) => name.trim()),
    );
    if (officialNames.size) {
      assert.ok(
        officialNames.has(course.name),
        `${course.code}: ${course.name}`,
      );
    } else {
      assert.equal(course.name, course.code);
      assert.deepEqual(course.aliases, []);
    }
    if (descriptor?.course_name?.trim()) {
      assert.equal(course.name, descriptor.course_name.trim(), course.code);
    }
    assert.ok(
      course.aliases.every(
        (name) => officialNames.has(name) && name !== course.name,
      ),
      `${course.code}: ${course.aliases.join("、")}`,
    );
    assert.equal(details.get(course.code)?.name, course.name);
  }
});

test("同仓课程仍使用各自课程代码的资料、学分和考核信息", () => {
  const sortedValues = (records, field: string) =>
    [
      ...new Set(
        records
          .map((record) => String(record[field] ?? "").trim())
          .filter(Boolean),
      ),
    ].sort();
  for (const course of catalog.courses) {
    const detail = details.get(course.code)!;
    const records = recordsByCode.get(course.code) ?? [];
    assert.deepEqual(
      [...detail.credits].sort(),
      sortedValues(records, "credit"),
      course.code,
    );
    assert.deepEqual(
      [...detail.totalHours].sort(),
      sortedValues(records, "total_hours"),
      course.code,
    );
    assert.deepEqual(
      [...detail.assessmentMethods].sort(),
      sortedValues(records, "assessment_method"),
      course.code,
    );
    const expected = fileIdsByCode.get(course.code) ?? [];
    assert.deepEqual(
      detail.files.map((file) => `${file.repoId}\0${file.path}`).sort(),
      expected,
      course.code,
    );
  }
});
test("课程目录完整消费正式输入且不依赖固定数据规模", () => {
  const validPlanIds = new Set(
    manifest.curriculum_plans.map((plan) => plan.plan_id).filter(Boolean),
  );
  const codedRecords = manifest.curriculum_records.filter(
    (record) => record.course_code && validPlanIds.has(record.source_plan),
  );
  const expectedCodes = new Set(
    [
      ...manifest.course_descriptors.map((item) => item.course_code),
      ...codedRecords.map((item) => item.course_code),
      ...routes.files.flatMap((file) => file.course_codes ?? []),
    ].filter(Boolean),
  );
  assert.equal(catalog.plans.length, validPlanIds.size);
  assert.equal(catalog.occurrences.length, codedRecords.length);
  assert.deepEqual(
    new Set(catalog.courses.map((course) => course.code)),
    expectedCodes,
  );
  assert.deepEqual(
    new Set(catalog.courses.map((course) => course.code)),
    new Set(details.keys()),
  );
});

test("每条课程记录都有唯一稳定身份并引用已生成的方案和详情页", () => {
  const planIds = new Set(catalog.plans.map((plan) => plan.id));
  const occurrenceIds = new Set<string>();
  for (const occurrence of catalog.occurrences) {
    assert.ok(occurrence.id, occurrence.courseCode);
    assert.ok(!occurrenceIds.has(occurrence.id), occurrence.id);
    occurrenceIds.add(occurrence.id);
    assert.ok(planIds.has(occurrence.planId), occurrence.planId);
    assert.ok(coursesByCode.has(occurrence.courseCode), occurrence.courseCode);
  }
  assert.equal(details.size, catalog.courses.length);
});

test("课程资料按文件路由反向聚合且统计一致", () => {
  for (const course of catalog.courses) {
    const detail = details.get(course.code);
    assert.ok(detail, course.code);
    const files = detail.repositories.reduce(
      (total, repository) => total + repository.fileCount,
      0,
    );
    assert.equal(files, course.fileCount, course.code);
    assert.equal(course.hasMaterial, files > 0, course.code);
  }
});
test("课程详情只序列化渲染所需的最小文件字段", () => {
  const allowedKeys = ["name", "path", "repoId", "routeKind", "size"];
  for (const course of catalog.courses.filter((item) => item.hasMaterial)) {
    const detail = details.get(course.code);
    assert.ok(detail, course.code);
    assert.equal(detail.files.length, course.fileCount, course.code);
    assert.ok(
      detail.files.every(
        (file) =>
          JSON.stringify(Object.keys(file).sort()) ===
          JSON.stringify(allowedKeys),
      ),
      course.code,
    );
  }
  const detailCatalog = getCourseDetailCatalog();
  for (const plan of detailCatalog.plans) {
    assert.deepEqual(Object.keys(plan).sort(), [
      "departmentCode",
      "entryCohort",
      "id",
      "majorCode",
      "majorFullName",
      "majorName",
      "planVersion",
      "programType",
      "school",
      "sourceKind",
    ]);
  }
  for (const detail of details.values()) {
    assert.ok(!("academicStructure" in detail), detail.code);
    for (const item of detail.majors) {
      assert.ok(detailCatalog.plans[item.planIndex], item.occurrenceId);
      assert.ok(
        Object.keys(item).every((key) =>
          [
            "directionKey",
            "moduleId",
            "occurrenceId",
            "planIndex",
            "sourceSection",
            "term",
          ].includes(key),
        ),
        item.occurrenceId,
      );
    }
  }
});

test("课程 slug 唯一且来源文件固定", () => {
  const slugs = new Set(
    catalog.courses.map((course) => courseSlug(course.code)),
  );
  assert.equal(slugs.size, catalog.courses.length);
  assert.deepEqual(
    courseCatalogSourceFiles().map((file) => basename(file)),
    [
      "repository-manifest.no-collection.v4.json",
      "repository-file-routes.v4.json",
    ],
  );
});

test("学期排序遵循学年和秋春夏顺序", () => {
  assert.deepEqual(
    sortTerms(["第二学年春季", "第一学年夏季", "第一学年秋季"]),
    ["第一学年秋季", "第一学年夏季", "第二学年春季"],
  );
});

test("培养方案与执行计划身份、同名专业和多条开课记录保持独立", () => {
  const fixture = {
    curriculum_plans: [
      {
        plan_id: "curriculum-a",
        source_kind: "curriculum",
        plan_version: "2022版",
        school_name: "测试学院",
        department_code: "01",
        year: "2022",
        major_code: "A01",
        major_name: "测试专业",
        major_full_name: "测试专业（方向一）",
      },
      {
        plan_id: "curriculum-b",
        plan_version: "2022版",
        school_name: "测试学院",
        department_code: "01",
        major_code: "A02",
        major_name: "测试专业",
        major_full_name: "测试专业（方向二）",
      },
      {
        plan_id: "execution-a",
        source_kind: "execution",
        entry_cohort: "2022",
        plan_version: "不应消费",
        school_name: "测试学院",
        department_code: "01",
        major_code: "A01",
        major_name: "测试专业",
        program_type: "本科",
      },
    ],
    curriculum_records: [
      {
        record_id: "record-main",
        source_plan: "execution-a",
        source_ordinal: 1,
        source_section: "main",
        course_code: "TEST1001",
        course_name: "测试课程",
        recommended_year_semester: "第一学年秋季",
      },
      {
        record_id: "record-module",
        source_plan: "execution-a",
        relation: { module_id: "专业模块", direction_key: "方向一" },
        source_ordinal: 2,
        source_section: "module",
        course_code: "TEST1001",
        course_name: "测试课程",
        recommended_year_semester: "第一学年秋季",
      },
      {
        record_id: "record-legacy-plan",
        source_plan: "curriculum-b",
        course_code: "TEST1002",
        course_name: "旧方案课程",
        recommended_year_semester: "第二学年春季",
      },
    ],
    course_descriptors: [
      { course_code: "TEST1001", course_name: "测试课程" },
      { course_code: "TEST1002", course_name: "旧方案课程" },
    ],
    repositories: [{ repo_id: "shared-repo", display_name: "共享仓库" }],
  };
  const files = [
    {
      repoId: "shared-repo",
      repoName: "共享仓库",
      path: "only-test1001.pdf",
      name: "only-test1001.pdf",
      routeKind: "document",
      courseCodes: ["TEST1001"],
      size: 1,
    },
  ];
  const result = buildCourseCatalog(fixture, files);
  const curriculum = result.index.plans.find(
    (plan) => plan.id === "curriculum-a",
  )!;
  const legacyCurriculum = result.index.plans.find(
    (plan) => plan.id === "curriculum-b",
  )!;
  const execution = result.index.plans.find(
    (plan) => plan.id === "execution-a",
  )!;

  assert.equal(curriculum.sourceKind, "curriculum");
  assert.equal(curriculum.planVersion, "2022版");
  assert.equal(curriculum.entryCohort, "");
  assert.equal(curriculum.programType, "");
  assert.equal(legacyCurriculum.sourceKind, "curriculum");
  assert.equal(legacyCurriculum.planVersion, "2022版");
  assert.equal(execution.sourceKind, "execution");
  assert.equal(legacyCurriculum.entryCohort, "");
  assert.equal(execution.entryCohort, "2022");
  assert.equal(execution.planVersion, "");
  assert.deepEqual(result.index.planVersions, ["2022版"]);
  assert.deepEqual(result.index.entryCohorts, ["2022"]);
  assert.deepEqual(
    result.index.plans
      .filter((plan) => plan.school === "测试学院")
      .map((plan) => plan.majorCode)
      .sort(),
    ["A01", "A01", "A02"],
  );
  assert.deepEqual(
    result.index.occurrences
      .filter((item) => item.courseCode === "TEST1001")
      .map((item) => item.id),
    ["record-main", "record-module"],
  );
  const moduleOccurrence = result.index.occurrences.find(
    (item) => item.id === "record-module",
  );
  assert.equal(moduleOccurrence?.moduleId, "专业模块");
  assert.equal(moduleOccurrence?.directionKey, "方向一");
  const detail = result.details.get("TEST1001")!;
  const detailMajors = detail.majors;
  assert.equal(
    detailMajors.find((item) => item.occurrenceId === "record-module")
      ?.moduleId,
    "专业模块",
  );
  assert.deepEqual(
    detailMajors.map((item) => ({
      occurrenceId: item.occurrenceId,
      planId: result.detailPlans[item.planIndex].id,
      sourceKind: result.detailPlans[item.planIndex].sourceKind,
      entryCohort: result.detailPlans[item.planIndex].entryCohort,
      majorCode: result.detailPlans[item.planIndex].majorCode,
      sourceSection: item.sourceSection,
    })),
    [
      {
        occurrenceId: "record-main",
        planId: "execution-a",
        sourceKind: "execution",
        entryCohort: "2022",
        majorCode: "A01",
        sourceSection: "main",
      },
      {
        occurrenceId: "record-module",
        planId: "execution-a",
        sourceKind: "execution",
        entryCohort: "2022",
        majorCode: "A01",
        sourceSection: "module",
      },
    ],
  );
  assert.equal(result.details.get("TEST1001")?.majors.length, 2);
  assert.equal(result.details.get("TEST1001")?.files.length, 1);
  assert.equal(result.details.get("TEST1002")?.files.length, 0);
});

test("缺少上游身份证据的旧课程记录会被明确拒绝", () => {
  assert.throws(
    () =>
      buildCourseCatalog({
        curriculum_plans: [
          {
            plan_id: "legacy-plan",
            plan_version: "2022版",
            major_code: "A01",
          },
        ],
        curriculum_records: [
          {
            source_plan: "legacy-plan",
            course_code: "TEST1003",
          },
        ],
        course_descriptors: [],
        repositories: [],
      }),
    /缺少 record_id 和 source_ordinal/,
  );
  const unknownSection = buildCourseCatalog({
    curriculum_plans: [
      {
        plan_id: "legacy-plan",
        plan_version: "2022版",
        major_code: "A01",
      },
    ],
    curriculum_records: [
      {
        record_id: "known-record",
        source_plan: "legacy-plan",
        course_code: "TEST1003",
      },
    ],
    course_descriptors: [],
    repositories: [],
  });
  assert.equal(unknownSection.index.occurrences[0].sourceSection, undefined);
  assert.equal(
    unknownSection.details.get("TEST1003")?.majors[0].sourceSection,
    undefined,
  );
});

test("冻结旧输入的全站详情投影仍严格小于 5MiB", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/course-catalog-baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const expand = (table) =>
    table.rows.map((row) =>
      Object.fromEntries(table.columns.map((key, index) => [key, row[index]])),
    );
  const input = Object.fromEntries(
    Object.entries(fixture.tables).map(([key, table]) => [key, expand(table)]),
  );
  const files = expand(fixture.files).map((file) => ({
    repoId: file.repo_id,
    repoName: file.repo_id,
    path: file.path,
    name: file.path.split("/").pop(),
    routeKind: file.route_kind || "其他资料",
    courseCodes: file.course_codes ?? [],
    size: file.size ?? 0,
  }));
  const result = buildCourseCatalog(
    input as Parameters<typeof buildCourseCatalog>[0],
    files,
  );
  assert.equal(result.index.plans.length, 211);
  assert.equal(result.index.courses.length, 2618);
  assert.equal(files.length, 3857);
  const bytes = Buffer.byteLength(
    JSON.stringify({
      plans: result.detailPlans,
      courses: Object.fromEntries(result.details),
    }),
  );
  assert.ok(bytes < 5 * 1024 * 1024, `${bytes} bytes`);
});

test("每个完整代码仅发布本课程详情且本地方案索引不丢安排", () => {
  const global = getCourseDetailCatalog();
  const occurrences = new Map(
    catalog.occurrences.map((item) => [item.id, item]),
  );
  for (const code of details.keys()) {
    const page = getCourseDetailPage(code, global);
    const original = details.get(code)!;
    assert.deepEqual(Object.keys(page).sort(), ["course", "plans"]);
    assert.equal(page.course.code, code);
    assert.equal(page.course.files, original.files);
    assert.equal(
      page.course.majors.length,
      (recordsByCode.get(code) ?? []).length,
    );
    assert.equal(
      new Set(page.plans.map((plan) => plan.id)).size,
      page.plans.length,
    );
    assert.equal(
      new Set(page.course.majors.map((item) => item.planIndex)).size,
      page.plans.length,
    );
    for (let index = 0; index < page.course.majors.length; index++) {
      const item = page.course.majors[index];
      const source = original.majors[index];
      assert.deepEqual(
        page.plans[item.planIndex],
        global.plans[source.planIndex],
      );
      assert.deepEqual({ ...item, planIndex: source.planIndex }, source);
      const occurrence = occurrences.get(item.occurrenceId)!;
      assert.equal(occurrence.courseCode, code);
      assert.equal(page.plans[item.planIndex].id, occurrence.planId);
    }
    const bytes = Buffer.byteLength(JSON.stringify(page));
    assert.ok(bytes < 5 * 1024 * 1024, `${code}: ${bytes} bytes`);
  }
});

test("全部课程路由只携带稳定身份且每门课有独立详情地址", () => {
  const routes = coursePaths.paths();
  assert.equal(routes.length, details.size);
  const files = new Set<string>();
  for (const { params } of routes) {
    assert.equal(params.code, courseSlug(params.courseCode));
    assert.ok(details.has(params.courseCode));
    assert.equal(params.detailFile, courseDetailFileName(params.courseCode));
    assert.match(params.detailFile, /^[a-f0-9]{64}\.json$/);
    assert.deepEqual(Object.keys(params).sort(), [
      "code",
      "courseCode",
      "detailFile",
    ]);
    assert.ok(!files.has(params.detailFile));
    files.add(params.detailFile);
  }
});

test(
  "详情 SSR 逐页读取当前数据并拒绝越界和缺失文件",
  { timeout: 60000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "course-detail-runtime-"));
    const output = join(root, "dist");
    mkdirSync(join(output, "course-details"), { recursive: true });
    const server = await createServer({
      configFile: false,
      root,
      plugins: [courseCatalogDeliveryPlugin()],
      build: { outDir: output },
      server: { middlewareMode: true },
      appType: "custom",
    });
    try {
      const runtime = await server.ssrLoadModule("virtual:course-detail");
      const firstCode = details.keys().next().value!;
      const secondCode = [...details.keys()].find(
        (code) => code !== firstCode,
      )!;
      const first = getCourseDetailPage(firstCode);
      const second = getCourseDetailPage(secondCode);
      const file = courseDetailFileName(firstCode);
      writeFileSync(
        join(output, "course-details", file),
        JSON.stringify(first),
      );
      assert.deepEqual(
        await runtime.loadCourseDetail(file),
        JSON.parse(JSON.stringify(first)),
      );
      writeFileSync(
        join(output, "course-details", file),
        JSON.stringify(second),
      );
      assert.deepEqual(
        await runtime.loadCourseDetail(file),
        JSON.parse(JSON.stringify(second)),
      );
      await assert.rejects(
        runtime.loadCourseDetail("../manifest.json"),
        /地址无效/,
      );
      await assert.rejects(
        runtime.loadCourseDetail(courseDetailFileName("missing-detail")),
        /ENOENT/,
      );
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("计划包完整保留各计划记录且目录可定位每份计划", () => {
  const delivery = buildCourseCatalogDelivery(catalog);
  assert.ok(!("occurrences" in delivery.directory));
  assert.equal(
    Object.keys(delivery.directory.planFiles).length,
    catalog.plans.length,
  );
  const byPlan = new Map<string, typeof catalog.occurrences>();
  for (const item of catalog.occurrences) {
    const records = byPlan.get(item.planId) ?? [];
    records.push(item);
    byPlan.set(item.planId, records);
  }
  let total = 0;
  for (const plan of catalog.plans) {
    const url = delivery.directory.planFiles[plan.id];
    assert.match(url, /^\/course-plans\/[a-f0-9]{64}\.json$/);
    const payload = delivery.files.get(url)!.plans[plan.id];
    assert.equal(payload.planId, plan.id);
    assert.deepEqual(payload.occurrences, byPlan.get(plan.id) ?? []);
    total += payload.occurrences.length;
  }
  assert.equal(total, catalog.occurrences.length);
  const published = [...delivery.files.values()].flatMap((bundle) =>
    Object.values(bundle.plans),
  );
  assert.deepEqual(
    published.map((plan) => plan.planId).sort(),
    catalog.plans.map((plan) => plan.id).sort(),
  );
  assert.equal(
    published.reduce((sum, plan) => sum + plan.occurrences.length, 0),
    catalog.occurrences.length,
  );
});

test("无官方名称的完整代码仍可检索且不继承同仓资料", () => {
  const result = buildCourseCatalog(
    {
      curriculum_plans: [{ plan_id: "empty" }],
      curriculum_records: [],
      repositories: [{ repo_id: "shared" }],
      course_descriptors: [
        { course_code: "NO-NAME", repo_id: "shared" },
        { course_code: "NAMED", course_name: "官方名称", repo_id: "shared" },
      ],
    },
    [
      {
        repoId: "shared",
        repoName: "shared",
        path: "named.pdf",
        name: "named.pdf",
        routeKind: "document",
        size: 1,
        courseCodes: ["NAMED"],
      },
    ],
  );
  assert.equal(result.details.get("NO-NAME")!.name, "NO-NAME");
  assert.deepEqual(result.details.get("NO-NAME")!.aliases, []);
  assert.deepEqual(result.details.get("NO-NAME")!.files, []);
  const delivery = buildCourseCatalogDelivery(result.index);
  assert.deepEqual(
    delivery.files.get(delivery.directory.planFiles.empty)!.plans.empty,
    { planId: "empty", occurrences: [] },
  );
});

test("方案客户端拒绝错误身份与错误HTTP响应并传递取消信号", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const url = `/course-plans/${"a".repeat(64)}.json`;
  try {
    globalThis.fetch = (async (_url, options) => {
      assert.equal(options?.signal, controller.signal);
      return new Response(
        JSON.stringify({
          plans: { other: { planId: "other", occurrences: [] } },
        }),
      );
    }) as typeof fetch;
    await assert.rejects(
      loadCoursePlan("selected", url, controller.signal),
      /不一致/,
    );
    globalThis.fetch = (async () =>
      new Response("missing", { status: 404 })) as typeof fetch;
    await assert.rejects(loadCoursePlan("selected", url), /404/);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          plans: {
            selected: {
              planId: "selected",
              occurrences: [{ planId: "other" }],
            },
          },
        }),
      )) as typeof fetch;
    await assert.rejects(loadCoursePlan("selected", url), /不一致/);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          plans: {
            selected: { planId: "selected", occurrences: [] },
            other: { planId: "other", occurrences: [{ planId: "other" }] },
          },
        }),
      )) as typeof fetch;
    assert.deepEqual(await loadCoursePlan("selected", url), {
      planId: "selected",
      occurrences: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("计划包跨越字节边界后无丢失，单个超大计划仍保持完整", () => {
  const large = "课".repeat(360000);
  const index = {
    ...catalog,
    plans: ["a", "b", "c"].map((id) => ({ ...catalog.plans[0], id })),
    occurrences: ["a", "b", "c"].map((id) => ({
      ...catalog.occurrences[0],
      id,
      planId: id,
      sourceSection: large,
    })),
  };
  const delivery = buildCourseCatalogDelivery(index);
  assert.equal(delivery.files.size, 3);
  for (const occurrence of index.occurrences) {
    const bundle = delivery.files.get(
      delivery.directory.planFiles[occurrence.planId],
    )!;
    assert.deepEqual(bundle.plans[occurrence.planId].occurrences, [occurrence]);
  }
});

test("真实根与新增分片输入受watch覆盖且缓存随输入变化失效", () => {
  const root = mkdtempSync(join(tmpdir(), "course-watch-"));
  try {
    const inputs = [
      join(root, "data", "manifest.json"),
      join(root, "config", "routes.json"),
    ];
    for (const input of inputs)
      mkdirSync(join(input, "..", ".fireworks-json"), { recursive: true });
    const patterns = courseCatalogWatchFiles(inputs);
    const save = (input: string, value: unknown) => {
      const bytes = JSON.stringify(value);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const shard = join(input, "..", ".fireworks-json", `${sha256}.json`);
      writeFileSync(shard, bytes);
      writeFileSync(
        input,
        JSON.stringify({
          $fireworks_shards: 1,
          kind: "object",
          parts: [{ sha256, bytes: Buffer.byteLength(bytes) }],
        }),
      );
      return shard.replaceAll("\\", "/");
    };
    for (const input of inputs) {
      const first = save(input, { value: "first" });
      const cached = readManifestJson(input);
      assert.equal(readManifestJson(input), cached);
      const second = save(input, { value: "second version" });
      const matched = new Set(
        patterns
          .flatMap((pattern) => [
            ...new Bun.Glob(
              relative(root, pattern).replaceAll("\\", "/"),
            ).scanSync({ cwd: root, absolute: true, dot: true }),
          ])
          .map((file) => file.replaceAll("\\", "/")),
      );
      assert.ok(matched.has(input.replaceAll("\\", "/")));
      assert.ok(matched.has(first));
      assert.ok(matched.has(second));
      assert.notEqual(readManifestJson(input), cached);
      assert.deepEqual(readManifestJson(input), { value: "second version" });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("仓库预览优先露出不同课程，再展示同课程的近似名称", () => {
  const names = [
    "高等数学B",
    "大学物理Ⅱ",
    "高等数学",
    "大学物理",
    "高等数学A",
    "大学物理Ⅰ",
    "概率论与数理统计",
    "线性代数",
    "高等数学",
  ];
  const preview = selectDiverseCourseNames(names);
  assert.deepEqual(
    new Set(preview),
    new Set(["高等数学", "大学物理", "概率论与数理统计", "线性代数"]),
  );
  assert.deepEqual(selectDiverseCourseNames([...names].reverse()), preview);
  assert.deepEqual(selectDiverseCourseNames(["高等数学", "高等数学"]), [
    "高等数学",
  ]);
  assert.deepEqual(selectDiverseCourseNames([]), []);
});

test("仓库课程代码总数覆盖无资料及无名称的代码，不受当前页面文件筛选影响", () => {
  const result = buildCourseCatalog(
    {
      curriculum_plans: [],
      curriculum_records: [],
      repositories: [
        {
          repo_id: "shared",
          course_codes: ["A", "B", "C", "D", "UNKNOWN", "A"],
        },
        { repo_id: "other", course_codes: ["E"] },
      ],
      course_descriptors: [
        { course_code: "A", course_name: "高等数学", repo_id: "shared" },
        { course_code: "B", course_name: "高等数学", repo_id: "shared" },
        { course_code: "C", course_name: "大学物理", repo_id: "shared" },
        { course_code: "D", course_name: "概率论" },
        { course_code: "E", course_name: "化学", repo_id: "other" },
      ],
    },
    [
      {
        repoId: "shared",
        repoName: "共享仓库",
        path: "笔记/A.pdf",
        name: "A.pdf",
        routeKind: "document",
        size: 100,
        courseCodes: ["A"],
      },
    ],
  );
  const repository = result.details.get("A")!.repositories[0];
  assert.equal(repository.courseCodeCount, 5);
  assert.deepEqual(
    new Set(repository.courseNamePreview),
    new Set(["高等数学", "大学物理", "概率论"]),
  );
  assert.equal(result.details.get("B")!.repositories[0].courseCodeCount, 5);
  assert.deepEqual(result.details.get("B")!.files, []);
  assert.equal(result.details.get("E")!.repositories[0].courseCodeCount, 1);
  assert.deepEqual(result.details.get("E")!.repositories[0].courseNamePreview, [
    "化学",
  ]);
});

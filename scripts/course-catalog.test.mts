import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";
import {
  courseCatalogSourceFiles,
  courseSlug,
  getCourseCatalogIndex,
  getCourseDetails,
  sortTerms,
} from "../.vitepress/theme/course-catalog.ts";

const catalog = getCourseCatalogIndex();
const details = getCourseDetails();
const coursesByCode = new Map(catalog.courses.map((course) => [course.code, course]));

test("课程目录保留现行培养方案和课程规模", () => {
  assert.equal(catalog.plans.length, 211);
  assert.equal(catalog.courses.length, 2618);
  assert.equal(catalog.occurrences.length, 8509);
  assert.equal(
    catalog.courses.filter((course) => course.hasMaterial).length,
    323,
  );
});

test("每条课程记录都引用已生成的方案和详情页", () => {
  const planIds = new Set(catalog.plans.map((plan) => plan.id));
  for (const occurrence of catalog.occurrences) {
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
test("课程详情文件带有站内加速和 GitHub 直连地址", () => {
  const materialCourses = catalog.courses.filter((course) => course.hasMaterial);
  assert.ok(materialCourses.length > 0);
  for (const course of materialCourses) {
    const detail = details.get(course.code);
    assert.ok(detail, course.code);
    assert.equal(detail.files?.length, course.fileCount, course.code);
    assert.ok(
      detail.files?.every(
        (file) =>
          file.siteDownloadUrl.startsWith("/gh/") &&
          file.githubRawUrl.startsWith("https://raw.githubusercontent.com/"),
      ),
      course.code,
    );
  }
});

test("课程 slug 唯一且来源文件固定", () => {
  const slugs = new Set(catalog.courses.map((course) => courseSlug(course.code)));
  assert.equal(slugs.size, catalog.courses.length);
  assert.deepEqual(courseCatalogSourceFiles().map((file) => basename(file)), [
    "repository-manifest.no-collection.v4.json",
    "repository-file-routes.v4.json",
  ]);
});

test("学期排序遵循学年和秋春夏顺序", () => {
  assert.deepEqual(sortTerms(["第二学年春季", "第一学年夏季", "第一学年秋季"]), [
    "第一学年秋季",
    "第一学年夏季",
    "第二学年春季",
  ]);
});

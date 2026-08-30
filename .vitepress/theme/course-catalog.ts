import fs from "node:fs";
import path from "node:path";
import {
  repositoryFileEntries,
  type RepositoryFileEntry,
} from "./repository-resources";

export interface CourseCatalogPlan {
  id: string;
  year: string;
  version: string;
  school: string;
  majorCode: string;
  majorName: string;
  terms: string[];
}

export interface CourseCatalogCourse {
  code: string;
  name: string;
  aliases: string[];
  offeringColleges: string[];
  schools: string[];
  terms: string[];
  hasMaterial: boolean;
  fileCount: number;
  bytes: number;
  repoId?: string;
}

export interface CourseCatalogOccurrence {
  planId: string;
  courseCode: string;
  term: string;
  credit?: number;
  totalHours?: number;
  assessmentMethod?: string;
  courseNature?: string;
  courseCategory?: string;
  offeringCollege?: string;
}

export interface CourseCatalogIndex {
  years: string[];
  schools: string[];
  offeringColleges: string[];
  terms: string[];
  plans: CourseCatalogPlan[];
  courses: CourseCatalogCourse[];
  occurrences: CourseCatalogOccurrence[];
}

export interface CourseDetailData extends CourseCatalogCourse {
  credits: string[];
  totalHours: string[];
  assessmentMethods: string[];
  courseNatures: string[];
  courseCategories: string[];
  majors: Array<{ school: string; major: string; term: string }>;
  repositories: Array<{
    repoId: string;
    displayName: string;
    githubUrl: string;
    fileCount: number;
    bytes: number;
    categories: Array<{ name: string; count: number }>;
  }>;
  files?: RepositoryFileEntry[];
}

type JsonObject = Record<string, unknown>;

interface ManifestData {
  curriculum_plans: JsonObject[];
  curriculum_records: JsonObject[];
  course_descriptors: JsonObject[];
  repositories: JsonObject[];
}

interface CatalogSource {
  manifest: ManifestData;
}

let sourceCache: CatalogSource | undefined;
let indexCache: CourseCatalogIndex | undefined;
let detailCache: Map<string, CourseDetailData> | undefined;

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(
  root,
  "data/repository-manifest.no-collection.v4.json",
);
const routesPath = path.join(root, "config/repository-file-routes.v4.json");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function source(): CatalogSource {
  if (!sourceCache) {
    sourceCache = {
      manifest: readJson<ManifestData>(manifestPath),
    };
  }
  return sourceCache;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
}

export function courseSlug(code: string): string {
  return encodeURIComponent(code);
}

function semesterOrder(value: string): number {
  const yearMatch = value.match(/第([一二三四五六七八九十]+)学年/);
  const yearMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const year = yearMatch ? (yearMap[yearMatch[1]] ?? 99) : 99;
  const season = value.includes("秋")
    ? 0
    : value.includes("春")
      ? 1
      : value.includes("夏")
        ? 2
        : value.includes("寒")
          ? 3
          : value.includes("暑")
            ? 4
            : 9;
  return year * 10 + season;
}

export function sortTerms(values: Iterable<string>): string[] {
  return unique(values).sort(
    (a, b) =>
      semesterOrder(a) - semesterOrder(b) || a.localeCompare(b, "zh-CN"),
  );
}

function fileCategory(routeKind: string, filePath: string): string {
  const value = `${routeKind} ${filePath}`.toLowerCase();
  if (/exam|试卷|真题|往年题|题库/.test(value)) return "试卷与题库";
  if (/textbook|教材|课本|电子书/.test(value)) return "教材";
  if (/slide|ppt|课件|讲义/.test(value)) return "课件与讲义";
  if (/homework|作业|习题|exercise/.test(value)) return "作业与习题";
  if (/lab|实验/.test(value)) return "实验资料";
  if (/note|笔记/.test(value)) return "课程笔记";
  return "其他资料";
}

function aggregate(): {
  index: CourseCatalogIndex;
  details: Map<string, CourseDetailData>;
} {
  const { manifest } = source();
  const plansById = new Map<string, CourseCatalogPlan>();
  for (const raw of manifest.curriculum_plans) {
    const id = text(raw.plan_id);
    if (!id) continue;
    plansById.set(id, {
      id,
      year: text(raw.year),
      version: text(raw.plan_version),
      school: text(raw.school_name),
      majorCode: text(raw.major_code),
      majorName: text(raw.major_name),
      terms: [],
    });
  }

  const descriptorByCode = new Map<string, JsonObject>();
  for (const descriptor of manifest.course_descriptors) {
    const code = text(descriptor.course_code);
    if (code) descriptorByCode.set(code, descriptor);
  }

  const repositoryById = new Map<string, JsonObject>();
  for (const repository of manifest.repositories) {
    const id = text(repository.repo_id);
    if (id) repositoryById.set(id, repository);
  }

  const filesByCode = new Map<string, RepositoryFileEntry[]>();
  const filesByRepo = new Map<string, RepositoryFileEntry[]>();
  for (const file of repositoryFileEntries()) {
    const repoId = file.repoId;
    if (repoId) {
      const current = filesByRepo.get(repoId) ?? [];
      current.push(file);
      filesByRepo.set(repoId, current);
    }
    for (const code of file.courseCodes) {
      const current = filesByCode.get(code) ?? [];
      current.push(file);
      filesByCode.set(code, current);
    }
  }

  const occurrences: CourseCatalogOccurrence[] = [];
  const recordsByCode = new Map<string, JsonObject[]>();
  for (const record of manifest.curriculum_records) {
    const planId = text(record.source_plan);
    const code = text(record.course_code);
    const term = text(record.recommended_year_semester) || "未标注学期";
    if (planId) plansById.get(planId)?.terms.push(term);
    if (!code) continue;
    occurrences.push({
      planId,
      courseCode: code,
      term,
      credit: number(record.credit),
      totalHours: number(record.total_hours),
      assessmentMethod: text(record.assessment_method) || undefined,
      courseNature: text(record.course_nature) || undefined,
      courseCategory: text(record.course_category) || undefined,
      offeringCollege: text(record.offering_college) || undefined,
    });
    const current = recordsByCode.get(code) ?? [];
    current.push(record);
    recordsByCode.set(code, current);
  }
  for (const plan of plansById.values()) plan.terms = sortTerms(plan.terms);

  const codes = new Set([
    ...descriptorByCode.keys(),
    ...recordsByCode.keys(),
    ...filesByCode.keys(),
  ]);
  const courses: CourseCatalogCourse[] = [];
  const details = new Map<string, CourseDetailData>();
  for (const code of codes) {
    const descriptor = descriptorByCode.get(code);
    const records = recordsByCode.get(code) ?? [];
    const files = filesByCode.get(code) ?? [];
    const repoIds = unique([
      text(descriptor?.repo_id),
      ...records.map((record) => text(record.repo_id)),
      ...files.map((file) => file.repoId),
    ]);
    const repositoryFiles = files;
    const repositories = repoIds.map((repoId) => {
      const repository = repositoryById.get(repoId);
      const filesForRepository = (filesByRepo.get(repoId) ?? []).filter(
        (file) => file.courseCodes.includes(code),
      );
      const categoryCounts = new Map<string, number>();
      for (const file of filesForRepository) {
        const category = fileCategory(file.routeKind, file.path);
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      return {
        repoId,
        displayName: text(repository?.display_name) || repoId,
        githubUrl: `https://github.com/HIT-Fireworks/${repoId}`,
        fileCount: filesForRepository.length,
        bytes: filesForRepository.reduce(
          (sum, file) => sum + file.size,
          0,
        ),
        categories: Array.from(categoryCounts, ([name, count]) => ({
          name,
          count,
        })).sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"),
        ),
      };
    });
    const names = unique([
      text(descriptor?.course_name),
      ...records.map((record) => text(record.course_name)),
    ]);
    const majors = Array.from(
      new Map(
        records
          .map((record) => {
            const plan = plansById.get(text(record.source_plan));
            return plan
              ? {
                  school: plan.school,
                  major: plan.majorName,
                  term: text(record.recommended_year_semester) || "未标注学期",
                }
              : undefined;
          })
          .filter(
            (item): item is { school: string; major: string; term: string } =>
              Boolean(item),
          )
          .map((item) => [`${item.school}\0${item.major}\0${item.term}`, item]),
      ).values(),
    ).sort(
      (a, b) =>
        a.school.localeCompare(b.school, "zh-CN") ||
        a.major.localeCompare(b.major, "zh-CN") ||
        semesterOrder(a.term) - semesterOrder(b.term),
    );
    const summary: CourseCatalogCourse = {
      code,
      name: names[0] || code,
      aliases: unique([
        ...names.slice(1),
        ...repoIds.flatMap((repoId) =>
          strings(repositoryById.get(repoId)?.aliases),
        ),
      ]),
      offeringColleges: unique(
        records.map((record) => text(record.offering_college)),
      ),
      schools: unique(majors.map((item) => item.school)),
      terms: sortTerms(majors.map((item) => item.term)),
      hasMaterial: repositoryFiles.length > 0,
      fileCount: repositoryFiles.length,
      bytes: repositoryFiles.reduce((sum, file) => sum + file.size, 0),
      repoId: repoIds[0] || undefined,
    };
    courses.push(summary);
    details.set(code, {
      ...summary,
      credits: unique(records.map((record) => String(record.credit ?? ""))),
      totalHours: unique(
        records.map((record) => String(record.total_hours ?? "")),
      ),
      assessmentMethods: unique(
        records.map((record) => text(record.assessment_method)),
      ),
      courseNatures: unique(
        records.map((record) => text(record.course_nature)),
      ),
      courseCategories: unique(
        records.map((record) => text(record.course_category)),
      ),
      majors,
      repositories,
      files: repositoryFiles,
    });
  }
  courses.sort(
    (a, b) =>
      Number(b.hasMaterial) - Number(a.hasMaterial) ||
      a.name.localeCompare(b.name, "zh-CN") ||
      a.code.localeCompare(b.code),
  );
  const plans = Array.from(plansById.values()).sort(
    (a, b) =>
      b.year.localeCompare(a.year) ||
      a.school.localeCompare(b.school, "zh-CN") ||
      a.majorName.localeCompare(b.majorName, "zh-CN"),
  );
  return {
    index: {
      years: unique(plans.map((plan) => plan.year)).sort((a, b) =>
        b.localeCompare(a),
      ),
      schools: unique(plans.map((plan) => plan.school)),
      offeringColleges: unique(
        courses.flatMap((course) => course.offeringColleges),
      ),
      terms: sortTerms(occurrences.map((record) => record.term)),
      plans,
      courses,
      occurrences,
    },
    details,
  };
}

export function getCourseCatalogIndex(): CourseCatalogIndex {
  if (!indexCache) {
    const result = aggregate();
    indexCache = result.index;
    detailCache = result.details;
  }
  return indexCache;
}

export function getCourseDetails(): Map<string, CourseDetailData> {
  getCourseCatalogIndex();
  return detailCache!;
}

export function courseCatalogSourceFiles(): string[] {
  return [manifestPath, routesPath];
}

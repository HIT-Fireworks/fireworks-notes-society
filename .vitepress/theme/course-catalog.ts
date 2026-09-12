import path from "node:path";
import { readManifestJson } from "./manifest-store";
import {
  repositoryFileEntries,
  type RepositoryFileEntry,
} from "./repository-resources";

export type CoursePlanSourceKind = "curriculum" | "execution";

export interface CourseCatalogPlan {
  id: string;
  sourceKind: CoursePlanSourceKind;
  entryCohort: string;
  planVersion: string;
  departmentCode: string;
  school: string;
  majorCode: string;
  majorName: string;
  majorFullName: string;
  programType: string;
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
  id: string;
  planId: string;
  courseCode: string;
  term: string;
  sourceSection?: string;
  moduleId?: string;
  directionKey?: string;
  credit?: number;
  totalHours?: number;
  assessmentMethod?: string;
  courseNature?: string;
  courseCategory?: string;
  offeringCollege?: string;
}

export interface CourseCatalogIndex {
  entryCohorts: string[];
  planVersions: string[];
  schools: string[];
  offeringColleges: string[];
  terms: string[];
  plans: CourseCatalogPlan[];
  courses: CourseCatalogCourse[];
  occurrences: CourseCatalogOccurrence[];
}

export interface CourseDetailFile {
  repoId: string;
  path: string;
  name: string;
  routeKind: string;
  size: number;
}

export interface CourseDetailPlan {
  id: string;
  sourceKind: CoursePlanSourceKind;
  entryCohort: string;
  planVersion: string;
  departmentCode: string;
  majorCode: string;
  majorName: string;
  majorFullName: string;
  programType: string;
  school: string;
}

export interface CourseDetailData extends CourseCatalogCourse {
  credits: string[];
  totalHours: string[];
  assessmentMethods: string[];
  courseNatures: string[];
  courseCategories: string[];
  majors: Array<{
    planIndex: number;
    occurrenceId: string;
    term: string;
    sourceSection?: string;
    moduleId?: string;
    directionKey?: string;
  }>;
  repositories: Array<{
    repoId: string;
    githubUrl: string;
    courseCodeCount: number;
    /** 仅在名称有省略时保存总数，否则预览已包含全部已知名称。 */
    courseNameCount?: number;
    courseNamePreview: string[];
    fileCount: number;
    bytes: number;
    categories: Array<{ name: string; count: number }>;
  }>;
  files: CourseDetailFile[];
}

export interface CourseDetailCatalog {
  plans: CourseDetailPlan[];
  courses: Record<string, CourseDetailData>;
}

export interface CourseDetailPage {
  course: CourseDetailData;
  plans: CourseDetailPlan[];
}

type JsonObject = Record<string, unknown>;

export interface CourseCatalogManifestData {
  curriculum_plans: JsonObject[];
  curriculum_records: JsonObject[];
  course_descriptors: JsonObject[];
  repositories: JsonObject[];
}

let sourceCache: WeakRef<CourseCatalogManifestData> | undefined;
let indexCache: CourseCatalogIndex | undefined;
let detailCache: Map<string, CourseDetailData> | undefined;
let resourceCache: RepositoryFileEntry[] | undefined;

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(
  root,
  "data/repository-manifest.no-collection.v4.json",
);
const routesPath = path.join(root, "config/repository-file-routes.v4.json");

function source(): CourseCatalogManifestData {
  const manifest = readManifestJson<CourseCatalogManifestData>(manifestPath);
  if (sourceCache?.deref() !== manifest) {
    sourceCache = new WeakRef(manifest);
    indexCache = undefined;
    detailCache = undefined;
    detailPlanCache = undefined;
  }
  return manifest;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
}

/** 构建时用字符二元组的 Jaccard 距离做最远点采样，优先露出不同名称。 */
export function selectDiverseCourseNames(
  names: Iterable<string>,
  limit = 4,
): string[] {
  const candidates = unique(names)
    .map((name) => {
      const normalized = name
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
      const chars = Array.from(normalized || name);
      const grams = new Set<string>();
      if (chars.length === 1) grams.add(chars[0]);
      for (let i = 1; i < chars.length; i++) grams.add(chars[i - 1] + chars[i]);
      return { name, length: chars.length, grams, nearest: 1, selected: false };
    })
    .sort(
      (a, b) => a.length - b.length || a.name.localeCompare(b.name, "zh-CN"),
    );
  const preview: string[] = [];
  let next: (typeof candidates)[number] | undefined = candidates[0];
  while (next && preview.length < limit) {
    next.selected = true;
    preview.push(next.name);
    let best: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (candidate.selected) continue;
      let intersection = 0;
      for (const gram of next.grams) {
        if (candidate.grams.has(gram)) intersection++;
      }
      const union = next.grams.size + candidate.grams.size - intersection;
      const distance = union ? 1 - intersection / union : 0;
      candidate.nearest = Math.min(candidate.nearest, distance);
      if (!best || candidate.nearest > best.nearest) best = candidate;
    }
    next = best;
  }
  return preview;
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

export function buildCourseCatalog(
  manifest: CourseCatalogManifestData,
  resourceFiles: RepositoryFileEntry[] = [],
): {
  index: CourseCatalogIndex;
  details: Map<string, CourseDetailData>;
  detailPlans: CourseDetailPlan[];
} {
  const plansById = new Map<string, CourseCatalogPlan>();
  for (const raw of manifest.curriculum_plans) {
    const id = text(raw.plan_id);
    if (!id) continue;
    const rawSourceKind = text(raw.source_kind);
    if (
      rawSourceKind &&
      rawSourceKind !== "curriculum" &&
      rawSourceKind !== "execution"
    ) {
      throw new Error(`教学计划 ${id} 的来源类型无效：${rawSourceKind}`);
    }
    const sourceKind: CoursePlanSourceKind =
      rawSourceKind === "execution" ? "execution" : "curriculum";
    plansById.set(id, {
      id,
      sourceKind,
      entryCohort: sourceKind === "execution" ? text(raw.entry_cohort) : "",
      planVersion: sourceKind === "curriculum" ? text(raw.plan_version) : "",
      departmentCode: text(raw.department_code),
      school: text(raw.school_name),
      majorCode: text(raw.major_code),
      majorName: text(raw.major_name),
      majorFullName: text(raw.major_full_name),
      programType: text(raw.program_type),
      terms: [],
    });
  }

  const descriptorByCode = new Map<string, JsonObject>();
  for (const descriptor of manifest.course_descriptors) {
    const code = text(descriptor.course_code);
    if (code) descriptorByCode.set(code, descriptor);
  }

  const filesByCode = new Map<string, RepositoryFileEntry[]>();
  const filesByRepo = new Map<string, RepositoryFileEntry[]>();
  for (const file of resourceFiles) {
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
  const occurrenceIds = new Set<string>();
  const occurrenceByRecord = new Map<JsonObject, CourseCatalogOccurrence>();
  const recordsByCode = new Map<string, JsonObject[]>();
  for (const record of manifest.curriculum_records) {
    const planId = text(record.source_plan);
    const code = text(record.course_code);
    const term = text(record.recommended_year_semester) || "未标注学期";
    if (planId) plansById.get(planId)?.terms.push(term);
    if (!code) continue;
    if (!planId || !plansById.has(planId)) {
      throw new Error(
        `课程记录 ${code} 引用了不存在的方案 ${planId || "(空)"}`,
      );
    }
    const sourceSection = text(record.source_section);
    const sourceOrdinal = scalarText(record.source_ordinal);
    const recordId = text(record.record_id);
    if (!recordId && !sourceOrdinal) {
      throw new Error(
        `旧课程记录 ${planId}/${sourceSection || "来源区域未标注"}/${code} 缺少 record_id 和 source_ordinal，无法构造稳定身份`,
      );
    }
    const occurrenceId =
      recordId ||
      `legacy:${encodeURIComponent(planId)}:${encodeURIComponent(sourceSection)}:${encodeURIComponent(sourceOrdinal)}`;
    if (occurrenceIds.has(occurrenceId)) {
      throw new Error(`课程记录 ID 重复：${occurrenceId}`);
    }
    occurrenceIds.add(occurrenceId);
    const relation = object(record.relation);
    const occurrence: CourseCatalogOccurrence = {
      id: occurrenceId,
      planId,
      courseCode: code,
      term,
      sourceSection: sourceSection || undefined,
      moduleId: text(relation?.module_id) || undefined,
      directionKey: text(relation?.direction_key) || undefined,
      credit: number(record.credit),
      totalHours: number(record.total_hours),
      assessmentMethod: text(record.assessment_method) || undefined,
      courseNature: text(record.course_nature) || undefined,
      courseCategory: text(record.course_category) || undefined,
      offeringCollege: text(record.offering_college) || undefined,
    };
    occurrences.push(occurrence);
    occurrenceByRecord.set(record, occurrence);
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
  const identities = new Map<string, { name: string; aliases: string[] }>();
  const repoIdsByCode = new Map<string, string[]>();
  const codesByRepo = new Map<string, Set<string>>();
  const includeCode = (repoId: string, code: string) => {
    if (!repoId || !code) return;
    let members = codesByRepo.get(repoId);
    if (!members) codesByRepo.set(repoId, (members = new Set()));
    members.add(code);
  };
  for (const repository of manifest.repositories) {
    if (!Array.isArray(repository.course_codes)) continue;
    for (const code of repository.course_codes) {
      includeCode(text(repository.repo_id), text(code));
    }
  }
  for (const code of codes) {
    const descriptor = descriptorByCode.get(code);
    const records = recordsByCode.get(code) ?? [];
    const repoIds = unique([
      text(descriptor?.repo_id),
      ...records.map((record) => text(record.repo_id)),
      ...(filesByCode.get(code) ?? []).map((file) => file.repoId),
    ]);
    repoIdsByCode.set(code, repoIds);
    for (const repoId of repoIds) includeCode(repoId, code);
    const names = unique([
      text(descriptor?.course_name),
      ...records.map((record) => text(record.course_name)),
    ]);
    const name = text(descriptor?.course_name) || names[0] || code;
    identities.set(code, {
      name,
      aliases: names.filter((value) => value !== name),
    });
  }
  const coverageByRepo = new Map<
    string,
    {
      courseCodeCount: number;
      courseNameCount?: number;
      courseNamePreview: string[];
    }
  >();
  for (const [repoId, members] of codesByRepo) {
    const names = unique(
      Array.from(members, (code) => {
        const name = identities.get(code)?.name;
        return name && name !== code ? name : "";
      }),
    );
    const preview = selectDiverseCourseNames(names);
    coverageByRepo.set(repoId, {
      courseCodeCount: members.size,
      courseNameCount: names.length > preview.length ? names.length : undefined,
      courseNamePreview: preview,
    });
  }
  const courses: CourseCatalogCourse[] = [];
  const details = new Map<string, CourseDetailData>();
  const detailPlans: CourseDetailPlan[] = Array.from(plansById.values())
    .map((plan) => ({
      id: plan.id,
      sourceKind: plan.sourceKind,
      entryCohort: plan.entryCohort,
      planVersion: plan.planVersion,
      departmentCode: plan.departmentCode,
      majorCode: plan.majorCode,
      majorName: plan.majorName,
      majorFullName: plan.majorFullName,
      programType: plan.programType,
      school: plan.school,
    }))
    .sort(
      (a, b) =>
        a.school.localeCompare(b.school, "zh-CN") ||
        a.majorName.localeCompare(b.majorName, "zh-CN") ||
        a.majorCode.localeCompare(b.majorCode) ||
        a.id.localeCompare(b.id),
    );
  const detailPlanIndex = new Map(
    detailPlans.map((plan, index) => [plan.id, index]),
  );
  for (const code of codes) {
    const records = recordsByCode.get(code) ?? [];
    const files = filesByCode.get(code) ?? [];
    const repoIds = repoIdsByCode.get(code)!;
    const repositoryFiles = files;
    const repositories = repoIds.map((repoId) => {
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
        githubUrl: `https://github.com/HIT-Fireworks/${repoId}`,
        ...coverageByRepo.get(repoId)!,
        fileCount: filesForRepository.length,
        bytes: filesForRepository.reduce((sum, file) => sum + file.size, 0),
        categories: Array.from(categoryCounts, ([name, count]) => ({
          name,
          count,
        })).sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"),
        ),
      };
    });
    const majors = records
      .map((record) => {
        const occurrence = occurrenceByRecord.get(record);
        const planIndex = occurrence
          ? detailPlanIndex.get(occurrence.planId)
          : undefined;
        return occurrence && planIndex !== undefined
          ? {
              planIndex,
              occurrenceId: occurrence.id,
              term: occurrence.term,
              sourceSection: occurrence.sourceSection,
              moduleId: occurrence.moduleId,
              directionKey: occurrence.directionKey,
            }
          : undefined;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort(
        (a, b) =>
          a.planIndex - b.planIndex ||
          semesterOrder(a.term) - semesterOrder(b.term) ||
          a.occurrenceId.localeCompare(b.occurrenceId),
      );
    const { name, aliases } = identities.get(code)!;
    const summary: CourseCatalogCourse = {
      code,
      name,
      aliases,
      offeringColleges: unique(
        records.map((record) => text(record.offering_college)),
      ),
      schools: unique(
        majors.map((item) => detailPlans[item.planIndex]?.school ?? ""),
      ),
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
      files: repositoryFiles.map(({ repoId, path, name, routeKind, size }) => ({
        repoId,
        path,
        name,
        routeKind,
        size,
      })),
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
      a.sourceKind.localeCompare(b.sourceKind) ||
      (b.entryCohort || b.planVersion).localeCompare(
        a.entryCohort || a.planVersion,
      ) ||
      a.school.localeCompare(b.school, "zh-CN") ||
      a.majorName.localeCompare(b.majorName, "zh-CN") ||
      a.majorCode.localeCompare(b.majorCode),
  );
  return {
    index: {
      entryCohorts: unique(plans.map((plan) => plan.entryCohort)).sort((a, b) =>
        b.localeCompare(a),
      ),
      planVersions: unique(plans.map((plan) => plan.planVersion)).sort((a, b) =>
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
    detailPlans,
  };
}

function aggregate(): {
  index: CourseCatalogIndex;
  details: Map<string, CourseDetailData>;
  detailPlans: CourseDetailPlan[];
} {
  return buildCourseCatalog(source(), repositoryFileEntries());
}

export function getCourseCatalogIndex(): CourseCatalogIndex {
  source();
  const resources = repositoryFileEntries();
  if (resourceCache !== resources) {
    resourceCache = resources;
    indexCache = undefined;
  }
  if (!indexCache) {
    const result = aggregate();
    indexCache = result.index;
    detailCache = result.details;
    detailPlanCache = result.detailPlans;
  }
  return indexCache;
}

export function getCourseDetails(): Map<string, CourseDetailData> {
  getCourseCatalogIndex();
  return detailCache!;
}

let detailPlanCache: CourseDetailPlan[] | undefined;
let detailCatalogCache: CourseDetailCatalog | undefined;

export function getCourseDetailCatalog(): CourseDetailCatalog {
  getCourseCatalogIndex();
  if (detailCatalogCache?.plans !== detailPlanCache) {
    detailCatalogCache = {
      plans: detailPlanCache!,
      courses: Object.fromEntries(detailCache!),
    };
  }
  return detailCatalogCache!;
}

/** Project only this code; immutable file and summary arrays remain shared. */
export function getCourseDetailPage(
  code: string,
  catalog: CourseDetailCatalog = getCourseDetailCatalog(),
): CourseDetailPage {
  const course = catalog.courses[code];
  if (!course) throw new Error(`课程不存在：${code}`);
  const plans: CourseDetailPlan[] = [];
  const localIndices = new Map<number, number>();
  const majors = course.majors.map((item) => {
    let planIndex = localIndices.get(item.planIndex);
    if (planIndex === undefined) {
      const plan = catalog.plans[item.planIndex];
      if (!plan)
        throw new Error(`课程安排引用不存在的方案：${item.occurrenceId}`);
      planIndex = plans.length;
      localIndices.set(item.planIndex, planIndex);
      plans.push(plan);
    }
    return { ...item, planIndex };
  });
  return { course: { ...course, majors }, plans };
}

export function courseCatalogWatchFiles(
  sourceFiles = courseCatalogSourceFiles(),
): string[] {
  return [
    ...sourceFiles,
    ...sourceFiles.map((file) =>
      path.join(path.dirname(file), ".fireworks-json/*.json"),
    ),
  ].map((file) => file.replaceAll("\\", "/"));
}

export function courseCatalogSourceFiles(): string[] {
  return [manifestPath, routesPath];
}

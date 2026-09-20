import path from "node:path";
import { readManifestJson } from "./manifest-store";
import { filesFromSnapshot, statsFromSnapshot, type ResourceFile } from "./resource-tree";
import { getResourceTreeSnapshots, resourceTreeSourceFiles } from "./resource-tree-store";

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

export type CourseDetailFile = ResourceFile;

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

export interface CourseRepositoryCoverage {
  repoId: string;
  githubUrl: string;
  courseCodeCount: number;
  courseNameCount?: number;
  courseNamePreview: string[];
  fileCount: number;
  bytes: number;
  categories: Array<{ name: string; count: number }>;
  commit: string;
  treeSha: string;
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
  repositories: CourseRepositoryCoverage[];
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
let detailPlanCache: CourseDetailPlan[] | undefined;
let detailCatalogCache: CourseDetailCatalog | undefined;

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(root, "data/repository-manifest.no-collection.v4.json");

function source(): CourseCatalogManifestData {
  const manifest = readManifestJson<CourseCatalogManifestData>(manifestPath);
  if (sourceCache?.deref() !== manifest) {
    sourceCache = new WeakRef(manifest);
    indexCache = undefined;
    detailCache = undefined;
    detailPlanCache = undefined;
    detailCatalogCache = undefined;
  }
  return manifest;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
}

export function selectDiverseCourseNames(names: Iterable<string>, limit = 4): string[] {
  const candidates = unique(names).map((name) => {
    const normalized = name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const chars = Array.from(normalized || name);
    const grams = new Set<string>();
    if (chars.length === 1) grams.add(chars[0]);
    for (let index = 1; index < chars.length; index++) grams.add(chars[index - 1] + chars[index]);
    return { name, length: chars.length, grams, nearest: 1, selected: false };
  }).sort((left, right) => left.length - right.length || left.name.localeCompare(right.name, "zh-CN"));
  const preview: string[] = [];
  let next = candidates[0];
  while (next && preview.length < limit) {
    next.selected = true;
    preview.push(next.name);
    let best: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (candidate.selected) continue;
      let intersection = 0;
      for (const gram of next.grams) if (candidate.grams.has(gram)) intersection++;
      const union = next.grams.size + candidate.grams.size - intersection;
      candidate.nearest = Math.min(candidate.nearest, union ? 1 - intersection / union : 0);
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
  const yearMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const year = yearMatch ? (yearMap[yearMatch[1]] ?? 99) : 99;
  const season = value.includes("秋") ? 0 : value.includes("春") ? 1 : value.includes("夏") ? 2 : value.includes("寒") ? 3 : value.includes("暑") ? 4 : 9;
  return year * 10 + season;
}

export function sortTerms(values: Iterable<string>): string[] {
  return unique(values).sort((left, right) => semesterOrder(left) - semesterOrder(right) || left.localeCompare(right, "zh-CN"));
}

export function buildCourseCatalog(manifest: CourseCatalogManifestData): {
  index: CourseCatalogIndex;
  details: Map<string, CourseDetailData>;
  detailPlans: CourseDetailPlan[];
} {
  const snapshots = getResourceTreeSnapshots();
  const plansById = new Map<string, CourseCatalogPlan>();
  for (const raw of manifest.curriculum_plans) {
    const id = text(raw.plan_id);
    if (!id) continue;
    const rawSourceKind = text(raw.source_kind);
    if (rawSourceKind && rawSourceKind !== "curriculum" && rawSourceKind !== "execution") throw new Error(`教学计划 ${id} 的来源类型无效：${rawSourceKind}`);
    const sourceKind: CoursePlanSourceKind = rawSourceKind === "execution" ? "execution" : "curriculum";
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
  const recordsByCode = new Map<string, JsonObject[]>();
  const occurrences: CourseCatalogOccurrence[] = [];
  const occurrenceIds = new Set<string>();
  const occurrenceByRecord = new Map<JsonObject, CourseCatalogOccurrence>();
  for (const record of manifest.curriculum_records) {
    const planId = text(record.source_plan);
    const code = text(record.course_code);
    const term = text(record.recommended_year_semester) || "未标注学期";
    if (planId) plansById.get(planId)?.terms.push(term);
    if (!code) continue;
    if (!planId || !plansById.has(planId)) throw new Error(`课程记录 ${code} 引用了不存在的方案 ${planId || "(空)"}`);
    const sourceSection = text(record.source_section);
    const sourceOrdinal = scalarText(record.source_ordinal);
    const recordId = text(record.record_id);
    if (!recordId && !sourceOrdinal) throw new Error(`旧课程记录 ${planId}/${sourceSection || "来源区域未标注"}/${code} 缺少稳定身份`);
    const occurrenceId = recordId || `legacy:${encodeURIComponent(planId)}:${encodeURIComponent(sourceSection)}:${encodeURIComponent(sourceOrdinal)}`;
    if (occurrenceIds.has(occurrenceId)) throw new Error(`课程记录 ID 重复：${occurrenceId}`);
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
    const list = recordsByCode.get(code) ?? [];
    list.push(record);
    recordsByCode.set(code, list);
  }
  for (const plan of plansById.values()) plan.terms = sortTerms(plan.terms);

  const repoByCode = new Map<string, string>();
  const codesByRepo = new Map<string, Set<string>>();
  for (const repository of manifest.repositories) {
    const repoId = text(repository.repo_id);
    for (const code of Array.isArray(repository.course_codes) ? repository.course_codes.map(text) : []) {
      if (!repoId || !code) continue;
      repoByCode.set(code, repoId);
      const members = codesByRepo.get(repoId) ?? new Set<string>();
      members.add(code);
      codesByRepo.set(repoId, members);
    }
  }
  const codes = new Set([...descriptorByCode.keys(), ...recordsByCode.keys(), ...repoByCode.keys()]);
  const identities = new Map<string, { name: string; aliases: string[] }>();
  for (const code of codes) {
    const descriptor = descriptorByCode.get(code);
    const records = recordsByCode.get(code) ?? [];
    const names = unique([text(descriptor?.course_name), ...records.map((record) => text(record.course_name))]);
    const name = text(descriptor?.course_name) || names[0] || code;
    identities.set(code, { name, aliases: names.filter((value) => value !== name) });
    if (!repoByCode.has(code)) {
      const fromDescriptor = text(descriptor?.repo_id) || text(records[0]?.repo_id);
      if (fromDescriptor) repoByCode.set(code, fromDescriptor);
    }
  }
  const detailPlans: CourseDetailPlan[] = Array.from(plansById.values()).map((plan) => ({ ...plan })).sort((a, b) => a.school.localeCompare(b.school, "zh-CN") || a.majorName.localeCompare(b.majorName, "zh-CN") || a.majorCode.localeCompare(b.majorCode) || a.id.localeCompare(b.id));
  const detailPlanIndex = new Map(detailPlans.map((plan, index) => [plan.id, index]));
  const coverageByRepo = new Map<string, { courseCodeCount: number; courseNameCount?: number; courseNamePreview: string[] }>();
  for (const [repoId, members] of codesByRepo) {
    const names = unique(Array.from(members, (code) => identities.get(code)?.name ?? "").filter(Boolean));
    const preview = selectDiverseCourseNames(names);
    coverageByRepo.set(repoId, { courseCodeCount: members.size, courseNameCount: names.length > preview.length ? names.length : undefined, courseNamePreview: preview });
  }

  const courses: CourseCatalogCourse[] = [];
  const details = new Map<string, CourseDetailData>();
  for (const code of codes) {
    const records = recordsByCode.get(code) ?? [];
    const repoId = repoByCode.get(code);
    const snapshot = repoId ? snapshots.get(repoId) : undefined;
    const files = snapshot ? filesFromSnapshot(snapshot) : [];
    const stats = snapshot ? statsFromSnapshot(snapshot) : { fileCount: 0, bytes: 0, categories: [] };
    const majors = records.map((record) => {
      const occurrence = occurrenceByRecord.get(record);
      const planIndex = occurrence ? detailPlanIndex.get(occurrence.planId) : undefined;
      return occurrence && planIndex !== undefined ? { planIndex, occurrenceId: occurrence.id, term: occurrence.term, sourceSection: occurrence.sourceSection, moduleId: occurrence.moduleId, directionKey: occurrence.directionKey } : undefined;
    }).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.planIndex - b.planIndex || semesterOrder(a.term) - semesterOrder(b.term) || a.occurrenceId.localeCompare(b.occurrenceId));
    const identity = identities.get(code) ?? { name: code, aliases: [] };
    const summary: CourseCatalogCourse = {
      code, name: identity.name, aliases: identity.aliases,
      offeringColleges: unique(records.map((record) => text(record.offering_college))),
      schools: unique(majors.map((item) => detailPlans[item.planIndex]?.school ?? "")),
      terms: sortTerms(majors.map((item) => item.term)),
      hasMaterial: stats.fileCount > 0, fileCount: stats.fileCount, bytes: stats.bytes, repoId,
    };
    courses.push(summary);
    const repository = repoId && snapshot ? [{
      repoId,
      githubUrl: `https://github.com/HIT-Fireworks/${repoId}`,
      ...coverageByRepo.get(repoId) ?? { courseCodeCount: 1, courseNamePreview: [] },
      fileCount: stats.fileCount, bytes: stats.bytes, categories: stats.categories,
      commit: snapshot.commit, treeSha: snapshot.treeSha,
    }] : [];
    details.set(code, {
      ...summary,
      credits: unique(records.map((record) => String(record.credit ?? ""))),
      totalHours: unique(records.map((record) => String(record.total_hours ?? ""))),
      assessmentMethods: unique(records.map((record) => text(record.assessment_method))),
      courseNatures: unique(records.map((record) => text(record.course_nature))),
      courseCategories: unique(records.map((record) => text(record.course_category))),
      majors,
      repositories: repository,
      files,
    });
  }
  courses.sort((a, b) => Number(b.hasMaterial) - Number(a.hasMaterial) || a.name.localeCompare(b.name, "zh-CN") || a.code.localeCompare(b.code));
  const plans = Array.from(plansById.values()).sort((a, b) => a.sourceKind.localeCompare(b.sourceKind) || (b.entryCohort || b.planVersion).localeCompare(a.entryCohort || a.planVersion) || a.school.localeCompare(b.school, "zh-CN") || a.majorName.localeCompare(b.majorName, "zh-CN") || a.majorCode.localeCompare(b.majorCode));
  return {
    index: { entryCohorts: unique(plans.map((plan) => plan.entryCohort)).sort((a, b) => b.localeCompare(a)), planVersions: unique(plans.map((plan) => plan.planVersion)).sort((a, b) => b.localeCompare(a)), schools: unique(plans.map((plan) => plan.school)), offeringColleges: unique(courses.flatMap((course) => course.offeringColleges)), terms: sortTerms(occurrences.map((record) => record.term)), plans, courses, occurrences },
    details, detailPlans,
  };
}

function aggregate(): { index: CourseCatalogIndex; details: Map<string, CourseDetailData>; detailPlans: CourseDetailPlan[] } {
  return buildCourseCatalog(source());
}

export function getCourseCatalogIndex(): CourseCatalogIndex {
  source();
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

export function getCourseDetailCatalog(): CourseDetailCatalog {
  getCourseCatalogIndex();
  if (detailCatalogCache?.plans !== detailPlanCache) {
    detailCatalogCache = { plans: detailPlanCache!, courses: Object.fromEntries(detailCache!) };
  }
  return detailCatalogCache;
}

export function getCourseDetailPage(code: string, catalog: CourseDetailCatalog = getCourseDetailCatalog()): CourseDetailPage {
  const course = catalog.courses[code];
  if (!course) throw new Error(`课程不存在：${code}`);
  const plans: CourseDetailPlan[] = [];
  const localIndices = new Map<number, number>();
  const majors = course.majors.map((item) => {
    let planIndex = localIndices.get(item.planIndex);
    if (planIndex === undefined) {
      const plan = catalog.plans[item.planIndex];
      if (!plan) throw new Error(`课程安排引用不存在的方案：${item.occurrenceId}`);
      planIndex = plans.length;
      localIndices.set(item.planIndex, planIndex);
      plans.push(plan);
    }
    return { ...item, planIndex };
  });
  return { course: { ...course, majors }, plans };
}

export function courseCatalogSourceFiles(): string[] { return [manifestPath, ...resourceTreeSourceFiles()]; }
export function courseCatalogWatchFiles(sourceFiles = courseCatalogSourceFiles()): string[] {
  return sourceFiles.map((file) => file.replaceAll("\\", "/"));
}

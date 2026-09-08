import type {
  CourseCatalogDirectory,
  CoursePlanBundle,
  CoursePlanRecords,
} from "./course-catalog-delivery";

export async function loadCourseCatalog(): Promise<CourseCatalogDirectory> {
  const response = await fetch("/course-catalog.json");
  if (!response.ok) throw new Error(`课程目录加载失败：${response.status}`);
  return (await response.json()) as CourseCatalogDirectory;
}

export async function loadCoursePlan(
  planId: string,
  url: string,
  signal?: AbortSignal,
): Promise<CoursePlanRecords> {
  if (!/^\/course-plans\/[a-f0-9]{64}\.json$/.test(url)) {
    throw new Error("课程方案地址无效，请刷新目录后重试。");
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`课程安排加载失败：${response.status}`);
  const bundle = (await response.json()) as CoursePlanBundle;
  const payload =
    bundle?.plans && Object.hasOwn(bundle.plans, planId)
      ? bundle.plans[planId]
      : undefined;
  if (
    !payload ||
    payload.planId !== planId ||
    !Array.isArray(payload.occurrences) ||
    payload.occurrences.some((item) => !item || item.planId !== planId)
  ) {
    throw new Error("课程安排与所选方案不一致，请刷新目录后重试。");
  }
  return payload;
}

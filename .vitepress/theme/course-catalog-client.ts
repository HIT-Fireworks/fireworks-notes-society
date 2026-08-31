import type { CourseCatalogIndex } from "./course-catalog";

export async function loadCourseCatalog(): Promise<CourseCatalogIndex> {
  const response = await fetch("/course-catalog.json");
  if (!response.ok) {
    throw new Error(`课程目录加载失败：${response.status}`);
  }
  return (await response.json()) as CourseCatalogIndex;
}

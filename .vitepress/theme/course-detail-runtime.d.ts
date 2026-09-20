declare module "virtual:course-detail" {
  export function loadCourseDetail(file: string): Promise<import("./course-catalog").CourseDetailPage>;
}

declare module "virtual:repository-resources" {
  export function loadRepositoryResources(scope?: string): Promise<import("./course-catalog").CourseDetailFile[]>;
}

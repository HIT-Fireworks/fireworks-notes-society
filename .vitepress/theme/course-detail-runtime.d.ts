declare module "virtual:course-detail" {
  export function loadCourseDetail(file: string): Promise<import("./course-catalog").CourseDetailPage>;
}

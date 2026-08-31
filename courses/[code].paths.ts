import {
  courseCatalogSourceFiles,
  courseSlug,
  getCourseCatalogIndex,
} from "../.vitepress/theme/course-catalog";

export default {
  watch: courseCatalogSourceFiles(),
  paths() {
    return getCourseCatalogIndex().courses.map((course) => ({
      params: {
        code: courseSlug(course.code),
        courseCode: course.code,
      },
    }));
  },
};

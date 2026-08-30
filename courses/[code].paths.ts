import {
  courseCatalogSourceFiles,
  courseSlug,
  getCourseDetails,
} from "../.vitepress/theme/course-catalog";

export default {
  watch: courseCatalogSourceFiles(),
  paths() {
    return Array.from(getCourseDetails().values()).map((course) => ({
      params: {
        code: courseSlug(course.code),
        course,
      },
    }));
  },
};

import {
  courseCatalogWatchFiles,
  courseSlug,
} from "../.vitepress/theme/course-catalog";
import {
  courseDetailFileName,
  getCourseCatalogDirectory,
} from "../.vitepress/theme/course-catalog-delivery";

export default {
  watch: courseCatalogWatchFiles(),
  paths() {
    return getCourseCatalogDirectory().courses.map((course) => ({
      params: {
        code: courseSlug(course.code),
        courseCode: course.code,
        detailFile: courseDetailFileName(course.code),
      },
    }));
  },
};

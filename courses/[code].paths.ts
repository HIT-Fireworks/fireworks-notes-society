import {
  courseCatalogWatchFiles,
  courseSlug,
  getCourseDetailCatalog,
} from "../.vitepress/theme/course-catalog";
import { courseDetailFileName } from "../.vitepress/theme/course-catalog-delivery";

export default {
  watch: courseCatalogWatchFiles(),
  paths() {
    const details = getCourseDetailCatalog();
    return Object.values(details.courses).map((course) => ({
      params: {
        code: courseSlug(course.code),
        courseCode: course.code,
        detailFile: courseDetailFileName(course.code),
      },
    }));
  },
};

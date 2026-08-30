import {
  courseCatalogSourceFiles,
  courseSlug,
  getCourseDetails,
} from "../.vitepress/theme/course-catalog";

export default {
  watch: [
    ...courseCatalogSourceFiles(),
    "../data/gh-proxy-nodes.json",
  ],
  paths() {
    return Array.from(getCourseDetails().values()).map((course) => ({
      params: {
        code: courseSlug(course.code),
        course,
      },
    }));
  },
};

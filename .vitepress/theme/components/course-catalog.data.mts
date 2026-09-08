import { defineLoader } from "vitepress";
import { courseCatalogWatchFiles } from "../course-catalog";
import { getCourseCatalogDelivery, type CourseCatalogDirectory } from "../course-catalog-delivery";

declare const data: CourseCatalogDirectory;
export { data };

export default defineLoader({
  watch: courseCatalogWatchFiles(),
  load(): CourseCatalogDirectory {
    return getCourseCatalogDelivery().directory;
  },
});

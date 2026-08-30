import { defineLoader } from "vitepress";
import {
  getCourseCatalogIndex,
  type CourseCatalogIndex,
} from "../course-catalog";

declare const data: CourseCatalogIndex;
export { data };

export default defineLoader({
  watch: [
    "../../../data/repository-manifest.no-collection.v4.json",
    "../../../config/repository-file-routes.v4.json",
  ],
  load(): CourseCatalogIndex {
    return getCourseCatalogIndex();
  },
});

import { defineLoader } from "vitepress";
import {
  getCourseDetails,
  type CourseDetailData,
} from "../course-catalog";

declare const data: Record<string, CourseDetailData>;
export { data };

export default defineLoader({
  watch: [
    "../../../data/repository-manifest.no-collection.v4.json",
    "../../../config/repository-file-routes.v4.json",
  ],
  load(): Record<string, CourseDetailData> {
    return Object.fromEntries(getCourseDetails());
  },
});

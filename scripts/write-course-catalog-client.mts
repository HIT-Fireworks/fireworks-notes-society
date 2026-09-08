import { publishCourseCatalog } from "../.vitepress/theme/course-catalog-delivery";

await publishCourseCatalog(process.argv[2] ?? ".vitepress/dist");

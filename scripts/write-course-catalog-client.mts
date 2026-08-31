import { mkdir, writeFile } from "node:fs/promises";
import { getCourseCatalogIndex } from "../.vitepress/theme/course-catalog";

await mkdir(".vitepress/dist", { recursive: true });
await writeFile(
  ".vitepress/dist/course-catalog.json",
  JSON.stringify(getCourseCatalogIndex()),
  "utf8",
);

import { defineLoader } from "vitepress";
import type { DataItem } from "./alist.api.mjs";

declare const data: DataItem[];
export { data };

export default defineLoader({
  async load(): Promise<DataItem[]> {
    return [];
  },
});

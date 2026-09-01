import { createSSRApp } from "vue";
import ResourceFileList from "./components/ResourceFileList.vue";
import { installPrimeVue } from "./primevue";
import type { CourseDetailFile } from "./course-catalog";

const root = document.querySelector<HTMLElement>("#course-resource-root");
if (root) {
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(root.dataset.files ?? ""), (value) =>
      value.charCodeAt(0),
    ),
  );
  const files = JSON.parse(json) as CourseDetailFile[];
  const app = createSSRApp(ResourceFileList, { files });
  installPrimeVue(app);
  app.mount(root);
}

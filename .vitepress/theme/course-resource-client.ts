import { createSSRApp } from "vue";
import RepositoryResources from "./components/RepositoryResources.vue";
import { installPrimeVue } from "./primevue";
import type { CourseDetailFile } from "./course-catalog";

for (const root of document.querySelectorAll<HTMLElement>("[data-resource-root]")) {
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(root.dataset.files ?? ""), (value) =>
      value.charCodeAt(0),
    ),
  );
  const files = JSON.parse(json) as CourseDetailFile[];
 const app = createSSRApp(RepositoryResources, { files });
 installPrimeVue(app);
 app.mount(root);
}

import { createSSRApp } from "vue";
import CourseExplorer from "./components/CourseExplorer.vue";
import { installPrimeVue } from "./primevue";
import { loadCourseCatalog } from "./course-catalog-client";

const root = document.querySelector("#course-explorer-root");
if (root) {
  void loadCourseCatalog().then((catalog) => {
    const app = createSSRApp(CourseExplorer, { catalog });
    installPrimeVue(app);
    app.mount(root);
  });
}

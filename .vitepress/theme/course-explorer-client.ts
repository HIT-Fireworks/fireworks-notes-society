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
  }).catch((error) => {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = error instanceof Error ? error.message : "课程目录加载失败";
    const retry = document.createElement("button");
    retry.textContent = "重新加载目录";
    retry.addEventListener("click", () => window.location.reload());
    root.replaceChildren(message, retry);
  });
}

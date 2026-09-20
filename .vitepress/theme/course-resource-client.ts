import { createSSRApp } from "vue";
import RepositoryResources from "./components/RepositoryResources.vue";
import { installPrimeVue } from "./primevue";

for (const root of document.querySelectorAll<HTMLElement>("[data-resource-root]")) {
  const json = new TextDecoder().decode(Uint8Array.from(atob(root.dataset.files ?? ""), (value) => value.charCodeAt(0)));
  const files = JSON.parse(json);
  const app = createSSRApp(RepositoryResources, {
    files,
    repoId: root.dataset.repoId,
    builtCommit: root.dataset.builtCommit,
    builtTreeSha: root.dataset.builtTreeSha,
  });
  installPrimeVue(app);
  app.mount(root);
}

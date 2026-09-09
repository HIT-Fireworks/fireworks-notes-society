// https://vitepress.dev/guide/custom-theme
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./style.css";
import RepositoryResourcePage from "./components/RepositoryResourcePage.vue";
import GLayout from "./GLayout.vue";
import { installPrimeVue } from "./primevue";


export default {
  extends: DefaultTheme,
  Layout: GLayout,
  enhanceApp({ app }) {
    installPrimeVue(app);
    app.component("RepositoryResourcePage", RepositoryResourcePage);
  },
} satisfies Theme;

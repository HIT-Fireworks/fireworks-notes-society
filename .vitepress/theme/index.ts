// https://vitepress.dev/guide/custom-theme
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./style.css";
import OList from "./components/OList.vue";
import OListItem from "./components/OListItem.vue";
import GLayout from "./GLayout.vue";
import { installPrimeVue } from "./primevue";


export default {
  extends: DefaultTheme,
  Layout: GLayout,
  enhanceApp({ app }) {
    installPrimeVue(app);
    app.component("OList", OList);
    app.component("OListItem", OListItem);
  },
} satisfies Theme;

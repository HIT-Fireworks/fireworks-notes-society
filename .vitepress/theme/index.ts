// https://vitepress.dev/guide/custom-theme
import { h } from "vue";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./style.css";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import OList from "./components/OList.vue";
import OListItem from "./components/OListItem.vue";
import { definePreset } from "@primeuix/themes";
import { primitive } from "@primeuix/themes/aura/base";

const MyPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#fff8f7",
      100: "#ffdbd7",
      200: "#ffbfb7",
      300: "#ffa397",
      400: "#ff8677",
      500: "#ff6a57",
      600: "#d95a4a",
      700: "#b34a3d",
      800: "#8c3a30",
      900: "#662a23",
      950: "#401b16",
    },
  },
});

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    });
  },
  enhanceApp({ app, router, siteData }) {
    app.use(PrimeVue, {
      theme: {
        preset: MyPreset,
        options: {
          darkModeSelector: ".dark",
        },
      },
    });
    app.component("OList", OList);
    app.component("OListItem", OListItem);
  },
} satisfies Theme;

import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";
import type { App } from "vue";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";

export const FireworksPreset = definePreset(Aura, {
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

export function installPrimeVue(app: App): void {
  app.use(PrimeVue, {
    theme: {
      preset: FireworksPreset,
      options: {
        darkModeSelector: ".dark",
      },
    },
  });
  app.use(ToastService);
}

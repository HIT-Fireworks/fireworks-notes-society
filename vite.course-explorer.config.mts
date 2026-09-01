import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [vue()],
  resolve: {
    alias: {
      "@theme": fileURLToPath(new URL("./.vitepress/theme", import.meta.url)),
    },
  },
  build: {
    emptyOutDir: false,
    outDir: ".vitepress/dist/assets",
    lib: {
      entry: {
        "course-explorer": fileURLToPath(
          new URL("./.vitepress/theme/course-explorer-client.ts", import.meta.url),
        ),
        "course-resource": fileURLToPath(
          new URL("./.vitepress/theme/course-resource-client.ts", import.meta.url),
        ),
      },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});

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
      entry: fileURLToPath(
        new URL("./.vitepress/theme/course-explorer-client.ts", import.meta.url),
      ),
      formats: ["es"],
      fileName: () => "course-explorer.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "course-explorer.[ext]",
      },
    },
  },
});

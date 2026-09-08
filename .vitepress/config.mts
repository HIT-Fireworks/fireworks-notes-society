import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitepress";
import { generateSidebar } from "vitepress-sidebar";
import { courseCatalogDeliveryPlugin } from "./theme/course-catalog-delivery";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "薪火笔记社",
  description: "用一门笔记改变一门课，期末考研竞赛科研社团都涉及的超好用HIT笔记网站！",
  head: [["link", { rel: "icon", href: "/logo.png" }]],
  buildConcurrency: 8,
  vite: {
    plugins: [tailwindcss(), courseCatalogDeliveryPlugin()],
  },
  buildEnd(siteConfig) {
    execFileSync("bun", [fileURLToPath(new URL("../scripts/write-course-catalog-client.mts", import.meta.url)), siteConfig.outDir], {
      cwd: siteConfig.srcDir,
      stdio: "inherit",
    });
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    search: {
      provider: "local",
      options: {
        miniSearch: {
          options: {
            tokenize: (text: string, fieldName?: string | undefined) =>
              Array.from(
                new Intl.Segmenter("cn", { granularity: "word" }).segment(text),
              )
                .filter((segment) => segment.isWordLike)
                .map((segment) => segment.segment),
          },
        },
      },
    },

    nav: [
      { text: "主页", link: "/" },
      { text: "课程中心", link: "/courses/", activeMatch: "/courses/" },
      { text: "笔记", link: "/lessons", activeMatch: "/lessons" },
      { text: "友站和其他资源", link: "/friends", activeMatch: "/friends" },
    ],

    sidebar: generateSidebar([
      {
        resolvePath: "/",
        useFolderLinkFromIndexFile: true,
        useFolderTitleFromIndexFile: true,
        useTitleFromFileHeading: true,
        excludePattern: [
          "parts",
          "docs",
          "README.md",
          "CONTRIBUTING.md",
          "team.md",
          "courses",
        ],
      },
    ]),

    footer: {
      message: `Released under the MPL-2.0 license
⚠️ 重要声明：本项目内所有电子教材资源均来源于 Z-Library 公开共享平台，仅作个人学习交流使用，不用于商业牟利。`,
      copyright: "Copyright © 2024-present, 薪火笔记社. CC BY-NC-SA 4.0",
    },

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/HIT-Fireworks/fireworks-notes-society",
      },
    ],

    logo: "/logo.png",

    editLink: {
      pattern:
        "https://github.com/HIT-Fireworks/fireworks-notes-society/edit/main/:path",
      text: "在 GitHub 上编辑此页面",
    },

    outline: "deep",

    docFooter: {
      prev: "上一篇",
      next: "下一篇",
    },

    externalLinkIcon: true,
  },

  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ["README.md", "CONTRIBUTING.md", "docs/**"],
  markdown: {
    math: true,
  },
});

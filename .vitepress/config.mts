import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitepress";
import { generateSidebar } from "vitepress-sidebar";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "薪火笔记社",
  description:
    "用一门笔记改变一门课，期末考研竞赛科研社团都涉及的超好用HIT笔记网站！",
  head: [["link", { rel: "icon", href: "/logo.png" }]],
  vite: {
    plugins: [tailwindcss()],
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
      { text: "笔记", link: "/lessons", activeMatch: "/lessons" },
      { text: "项目成员", link: "/team.md" },
    ],

    sidebar: generateSidebar([
      {
        resolvePath: "/",
        useFolderLinkFromIndexFile: true,
        useFolderTitleFromIndexFile: true,
        useTitleFromFileHeading: true,
        excludePattern: ["parts", "team.md", "README.md", "CONTRIBUTING.md"],
      },
    ]),

    footer: {
      message: "Released under the MPL-2.0 license",
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
  srcExclude: ["README.md", "CONTRIBUTING.md"],
  markdown: {
    math: true,
  },
});

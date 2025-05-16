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
        excludePattern: ["parts", "team.md"],
      },
    ]),

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/HIT-Fireworks/fireworks-notes-society",
      },
    ],
    logo: "/logo.png",
  },
});

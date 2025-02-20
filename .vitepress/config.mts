import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "薪火笔记社",
  description: "用一门笔记改变一门课，期末考研竞赛科研社团都涉及的超好用HIT笔记网站！",
    head: [
      ['link', { rel: 'icon', href: '/logo.png' }]
    ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config

    nav: [
      { text: '主页', link: '/' },
      { text: '笔记', link: '/markdown-examples' },
      {text: '项目成员', link: '/team.md'}
    ],

    sidebar: [
      {
        text: '笔记',
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' },
          
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/xudeyu444/fireworks-notes-society' }
    ],
    logo: '/logo.png'
  }
})


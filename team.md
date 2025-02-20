---
layout: home
hero:
  name: 团队成员
  tagline: 薪火笔记社
---
<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamMembers
} from 'vitepress/theme'

const members = [
  {
    avatar: 'team/张博文.jpg',
    name: '张博文',
    title: '社团创始人',
  },
  {
    avatar: 'team/廖建壹.jpg',
    name: '廖建壹',
    title: '社团负责人',
  },
  {
    avatar: 'team/胡琮景.jpg',
    name: '胡琮景',
    title: '社长',
  },
  {
    avatar: 'team/刘天玉.jpg',
    name: '刘天玉',
    title: '社长',
  },
  {
    avatar: 'team/杨怡凌.jpg',
    name: '杨怡凌',
    title: '社长',
  },
]
</script>

  <VPTeamMembers
    :members="members"
  />
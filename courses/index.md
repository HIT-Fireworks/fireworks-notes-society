---
layout: page
sidebar: false
outline: false
pageClass: course-catalog-page
head:
  - - link
    - rel: stylesheet
      href: /assets/course-explorer.css?v=3
  - - script
    - type: module
      src: /assets/course-explorer.js?v=3

---

<script setup lang="ts">
import CourseExplorer from "../.vitepress/theme/components/CourseExplorer.vue";
import { data as catalog } from "../.vitepress/theme/components/course-catalog.data.mjs";
</script>

<div id="course-explorer-root">
  <CourseExplorer :catalog="catalog" />
</div>

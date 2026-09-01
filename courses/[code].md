---
layout: doc
sidebar: false
outline: false
lastUpdated: false
head:
  - - link
    - rel: stylesheet
      href: /assets/style.css?v=6
  - - script
    - type: module
      src: /assets/course-resource.js?v=6
---

<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import CourseDetail from "../.vitepress/theme/components/CourseDetail.vue";
import { data as details } from "../.vitepress/theme/components/course-details.data.mjs";

const { page } = useData();
const course = computed(() => details[page.value.params.courseCode]);
</script>

<CourseDetail :course="course" />

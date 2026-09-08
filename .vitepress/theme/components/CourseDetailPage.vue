<script setup lang="ts">
import { computed, onServerPrefetch, shallowRef, watch } from "vue";
import { useData } from "vitepress";
import { loadCourseDetail } from "virtual:course-detail";
import type { CourseDetailPage } from "../course-catalog";
import CourseDetail from "./CourseDetail.vue";

const { page } = useData();
const code = computed(() => String(page.value.params?.courseCode ?? ""));
const file = computed(() => String(page.value.params?.detailFile ?? ""));
const detail = shallowRef<CourseDetailPage>();
const error = shallowRef("");
let request = 0;

async function load() {
  const current = ++request;
  const expectedCode = code.value;
  detail.value = undefined;
  error.value = "";
  try {
    const value = await loadCourseDetail(file.value);
    if (value.course?.code !== expectedCode || !Array.isArray(value.plans)) {
      throw new Error("课程详情与当前课程不一致，请刷新后重试。");
    }
    if (current === request) detail.value = value;
  } catch (cause) {
    if (import.meta.env.SSR) throw cause;
    if (current === request) {
      error.value = cause instanceof Error ? cause.message : "课程详情加载失败";
    }
  }
}

onServerPrefetch(load);
if (!import.meta.env.SSR) watch(file, load, { immediate: true });
</script>

<template>
  <CourseDetail v-if="detail" :key="code" :course="detail.course" :plans="detail.plans" />
  <div v-else-if="error" role="alert">
    <p>{{ error }}</p>
    <button type="button" @click="load">重新加载课程</button>
  </div>
  <p v-else role="status">正在加载课程详情…</p>
</template>

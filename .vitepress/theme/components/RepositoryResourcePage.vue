<script setup lang="ts">
import { onServerPrefetch, shallowRef, watch } from "vue";
import { loadRepositoryResources } from "virtual:repository-resources";
import type { CourseDetailFile } from "../course-catalog";
import RepositoryResources from "./RepositoryResources.vue";

const props = withDefaults(defineProps<{ path?: string }>(), { path: "/" });
const files = shallowRef<CourseDetailFile[]>([]);
const error = shallowRef("");
let request = 0;
async function load() {
  const current = ++request;
  error.value = "";
  try {
    const result = await loadRepositoryResources(props.path);
    if (current === request) files.value = result;
  } catch (cause) {
    if (import.meta.env.SSR) throw cause;
    if (current === request) error.value = cause instanceof Error ? cause.message : "资料索引加载失败";
  }
}
function serializeFiles(): string {
  const bytes = new TextEncoder().encode(JSON.stringify(files.value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
onServerPrefetch(load);
if (!import.meta.env.SSR) watch(() => props.path, load, { immediate: true });
</script>

<template>
  <div v-if="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">重新加载资料</button></div>
  <div v-else data-resource-root :data-files="serializeFiles()"><RepositoryResources :files="files" /></div>
</template>

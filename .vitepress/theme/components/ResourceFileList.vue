<script setup lang="ts">
import { computed, ref } from "vue";
import type { CourseDetailFile } from "../course-catalog";
import {
  repositoryRawUrl,
  repositorySiteDownloadUrl,
} from "../repository-resource-links";

const props = defineProps<{
  files: CourseDetailFile[];
}>();

const query = ref("");
const category = ref("全部类型");

const categories = computed(() => [
  "全部类型",
  ...Array.from(new Set(props.files.map((file) => file.routeKind))).sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  ),
]);

const filteredFiles = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  return props.files.filter((file) => {
    if (category.value !== "全部类型" && file.routeKind !== category.value) {
      return false;
    }
    if (!normalized) return true;
    return `${file.name} ${file.path} ${file.routeKind}`
      .toLowerCase()
      .includes(normalized);
  });
});

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
</script>

<template>
  <div class="resource-browser">
    <div class="resource-toolbar">
      <label class="resource-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="query" type="search" placeholder="搜索文件名或目录" />
      </label>
      <label class="resource-filter">
        <span>类型</span>
        <select v-model="category">
          <option v-for="item in categories" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
      </label>
    </div>
    <p class="resource-count">
      显示 {{ filteredFiles.length }} / {{ files.length }} 个文件
    </p>
    <div v-if="filteredFiles.length" class="resource-list" role="list">
      <article
        v-for="file in filteredFiles"
        :key="`${file.repoId}:${file.path}`"
        class="resource-row"
        role="listitem"
      >
        <div class="resource-file-icon" aria-hidden="true">▤</div>
        <div class="resource-file-main">
          <strong :title="file.name">{{ file.name }}</strong>
          <span :title="file.path">{{ file.path }}</span>
        </div>
        <span class="resource-kind">{{ file.routeKind }}</span>
        <span class="resource-size">{{ readableBytes(file.size) }}</span>
        <a
          :href="repositorySiteDownloadUrl(file)"
          class="resource-download"
          >站内加速下载</a
        >
        <a
          :href="repositoryRawUrl(file)"
          class="resource-direct"
          target="_blank"
          rel="noopener noreferrer"
          >直连</a
        >
      </article>
    </div>
    <p v-else class="resource-empty">没有找到匹配的文件。</p>
  </div>
</template>

<style scoped>
.resource-browser {
  margin-top: 18px;
}
.resource-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 10px;
}
.resource-search {
  position: relative;
  display: block;
}
.resource-search > span {
  position: absolute;
  top: 50%;
  left: 13px;
  transform: translateY(-50%);
  color: var(--vp-c-text-3);
  font-size: 20px;
}
.resource-search input {
  padding-left: 40px;
}
.resource-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}
.resource-filter > span {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.resource-filter select {
  min-height: 42px;
  padding: 0 9px;
}
.resource-count {
  margin: 14px 0 8px;
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.resource-list {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
}
.resource-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 110px 82px auto auto;
  gap: 10px;
  align-items: center;
  padding: 11px 13px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.resource-row:last-child {
  border-bottom: 0;
}
.resource-row:hover {
  background: var(--vp-c-bg-soft);
}
.resource-file-icon {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 7px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.resource-file-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.resource-file-main strong,
.resource-file-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-file-main strong {
  font-size: 13px;
}
.resource-file-main span {
  color: var(--vp-c-text-3);
  font-size: 11px;
}
.resource-kind {
  overflow: hidden;
  color: var(--vp-c-text-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-size {
  color: var(--vp-c-text-3);
  font-size: 11px;
  text-align: right;
}
.resource-download,
.resource-direct {
  font-size: 11px;
  text-decoration: none;
  white-space: nowrap;
}
.resource-download {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}
.resource-direct {
  color: var(--vp-c-text-3);
}
.resource-empty {
  padding: 28px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 14px;
  color: var(--vp-c-text-2);
  text-align: center;
}
@media (max-width: 720px) {
  .resource-toolbar {
    grid-template-columns: 1fr;
  }
  .resource-row {
    grid-template-columns: 28px minmax(0, 1fr) auto;
  }
  .resource-kind,
  .resource-size {
    display: none;
  }
  .resource-download,
  .resource-direct {
    grid-row: 2;
  }
  .resource-download {
    grid-column: 2;
  }
  .resource-direct {
    grid-column: 3;
  }
}
</style>

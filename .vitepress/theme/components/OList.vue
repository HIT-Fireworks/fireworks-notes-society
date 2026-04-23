<script setup lang="ts">
import OListItem from "./OListItem.vue";

/**
 * 网盘目录列表
 *
 * 渲染一个可搜索、可展开的文件/文件夹列表，并提供下载入口。
 *
 * - 通过 `path` 指定要展示的远端目录路径
 * - 不传 `path` 时默认展示根目录 `/`
 *
 * @component
 */
const { path = "/" } = defineProps<{
  /**
   * 要展示的远端目录路径（以 `/` 开头）。
   *
   * @default "/"
   */
  path?: string;
}>();
</script>

<template>
  <OListItem :path="path" />
</template>

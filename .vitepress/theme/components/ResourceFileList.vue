<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import Dialog from "primevue/dialog";
import Fieldset from "primevue/fieldset";
import FloatLabel from "primevue/floatlabel";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import TreeTable from "primevue/treetable";
import type { TreeNode } from "primevue/treenode";
import type { CourseDetailFile } from "../course-catalog";
import {
  repositoryRawUrl,
  repositorySiteDownloadUrl,
} from "../repository-resource-links";

const props = defineProps<{ files: CourseDetailFile[] }>();
const query = ref("");
const expandedKeys = ref<Record<string, boolean>>({});
const downloadDialogVisible = ref(false);
const selectedFile = ref<CourseDetailFile>();

const DIRECTORY_LABELS: Record<string, string> = {
  assignments: "作业",
  exams: "试卷与题库",
  labs: "实验资料",
  notes: "课程笔记",
  slides: "课件与讲义",
  software: "软件与工具",
  "special-topics": "专题资料",
  textbooks: "教材",
  tutorials: "教程",
};

interface DisplayFile {
  file: CourseDetailFile;
  parts: string[];
  path: string;
  type: string;
}

interface ResourceNodeData {
  name: string;
  path: string;
  type: string;
  size: number;
  isDirectory: boolean;
  file?: CourseDetailFile;
}

interface ResourceTreeNode extends TreeNode {
  data: ResourceNodeData;
  children?: ResourceTreeNode[];
}

interface DownloadOption {
  name: string;
  description: string;
  icon: string;
  href: string;
}

function pushDistinct(parts: string[], value: string): void {
  if (value && parts.at(-1) !== value) parts.push(value);
}

function displayPathParts(file: CourseDetailFile): string[] {
  const source = file.path.split("/").filter(Boolean);
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const part = source[index];
    const isFileName = index === source.length - 1;
    if (!isFileName && part === "course-components") {
      if (source[index + 1]?.startsWith("shared-material-")) index += 1;
      continue;
    }
    if (!isFileName && part === "resource-groups") {
      index += 1;
      continue;
    }
    if (!isFileName && part === "collisions") {
      if (/^[a-f0-9]{8,}$/i.test(source[index + 1] ?? "")) index += 1;
      continue;
    }
    if (!isFileName && part === "legacy-imports") {
      pushDistinct(result, "其他资料");
      continue;
    }
    if (
      !isFileName &&
      (part === "reclassified" || /^legacy-unit-[a-f0-9]{8,}$/i.test(part))
    ) {
      continue;
    }
    pushDistinct(result, isFileName ? part : (DIRECTORY_LABELS[part] ?? part));
  }
  return result.length ? result : [file.name];
}

function indexedFileName(name: string, index: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}（${index}）${name.slice(dot)}`
    : `${name}（${index}）`;
}

function materialType(file: CourseDetailFile): string {
  const value = `${file.routeKind} ${file.path}`.toLowerCase();
  if (/exam|试卷|真题|往年题|题库/.test(value)) return "试卷与题库";
  if (/textbook|教材|课本|电子书/.test(value)) return "教材";
  if (/slide|ppt|课件|讲义/.test(value)) return "课件与讲义";
  if (/note|笔记|总结|思维导图/.test(value)) return "课程笔记";
  if (/assignment|作业|习题|答案/.test(value)) return "作业与习题";
  if (/lab|实验/.test(value)) return "实验资料";
  if (/tutorial|software|教程|软件/.test(value)) return "教程与软件";
  if (file.routeKind === "special-topic") return "专题资料";
  return "其他资料";
}

const displayFiles = computed<DisplayFile[]>(() => {
  const candidates = props.files.map((file) => ({
    file,
    parts: displayPathParts(file),
    type: materialType(file),
  }));
  const directoryPaths = new Set<string>();
  for (const candidate of candidates) {
    for (let length = 1; length < candidate.parts.length; length += 1) {
      directoryPaths.add(candidate.parts.slice(0, length).join("/"));
    }
  }
  const usedPaths = new Set<string>();
  return candidates.map((candidate) => {
    const parts = [...candidate.parts];
    const originalName = parts.at(-1) ?? candidate.file.name;
    let path = parts.join("/");
    let duplicateIndex = 1;
    while (usedPaths.has(path) || directoryPaths.has(path)) {
      duplicateIndex += 1;
      parts[parts.length - 1] = indexedFileName(originalName, duplicateIndex);
      path = parts.join("/");
    }
    usedPaths.add(path);
    return { ...candidate, parts, path };
  });
});

const filteredFiles = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  if (!normalized) return displayFiles.value;
  return displayFiles.value.filter((entry) =>
    `${entry.path} ${entry.type} ${entry.file.name}`
      .toLowerCase()
      .includes(normalized),
  );
});

function sortNodes(nodes: ResourceTreeNode[]): void {
  nodes.sort(
    (left, right) =>
      Number(right.data.isDirectory) - Number(left.data.isDirectory) ||
      left.data.name.localeCompare(right.data.name, "zh-CN"),
  );
  for (const node of nodes) if (node.children) sortNodes(node.children);
}

const fileTree = computed<ResourceTreeNode[]>(() => {
  const roots: ResourceTreeNode[] = [];
  const folders = new Map<string, ResourceTreeNode>();
  for (const entry of filteredFiles.value) {
    let children = roots;
    let currentPath = "";
    entry.parts.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isFile = index === entry.parts.length - 1;
      if (isFile) {
        children.push({
          key: `file:${entry.file.repoId}:${entry.file.path}`,
          data: {
            name,
            path: entry.path,
            type: entry.type,
            size: entry.file.size,
            isDirectory: false,
            file: entry.file,
          },
          icon: fileIcon(name),
          leaf: true,
        });
        return;
      }
      let node = folders.get(currentPath);
      if (!node) {
        node = {
          key: `folder:${currentPath}`,
          data: {
            name,
            path: currentPath,
            type: "文件夹",
            size: 0,
            isDirectory: true,
          },
          children: [],
          leaf: false,
        };
        folders.set(currentPath, node);
        children.push(node);
      }
      node.data.size += entry.file.size;
      children = node.children ?? [];
    });
  }
  sortNodes(roots);
  return roots;
});

function collectFolderKeys(
  nodes: ResourceTreeNode[],
  result: Record<string, boolean> = {},
): Record<string, boolean> {
  for (const node of nodes) {
    if (!node.data.isDirectory) continue;
    result[String(node.key)] = true;
    collectFolderKeys(node.children ?? [], result);
  }
  return result;
}

watch(fileTree, (tree) => {
  if (query.value.trim()) expandedKeys.value = collectFolderKeys(tree);
});

const fieldsetLegend = computed(() =>
  query.value.trim()
    ? `${filteredFiles.value.length} / ${props.files.length} 个文件`
    : `${props.files.length} 个文件`,
);

const downloadOptions = computed<DownloadOption[]>(() => {
  if (!selectedFile.value) return [];
  return [
    {
      name: "站内加速",
      description: "自动选择当前可用的下载节点，适合大多数网络环境。",
      icon: "pi pi-bolt",
      href: repositorySiteDownloadUrl(selectedFile.value),
    },
    {
      name: "直连代理",
      description: "绕过本站 CDN；站内加速不稳定时可以尝试。",
      icon: "pi pi-external-link",
      href: repositoryRawUrl(selectedFile.value),
    },
  ];
});

function toggleFolder(node: ResourceTreeNode): void {
  const key = String(node.key);
  const next = { ...expandedKeys.value };
  if (next[key]) delete next[key];
  else next[key] = true;
  expandedKeys.value = next;
}

function isExpanded(node: ResourceTreeNode): boolean {
  return Boolean(expandedKeys.value[String(node.key)]);
}

function openDownloadDialog(file: CourseDetailFile): void {
  selectedFile.value = file;
  downloadDialogVisible.value = true;
}

function fileIcon(name: string): string {
  if (/\.pdf$/i.test(name)) return "pi pi-file-pdf";
  if (/\.docx?$/i.test(name)) return "pi pi-file-word";
  if (/\.xlsx?$/i.test(name)) return "pi pi-file-excel";
  if (/\.(zip|7z|rar|tar|gz)$/i.test(name)) return "pi pi-box";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "pi pi-image";
  if (/\.(mp4|mkv|mov|avi|webm)$/i.test(name)) return "pi pi-video";
  return "pi pi-file";
}

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}
</script>

<template>
  <div class="resource-browser">
    <FloatLabel variant="on" class="resource-search">
      <InputText
        id="course_resource_search"
        v-model="query"
        type="search"
        autocomplete="off"
        fluid
      />
      <label for="course_resource_search">搜索文件名</label>
    </FloatLabel>

    <Fieldset
      :legend="fieldsetLegend"
      class="resource-list-container"
      :pt="{
        contentContainer: {
          style: {
            width: '100%',
            contain: 'inline-size',
            overflow: 'auto',
          },
        },
      }"
    >
      <TreeTable
        v-if="fileTree.length"
        v-model:expanded-keys="expandedKeys"
        :value="fileTree"
        class="resource-tree"
        size="small"
        scrollable
      >
        <Column expander :style="{ width: '3.25rem' }">
          <template #body="{ node }">
            <Button
              v-if="node.data.isDirectory"
              :icon="isExpanded(node) ? 'pi pi-folder-open' : 'pi pi-folder'"
              variant="text"
              severity="secondary"
              rounded
              size="small"
              :aria-label="
                isExpanded(node)
                  ? `收起文件夹 ${node.data.name}`
                  : `展开文件夹 ${node.data.name}`
              "
              @click="toggleFolder(node)"
            />
            <i
              v-else
              :class="['resource-file-icon', node.icon]"
              aria-hidden="true"
            />
          </template>
        </Column>
        <Column
          field="name"
          header="文件名"
          sortable
          :style="{ minWidth: '15rem' }"
        >
          <template #body="{ node }">
            <span class="resource-file-name" :title="node.data.path">
              {{ node.data.name }}
            </span>
          </template>
        </Column>
        <Column
          field="type"
          header="资料类型"
          sortable
          :style="{ minWidth: '7rem' }"
        >
          <template #body="{ node }">
            <span class="resource-file-type">{{ node.data.type }}</span>
          </template>
        </Column>
        <Column
          field="size"
          header="文件大小"
          sortable
          :style="{ minWidth: '7rem' }"
        >
          <template #body="{ node }">
            <span class="resource-file-size">{{
              readableBytes(node.data.size)
            }}</span>
          </template>
        </Column>
        <Column header="下载" :style="{ width: '5rem' }">
          <template #body="{ node }">
            <Button
              v-if="node.data.file"
              icon="pi pi-download"
              severity="secondary"
              rounded
              size="small"
              :aria-label="`下载 ${node.data.name}`"
              @click="openDownloadDialog(node.data.file)"
            />
          </template>
        </Column>
      </TreeTable>

      <Message v-else severity="secondary" variant="simple">
        没有找到匹配的文件。
      </Message>
    </Fieldset>

    <Dialog
      v-model:visible="downloadDialogVisible"
      modal
      header="选择下载线路"
      :style="{ width: '22rem', maxWidth: 'calc(100vw - 2rem)' }"
    >
      <p class="download-file-name">{{ selectedFile?.name }}</p>
      <div class="download-sources">
        <Button
          v-for="source in downloadOptions"
          :key="source.name"
          as="a"
          :href="source.href"
          target="_blank"
          rel="noopener noreferrer"
          severity="secondary"
          variant="outlined"
          class="download-source"
          @click="downloadDialogVisible = false"
        >
          <span class="download-source-content">
            <span class="download-source-title">
              <i :class="source.icon" aria-hidden="true" />
              <strong>{{ source.name }}</strong>
            </span>
            <small>{{ source.description }}</small>
          </span>
        </Button>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.resource-browser {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

.resource-search {
  width: min(100%, 20rem);
}

.resource-list-container.p-fieldset {
  width: 100%;
  padding: 0;
  overflow: hidden;
}

.resource-list-container :deep(.p-fieldset-legend) {
  position: relative;
  z-index: 2;
  margin-bottom: -19.5px;
  margin-left: 1.125rem;
  border: none;
  background: linear-gradient(
    to bottom,
    var(--p-fieldset-legend-background) 51%,
    transparent 51%
  );
}

.resource-list-container :deep(.p-treetable-table) {
  display: table;
  min-width: 38rem;
  margin: unset;
  border-collapse: separate;
}

.resource-list-container :deep(.p-treetable-table tr) {
  border-top: unset;
  background-color: unset;
  transition: unset;
}

.resource-list-container :deep(.p-treetable-header-cell) {
  padding: var(--p-treetable-header-cell-padding);
  border-width: 0 0 1px;
  border-style: solid;
  border-color: var(--p-treetable-header-cell-border-color);
  color: var(--p-treetable-header-cell-color);
  background: var(--p-treetable-header-cell-background);
  font-weight: normal;
  text-align: start;
}

.resource-list-container :deep(.p-treetable-tbody > tr) {
  color: var(--p-treetable-row-color);
  background: var(--p-treetable-row-background);
  outline-color: transparent;
  transition:
    background var(--p-treetable-transition-duration),
    color var(--p-treetable-transition-duration),
    border-color var(--p-treetable-transition-duration),
    outline-color var(--p-treetable-transition-duration),
    box-shadow var(--p-treetable-transition-duration);
}

.resource-list-container :deep(.p-treetable-node-toggle-button) {
  width: 0 !important;
  margin-right: -0.5rem;
  visibility: hidden !important;
}

.resource-file-icon {
  display: inline-flex;
  width: var(--p-button-sm-icon-only-width);
  justify-content: center;
  color: var(--vp-c-text-2);
}

.resource-file-name {
  display: block;
  overflow-wrap: anywhere;
  color: var(--vp-c-text-1);
}

.resource-file-type,
.resource-file-size {
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.download-file-name {
  margin: 0 0 0.875rem;
  overflow-wrap: anywhere;
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.download-sources {
  display: grid;
  gap: 0.625rem;
}

.download-source {
  width: 100%;
  justify-content: flex-start;
  padding-block: 0.75rem;
  text-decoration: none !important;
}

.download-source-content,
.download-source-title {
  display: flex;
}

.download-source-content {
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  text-align: left;
}

.download-source-title {
  align-items: center;
  gap: 0.5rem;
}

.download-source-content small {
  color: var(--vp-c-text-2);
  font-weight: normal;
  line-height: 1.45;
  white-space: normal;
}

@media (max-width: 640px) {
  .resource-search {
    width: 100%;
  }

  .resource-list-container :deep(.p-treetable-table) {
    min-width: 34rem;
  }
}
</style>

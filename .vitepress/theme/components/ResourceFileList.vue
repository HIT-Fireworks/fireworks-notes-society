<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import Dialog from "primevue/dialog";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
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
    if (isFileName) result.push(part);
    else if (part !== "电子教材" || result.at(-1) !== "教材") {
      pushDistinct(result, DIRECTORY_LABELS[part] ?? part);
    }
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

let expandedBeforeSearch: Record<string, boolean> | undefined;

watch(
  fileTree,
  (tree, previous) => {
    if (query.value.trim()) {
      expandedBeforeSearch ??= { ...expandedKeys.value };
      expandedKeys.value = collectFolderKeys(tree);
    } else if (expandedBeforeSearch) {
      expandedKeys.value = expandedBeforeSearch;
      expandedBeforeSearch = undefined;
    } else if (!previous && props.files.length <= 24) {
      expandedKeys.value = collectFolderKeys(tree);
    }
  },
  { immediate: true },
);

const fileSummary = computed(() =>
  query.value.trim()
    ? `${filteredFiles.value.length} / ${props.files.length} 个文件`
    : `${props.files.length} 个文件`,
);

const downloadOptions = computed<DownloadOption[]>(() => {
  if (!selectedFile.value) return [];
  return [
    {
      name: "站内加速",
      description: "自动选择可用的下载节点。",
      icon: "pi pi-bolt",
      href: repositorySiteDownloadUrl(selectedFile.value),
    },
    {
      name: "直连代理",
      description: "直接使用代理节点，作为备用线路。",
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
    <div class="resource-toolbar">
      <IconField class="resource-search">
        <InputIcon class="pi pi-search" />
        <InputText
          id="course_resource_search"
          v-model="query"
          type="search"
          size="small"
          placeholder="搜索文件或目录"
          aria-label="搜索课程资料"
          autocomplete="off"
          fluid
        />
      </IconField>
      <span class="file-summary" role="status">{{ fileSummary }}</span>
    </div>

    <TreeTable
      v-if="fileTree.length"
      v-model:expanded-keys="expandedKeys"
      :value="fileTree"
      class="resource-tree"
      size="small"
      aria-label="课程资料文件"
    >
      <Column field="name" header="文件名" expander sortable>
        <template #body="{ node }">
          <button
            type="button"
            class="entry-name"
            :class="{ 'entry-folder': node.data.isDirectory }"
            :title="node.data.path"
            :aria-expanded="
              node.data.isDirectory ? isExpanded(node) : undefined
            "
            @click="
              node.data.isDirectory
                ? toggleFolder(node)
                : openDownloadDialog(node.data.file)
            "
          >
            <i
              :class="
                node.data.isDirectory
                  ? isExpanded(node)
                    ? 'pi pi-folder-open'
                    : 'pi pi-folder'
                  : node.icon
              "
              aria-hidden="true"
            />
            <span class="entry-text">
              <span>{{ node.data.name }}</span>
              <small v-if="node.data.file" class="mobile-file-size">{{
                readableBytes(node.data.size)
              }}</small>
            </span>
          </button>
        </template>
      </Column>
      <Column
        field="size"
        header="大小"
        sortable
        header-class="resource-size-column"
        body-class="resource-size-column"
      >
        <template #body="{ node }">
          <span v-if="node.data.file" class="file-size">{{
            readableBytes(node.data.size)
          }}</span>
        </template>
      </Column>
      <Column
        header="下载"
        header-class="resource-action-column"
        body-class="resource-action-column"
      >
        <template #body="{ node }">
          <Button
            v-if="node.data.file"
            icon="pi pi-download"
            severity="secondary"
            variant="text"
            size="small"
            :aria-label="`下载 ${node.data.name}`"
            @click="openDownloadDialog(node.data.file)"
          />
        </template>
      </Column>
    </TreeTable>
    <div v-else class="resource-empty">
      <Message severity="secondary" variant="simple"
        >没有找到匹配的文件</Message
      >
      <Button
        v-if="query"
        label="清空搜索"
        variant="text"
        size="small"
        @click="query = ''"
      />
    </div>

    <Dialog
      v-model:visible="downloadDialogVisible"
      modal
      header="下载文件"
      :style="{ width: '24rem', maxWidth: 'calc(100vw - 2rem)' }"
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
          <i :class="source.icon" aria-hidden="true" />
          <span class="download-source-content">
            <strong>{{ source.name }}</strong>
            <small>{{ source.description }}</small>
          </span>
        </Button>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.resource-browser {
  min-width: 0;
}
.resource-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.resource-search {
  flex: 1 1 14rem;
  max-width: 22rem;
  min-width: 0;
}
.file-summary,
.file-size {
  color: var(--vp-c-text-2);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.resource-tree {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
.resource-tree :deep(.p-treetable-table) {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.resource-tree :deep(.p-treetable-header-cell) {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 0.8125rem;
  font-weight: 500;
}
.resource-tree :deep(.p-treetable-body-cell-content-expander) {
  min-width: 0;
}
.resource-tree :deep(.resource-size-column) {
  width: 7.5rem;
}
.resource-tree :deep(.resource-action-column) {
  width: 4.5rem;
  text-align: center;
}
.resource-tree
  :deep(.resource-action-column .p-treetable-column-header-content),
.resource-tree :deep(.resource-action-column .p-treetable-body-cell-content) {
  justify-content: center;
}
.resource-tree :deep(.p-treetable-node-toggle-button) {
  flex-shrink: 0;
}
.entry-name {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem 0;
  border: 0;
  color: var(--vp-c-text-1);
  background: none;
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}
.entry-name > i {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 1rem;
}
.entry-folder {
  font-weight: 500;
}
.entry-name:hover {
  color: var(--vp-c-brand-1);
}
.entry-name:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
  border-radius: 3px;
}
.entry-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.mobile-file-size {
  display: none;
}
.resource-empty {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
.download-file-name {
  margin: 0 0 1rem;
  color: var(--vp-c-text-2);
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  line-height: 1.5;
}
.download-sources {
  display: grid;
  gap: 0.75rem;
}
.download-source {
  width: 100%;
  justify-content: flex-start;
  gap: 0.875rem;
  padding: 0.875rem;
  text-decoration: none;
}
.download-source-content {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  text-align: left;
  white-space: normal;
}
.download-source-content small {
  color: var(--vp-c-text-2);
  font-weight: 400;
  line-height: 1.5;
}
@media (max-width: 600px) {
  .resource-search {
    max-width: none;
  }
  .resource-tree :deep(.resource-size-column) {
    display: none;
  }
  .resource-tree :deep(.resource-action-column) {
    width: 3.5rem;
  }
  .mobile-file-size {
    display: block;
    margin-top: 0.125rem;
    color: var(--vp-c-text-2);
    font-size: 0.75rem;
    font-weight: 400;
  }
}
</style>

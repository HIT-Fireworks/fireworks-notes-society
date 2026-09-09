<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import TreeTable from "primevue/treetable";
import Dialog from "primevue/dialog";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import type { CourseDetailFile } from "../course-catalog";
import {
  probeRepositoryCdn,
  repositoryCdnUrl,
  repositoryRawUrl,
  type RepositoryCdn,
  type RepositoryCdnCacheStatus,
} from "../repository-resource-links";

type ResourceFile = CourseDetailFile & { repoName?: string };
interface ResourceNode {
  key: string;
  data: { name: string; path: string; size: number; file?: ResourceFile };
  children?: ResourceNode[];
  leaf?: boolean;
}

const props = defineProps<{ files: ResourceFile[] }>();
const query = ref("");
const selectedFile = ref<ResourceFile>();
const downloadDialogVisible = ref(false);
const cacheStatus = ref<Record<RepositoryCdn, RepositoryCdnCacheStatus>>({
  edgeone: "unavailable",
  esa: "unavailable",
});

const cdnSources: Array<{
  id: RepositoryCdn;
  name: string;
  description: string;
}> = [
  { id: "edgeone", name: "EdgeOne CDN", description: "EdgeOne 边缘缓存线路。" },
  { id: "esa", name: "ESA CDN", description: "ESA 边缘缓存备用线路。" },
];

const filteredFiles = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle
    ? props.files.filter((file) =>
        `${file.name} ${file.path} ${file.repoName ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : props.files;
});

const expandedKeys = ref<Record<string, boolean>>({});
const fileTree = computed<ResourceNode[]>(() => {
  const roots: ResourceNode[] = [];
  const folders = new Map<string, ResourceNode>();
  const repositories = new Set(props.files.map((file) => file.repoId));
  const showRepositoryRoots = repositories.size > 1;

  for (const file of filteredFiles.value) {
    let children = roots;
    const parts = file.path.split("/");
    const directories = parts.slice(0, -1);
    if (showRepositoryRoots) directories.unshift(file.repoName || file.repoId);

    let path = "";
    for (const [index, name] of directories.entries()) {
      path = path ? `${path}/${name}` : name;
      const key = `folder:${showRepositoryRoots ? file.repoId : ""}:${path}`;
      let folder = folders.get(key);
      if (!folder) {
        folder = {
          key,
          data: {
            name,
            path: showRepositoryRoots && index === 0 ? file.repoId : path,
            size: 0,
          },
          children: [],
        };
        folders.set(key, folder);
        children.push(folder);
      }
      folder.data.size += file.size;
      children = folder.children!;
    }

    children.push({
      key: `file:${file.repoId}:${file.path}`,
      data: { name: file.name, path: file.path, size: file.size, file },
      leaf: true,
    });
  }

  const sort = (nodes: ResourceNode[]) => {
    nodes.sort(
      (left, right) =>
        Number(!right.leaf) - Number(!left.leaf) ||
        left.data.name.localeCompare(right.data.name, "zh-CN"),
    );
    for (const node of nodes) if (node.children) sort(node.children);
  };
  sort(roots);
  return roots;
});

function folderKeys(
  nodes: ResourceNode[],
  result: Record<string, boolean> = {},
): Record<string, boolean> {
  for (const node of nodes) {
    if (!node.children) continue;
    result[node.key] = true;
    folderKeys(node.children, result);
  }
  return result;
}

let expandedBeforeSearch: Record<string, boolean> | undefined;
watch(
  () => props.files,
  () => {
    expandedKeys.value = props.files.length <= 24 ? folderKeys(fileTree.value) : {};
    expandedBeforeSearch = undefined;
  },
  { immediate: true },
);
watch(fileTree, (tree) => {
  if (query.value.trim()) {
    expandedBeforeSearch ??= { ...expandedKeys.value };
    expandedKeys.value = folderKeys(tree);
  } else if (expandedBeforeSearch) {
    expandedKeys.value = expandedBeforeSearch;
    expandedBeforeSearch = undefined;
  }
});

function toggleFolder(node: ResourceNode): void {
  const key = node.key;
  expandedKeys.value = { ...expandedKeys.value, [key]: !expandedKeys.value[key] };
}

const downloadOptions = computed(() => {
  const file = selectedFile.value;
  if (!file) return [];
  return [
    ...cdnSources.map((source) => ({
      ...source,
      href: repositoryCdnUrl(file, source.id),
      status: cacheStatus.value[source.id],
      icon: source.id === "edgeone" ? "pi pi-bolt" : "pi pi-cloud",
    })),
    {
      name: "直连代理",
      description: "不经过站内边缘层的备用线路。",
      icon: "pi pi-external-link",
      href: repositoryRawUrl(file),
      status: "unavailable" as RepositoryCdnCacheStatus,
    },
  ];
});

function cacheTag(status: RepositoryCdnCacheStatus): {
  label: string;
  severity: "success" | "warn" | "danger" | "secondary";
} {
  if (status === "hit") return { label: "缓存命中", severity: "success" };
  if (status === "secondary") return { label: "上层缓存命中", severity: "warn" };
  if (status === "miss") return { label: "未命中", severity: "secondary" };
  if (status === "checking") return { label: "检测中", severity: "warn" };
  if (status === "unknown") return { label: "缓存状态未知", severity: "secondary" };
  return { label: "探测失败", severity: "danger" };
}

let activeProbe: AbortController | undefined;
function cancelProbe(): void {
  activeProbe?.abort();
  activeProbe = undefined;
}
watch(downloadDialogVisible, (visible) => { if (!visible) cancelProbe(); });
onBeforeUnmount(cancelProbe);

function openDownload(file: ResourceFile): void {
  cancelProbe();
  selectedFile.value = file;
  downloadDialogVisible.value = true;
  cacheStatus.value = { edgeone: "checking", esa: "checking" };
  const request = new AbortController();
  activeProbe = request;
  const timeout = setTimeout(() => request.abort(), 8000);
  void Promise.all(cdnSources.map(async (source) => {
    const status = await probeRepositoryCdn(file, source.id, request.signal);
    if (activeProbe === request && downloadDialogVisible.value) {
      cacheStatus.value[source.id] = status;
    }
  })).finally(() => clearTimeout(timeout));
}

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}
</script>

<template>
  <div class="repository-resources">
    <div class="resource-toolbar">
      <IconField class="resource-search">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="query"
          placeholder="搜索文件名或路径"
          aria-label="搜索资料"
        />
      </IconField>
      <span class="file-summary" role="status">
        {{ query.trim() ? `${filteredFiles.length} / ${files.length} 个文件` : `${files.length} 个文件` }}
      </span>
    </div>

    <TreeTable
      v-if="fileTree.length"
      v-model:expanded-keys="expandedKeys"
      :value="fileTree"
      class="resource-tree"
      size="small"
      aria-label="资料文件"
    >
      <Column field="name" header="文件名" expander>
        <template #body="{ node }">
          <button
            v-if="node.children"
            type="button"
            class="entry-name entry-folder"
            :aria-expanded="!!expandedKeys[node.key]"
            :title="node.data.path"
            @click="toggleFolder(node)"
          >
            <i
              :class="expandedKeys[node.key] ? 'pi pi-folder-open' : 'pi pi-folder'"
              aria-hidden="true"
            />
            <span class="entry-text">{{ node.data.name }}</span>
          </button>
          <button
            v-else
            type="button"
            class="entry-name"
            :title="node.data.path"
            @click="openDownload(node.data.file)"
          >
            <i class="pi pi-file" aria-hidden="true" />
            <span class="entry-text">
              {{ node.data.name }}
              <span class="mobile-file-size">{{ readableBytes(node.data.size) }}</span>
            </span>
          </button>
        </template>
      </Column>
      <Column
        header="大小"
        header-class="resource-size-column"
        body-class="resource-size-column"
      >
        <template #body="{ node }">
          <span v-if="node.leaf" class="file-size">{{ readableBytes(node.data.size) }}</span>
        </template>
      </Column>
      <Column
        header="下载"
        header-class="resource-action-column"
        body-class="resource-action-column"
      >
        <template #body="{ node }">
          <Button
            v-if="node.leaf"
            icon="pi pi-download"
            text
            rounded
            :aria-label="`下载 ${node.data.name}`"
            @click="openDownload(node.data.file)"
          />
        </template>
      </Column>
    </TreeTable>

    <div v-else class="resource-empty">
      <p>{{ query.trim() ? "没有找到匹配的文件。" : "此页面范围内暂时没有资料。" }}</p>
      <a v-if="!files.length" href="/courses/">到课程中心查找课程</a>
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
          <span class="download-source-heading">
            <i :class="source.icon" aria-hidden="true" />
            <strong>{{ source.name }}</strong>
            <Tag
              v-if="source.name !== '直连代理'"
              :value="cacheTag(source.status).label"
              :severity="cacheTag(source.status).severity"
              rounded
            />
          </span>
          <small>{{ source.description }}</small>
        </Button>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.repository-resources { min-width: 0; }
.resource-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
.resource-search { flex: 1 1 14rem; max-width: 22rem; min-width: 0; }
.resource-search :deep(input) { width: 100%; }
.file-summary, .file-size, .mobile-file-size { color: var(--vp-c-text-2); font-size: .8125rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.resource-tree { overflow: hidden; border: 1px solid var(--vp-c-divider); border-radius: 8px; }
.resource-tree :deep(.p-treetable-table) { display: table; width: 100%; margin: 0; table-layout: fixed; border-collapse: collapse; }
.resource-tree :deep(.p-treetable-header-cell) { background: var(--vp-c-bg-soft); color: var(--vp-c-text-2); font-size: .8125rem; font-weight: 500; }
.resource-tree :deep(.p-treetable-body-cell-content) { min-width: 0; }
.resource-tree :deep(.resource-size-column) { width: 7.5rem; }
.resource-tree :deep(.resource-action-column) { width: 4.5rem; text-align: center; }
.resource-tree :deep(.resource-action-column .p-treetable-column-header-content) { justify-content: center; }
.resource-tree :deep(.p-treetable-node-toggle-button) { flex-shrink: 0; }
.entry-name { display: flex; align-items: center; gap: .625rem; flex: 1; min-width: 0; padding: .375rem 0; border: 0; background: none; color: var(--vp-c-text-1); font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
.entry-name > i { flex-shrink: 0; color: var(--vp-c-text-3); }
.entry-folder { font-weight: 500; }
.entry-text { min-width: 0; overflow-wrap: anywhere; }
.entry-name:hover { color: var(--vp-c-brand-1); }
.entry-name:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 3px; }
.mobile-file-size { display: none; }
.resource-empty { padding: 1.5rem 1rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; color: var(--vp-c-text-2); }
.download-file-name { margin: 0 0 1rem; overflow-wrap: anywhere; font-size: .875rem; }
.download-sources { display: grid; gap: .75rem; }
.download-source { width: 100%; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: .5rem; padding: .875rem; text-decoration: none; }
.download-source-heading { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.download-source-heading strong { font-weight: 600; }
.download-source :deep(.p-tag) { font-size: .6875rem; }
.download-source > small { color: var(--vp-c-text-2); font-weight: 400; line-height: 1.5; }
@media (max-width: 600px) {
  .resource-search { max-width: none; }
  .resource-tree :deep(.resource-size-column) { display: none; }
  .resource-tree :deep(.resource-action-column) { width: 3.5rem; }
  .mobile-file-size { display: block; margin-top: .125rem; font-size: .75rem; }
}
</style>

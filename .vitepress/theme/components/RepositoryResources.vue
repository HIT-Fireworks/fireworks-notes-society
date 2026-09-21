<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import TreeTable from "primevue/treetable";
import Dialog from "primevue/dialog";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import type { CourseDetailFile } from "../course-catalog";
import { probeRepositoryCdn, repositoryCdnUrl, repositoryRawUrl, type RepositoryCdn, type RepositoryCdnCacheStatus } from "../repository-resource-links";
import { refreshResourceRepository, type CachedResourceSnapshot } from "../resource-tree-refresh";

type ResourceFile = CourseDetailFile & { repoName?: string };
interface ResourceNode { key: string; data: { name: string; path: string; size: number; file?: ResourceFile }; children?: ResourceNode[]; leaf?: boolean }

const props = defineProps<{ files: ResourceFile[]; repoId?: string; builtCommit?: string; builtTreeSha?: string }>();
const displayFiles = shallowRef<ResourceFile[]>(props.files);
const snapshotCache = (globalThis as typeof globalThis & { __fireworksResourceSnapshots?: Map<string, CachedResourceSnapshot> }).__fireworksResourceSnapshots ??= new Map<string, CachedResourceSnapshot>();
const toast = useToast();
const query = ref("");
const selectedFile = ref<ResourceFile>();
const downloadDialogVisible = ref(false);
const cacheStatus = ref<Record<RepositoryCdn, RepositoryCdnCacheStatus>>({ edgeone: "unavailable", esa: "unavailable" });
const cdnSources: Array<{ id: RepositoryCdn; name: string; description: string }> = [
  { id: "edgeone", name: "EdgeOne CDN", description: "EdgeOne 边缘缓存线路。" },
  { id: "esa", name: "ESA CDN", description: "ESA 边缘缓存备用线路。" },
];

const filteredFiles = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle ? displayFiles.value.filter((file) => `${file.name} ${file.path} ${file.repoName ?? ""}`.toLowerCase().includes(needle)) : displayFiles.value;
});

interface ResourceTreeNode { key: string; data: { name: string; path: string; size: number; file?: ResourceFile }; children?: ResourceTreeNode[]; leaf?: boolean }
const expandedKeys = ref<Record<string, boolean>>({});
const fileTree = computed<ResourceTreeNode[]>(() => {
  const roots: ResourceTreeNode[] = [];
  const folders = new Map<string, ResourceTreeNode>();
  for (const file of filteredFiles.value) {
    let children = roots;
    const parts = file.path.split("/");
    let current = "";
    for (const [index, name] of parts.slice(0, -1).entries()) {
      current = current ? `${current}/${name}` : name;
      const key = `folder:${current}`;
      let folder = folders.get(key);
      if (!folder) { folder = { key, data: { name, path: current, size: 0 }, children: [] }; folders.set(key, folder); children.push(folder); }
      folder.data.size += file.size;
      children = folder.children!;
    }
    children.push({ key: `file:${file.repoId}:${file.path}`, data: { name: file.name, path: file.path, size: file.size, file }, leaf: true });
  }
  const sort = (nodes: ResourceTreeNode[]) => { nodes.sort((a, b) => Number(!b.leaf) - Number(!a.leaf) || a.data.name.localeCompare(b.data.name, "zh-CN")); for (const node of nodes) if (node.children) sort(node.children); };
  sort(roots);
  return roots;
});
function folderKeys(nodes: ResourceTreeNode[], result: Record<string, boolean> = {}) { for (const node of nodes) { if (!node.children) continue; result[node.key] = true; folderKeys(node.children, result); } return result; }
watch(displayFiles, () => { expandedKeys.value = displayFiles.value.length <= 24 ? folderKeys(fileTree.value) : {}; }, { immediate: true });
watch(fileTree, (tree) => { if (query.value.trim()) expandedKeys.value = folderKeys(tree); });
function toggleFolder(node: ResourceTreeNode) { expandedKeys.value = { ...expandedKeys.value, [node.key]: !expandedKeys.value[node.key] }; }

async function refreshRepositorySnapshot(): Promise<void> {
  const versions = new Map<string, { commit: string; treeSha: string }>();
  if (props.repoId && props.builtCommit && props.builtTreeSha) versions.set(props.repoId, { commit: props.builtCommit, treeSha: props.builtTreeSha });
  for (const file of displayFiles.value) if (!versions.has(file.repoId)) versions.set(file.repoId, { commit: file.commit, treeSha: file.treeSha });
  let changed = false;
  let stale = false;
  for (const [repoId, built] of versions) {
    const initial = displayFiles.value.filter((file) => file.repoId === repoId);
    try {
      const result = await refreshResourceRepository({ repoId, builtCommit: built.commit, builtTreeSha: built.treeSha, initialFiles: initial, cache: snapshotCache });
      if (!result.changed) continue;
      displayFiles.value = [...displayFiles.value.filter((file) => file.repoId !== repoId), ...result.files];
      changed = true;
    } catch { stale = true; }
  }
  if (changed) toast.add({ severity: "success", summary: "资料已更新", detail: "已加载资料仓库的最新目录。", life: 3500 });
  if (stale) toast.add({ severity: "warn", summary: "资料版本检查失败", detail: "部分资料仍显示构建版本目录。", life: 4500 });
}
onMounted(() => { void refreshRepositorySnapshot(); });

const downloadOptions = computed(() => {
  const file = selectedFile.value;
  if (!file) return [];
  return [...cdnSources.map((source) => ({ ...source, href: repositoryCdnUrl(file, source.id), status: cacheStatus.value[source.id], icon: source.id === "edgeone" ? "pi pi-bolt" : "pi pi-cloud" })), { name: "直连代理", description: "不经过站内边缘层的备用线路。", icon: "pi pi-external-link", href: repositoryRawUrl(file), status: "unavailable" as RepositoryCdnCacheStatus }];
});
function cacheTag(status: RepositoryCdnCacheStatus) { if (status === "hit") return { label: "缓存命中", severity: "success" as const }; if (status === "checking") return { label: "检测中", severity: "warn" as const }; if (status === "miss") return { label: "未命中", severity: "secondary" as const }; return { label: "探测失败", severity: "danger" as const }; }
let activeProbe: AbortController | undefined;
function cancelProbe() { activeProbe?.abort(); activeProbe = undefined; }
watch(downloadDialogVisible, (visible) => { if (!visible) cancelProbe(); });
onBeforeUnmount(cancelProbe);
function openDownload(file: ResourceFile) { cancelProbe(); selectedFile.value = file; downloadDialogVisible.value = true; cacheStatus.value = { edgeone: "checking", esa: "checking" }; const request = new AbortController(); activeProbe = request; const timeout = setTimeout(() => request.abort(), 8000); void Promise.all(cdnSources.map(async (source) => { const status = await probeRepositoryCdn(file, source.id, request.signal); if (activeProbe === request && downloadDialogVisible.value) cacheStatus.value[source.id] = status; })).finally(() => clearTimeout(timeout)); }
function readableBytes(bytes: number) { if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`; return `${bytes} B`; }
</script>

<template>
  <div class="repository-resources">
    <Toast position="top-right" />
    <div class="resource-toolbar">
      <IconField class="resource-search"><InputIcon class="pi pi-search" /><InputText v-model="query" placeholder="搜索文件名或路径" aria-label="搜索资料" /></IconField>
      <span class="file-summary" role="status">{{ query.trim() ? `${filteredFiles.length} / ${displayFiles.length} 个文件` : `${displayFiles.length} 个文件` }}</span>
    </div>
    <TreeTable v-if="fileTree.length" v-model:expanded-keys="expandedKeys" :value="fileTree" class="resource-tree" size="small" aria-label="资料文件">
      <Column field="name" header="文件名" expander>
        <template #body="{ node }"><button v-if="node.children" type="button" class="entry-name entry-folder" :aria-expanded="!!expandedKeys[node.key]" :title="node.data.path" @click="toggleFolder(node)"><i :class="expandedKeys[node.key] ? 'pi pi-folder-open' : 'pi pi-folder'" aria-hidden="true" /><span class="entry-text">{{ node.data.name }}</span></button><button v-else type="button" class="entry-name" :title="node.data.path" @click="openDownload(node.data.file)"><i class="pi pi-file" aria-hidden="true" /><span class="entry-text">{{ node.data.name }}<span class="mobile-file-size">{{ readableBytes(node.data.size) }}</span></span></button></template>
      </Column>
      <Column field="size" header="大小"><template #body="{ node }">{{ node.children ? readableBytes(node.data.size) : readableBytes(node.data.size) }}</template></Column>
      <Column header="下载"><template #body="{ node }"><Button v-if="!node.children" icon="pi pi-download" text rounded aria-label="下载资料" @click="openDownload(node.data.file)" /></template></Column>
    </TreeTable>
    <p v-else class="materials-empty">当前资料仓库没有可展示的资料。</p>
    <Dialog v-model:visible="downloadDialogVisible" modal header="选择下载线路" :style="{ width: 'min(560px, calc(100vw - 32px))' }">
      <div class="download-options"><a v-for="option in downloadOptions" :key="option.name" :href="option.href" target="_blank" rel="noopener noreferrer" class="download-option"><span><strong>{{ option.name }}</strong><small>{{ option.description }}</small></span><Tag :value="cacheTag(option.status).label" :severity="cacheTag(option.status).severity" /></a></div>
    </Dialog>
  </div>
</template>

<style scoped>
.repository-resources { min-width: 0; }
.resource-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.75rem; margin-bottom:1rem; }
.resource-search { flex:1 1 14rem; max-width:22rem; min-width:0; }
.resource-search :deep(input) { width:100%; }
.file-summary { color:var(--vp-c-text-2); font-size:13px; }
.entry-name { display:inline-flex; align-items:center; gap:.5rem; min-width:0; max-width:100%; padding:0; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.entry-folder { font-weight:500; }
.entry-text { min-width:0; overflow-wrap:anywhere; }
.mobile-file-size { display:none; margin-left:.5rem; color:var(--vp-c-text-2); font-size:12px; }
.download-options { display:grid; gap:.5rem; }
.download-option { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.75rem; border:1px solid var(--vp-c-divider); border-radius:8px; text-decoration:none; color:inherit; }
.download-option:hover { border-color:var(--vp-c-brand-1); }
.download-option span { display:grid; gap:.25rem; min-width:0; }
.download-option small { color:var(--vp-c-text-2); }
@media (max-width:640px) { .mobile-file-size { display:inline; } }
</style>

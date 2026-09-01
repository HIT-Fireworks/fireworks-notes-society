<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import Tag from "primevue/tag";
import TreeTable from "primevue/treetable";
import type { TreeNode } from "primevue/treenode";
import type { CourseDetailFile } from "../course-catalog";
import {
  repositoryRawUrl,
  repositorySiteDownloadUrl,
} from "../repository-resource-links";

const props = defineProps<{ files: CourseDetailFile[] }>();
const query = ref("");
const category = ref("all");
const expandedKeys = ref<Record<string, boolean>>({});

const categoryOptions = computed(() => [
  { label: "全部类型", value: "all" },
  ...Array.from(new Set(props.files.map((file) => file.routeKind)))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((value) => ({ label: value, value })),
]);

const filteredFiles = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  return props.files.filter((file) => {
    if (category.value !== "all" && file.routeKind !== category.value) return false;
    return (
      !normalized ||
      `${file.name} ${file.path} ${file.routeKind}`
        .toLowerCase()
        .includes(normalized)
    );
  });
});

interface ResourceNodeData {
  name: string;
  path: string;
  kind: string;
  size: number;
  file?: CourseDetailFile;
}

const fileTree = computed<TreeNode[]>(() => {
  const roots: TreeNode[] = [];
  const byKey = new Map<string, TreeNode>();
  for (const file of filteredFiles.value) {
    const parts = file.path.split("/");
    let children = roots;
    let currentPath = "";
    parts.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let node = byKey.get(currentPath);
      if (!node) {
        const isFile = index === parts.length - 1;
        node = {
          key: currentPath,
          data: {
            name,
            path: currentPath,
            kind: isFile ? file.routeKind : "文件夹",
            size: isFile ? file.size : 0,
            file: isFile ? file : undefined,
          } satisfies ResourceNodeData,
          icon: isFile ? fileIcon(name) : "pi pi-folder",
          children: isFile ? undefined : [],
          leaf: isFile,
        };
        byKey.set(currentPath, node);
        children.push(node);
      }
      if (node.children) children = node.children;
    });
  }
  if (query.value || category.value !== "all") {
    const expanded: Record<string, boolean> = {};
    for (const [key, node] of byKey) if (node.children) expanded[key] = true;
    expandedKeys.value = expanded;
  }
  return roots;
});

function fileIcon(name: string): string {
  if (/\.pdf$/i.test(name)) return "pi pi-file-pdf";
  if (/\.docx?$/i.test(name)) return "pi pi-file-word";
  if (/\.xlsx?$/i.test(name)) return "pi pi-file-excel";
  if (/\.(zip|7z|rar|tar|gz)$/i.test(name)) return "pi pi-box";
  return "pi pi-file";
}

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
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="query"
          type="search"
          size="small"
          placeholder="搜索文件名或目录"
          fluid
        />
      </IconField>
      <Select
        v-model="category"
        :options="categoryOptions"
        option-label="label"
        option-value="value"
        size="small"
        aria-label="资料类型"
      />
    </div>

    <TreeTable
      v-if="fileTree.length"
      v-model:expanded-keys="expandedKeys"
      :value="fileTree"
      class="resource-tree"
      size="small"
      scrollable
    >
      <Column expander field="name" header="文件">
        <template #body="{ node }">
          <span class="file-name">
            <i :class="node.icon" aria-hidden="true" />
            <span :title="node.data.path">{{ node.data.name }}</span>
          </span>
        </template>
      </Column>
      <Column field="kind" header="类型">
        <template #body="{ node }">
          <Tag
            v-if="node.data.file"
            :value="node.data.kind"
            severity="secondary"
          />
        </template>
      </Column>
      <Column field="size" header="大小">
        <template #body="{ node }">
          {{ node.data.file ? readableBytes(node.data.size) : "" }}
        </template>
      </Column>
      <Column header="下载">
        <template #body="{ node }">
          <span v-if="node.data.file" class="download-actions">
            <Button
              as="a"
              :href="repositorySiteDownloadUrl(node.data.file)"
              label="加速"
              icon="pi pi-download"
              size="small"
            />
            <Button
              as="a"
              :href="repositoryRawUrl(node.data.file)"
              label="直连代理"
              icon="pi pi-external-link"
              severity="secondary"
              variant="outlined"
              size="small"
              target="_blank"
              rel="noopener noreferrer"
            />
          </span>
        </template>
      </Column>
    </TreeTable>

    <Message v-else severity="secondary" variant="simple">
      没有找到匹配的文件。
    </Message>
  </div>
</template>

<style scoped>
.resource-browser {
  display: grid;
  gap: 0.75rem;
}

.resource-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.resource-tree :deep(.p-treetable-table-container) {
  border-radius: var(--p-content-border-radius);
}

.file-name,
.download-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.file-name {
  min-width: 0;
}

.file-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .resource-toolbar {
    grid-template-columns: 1fr;
  }

  .download-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

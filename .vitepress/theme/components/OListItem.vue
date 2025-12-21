<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { TreeNode } from "primevue/treenode";
import TreeTable from "primevue/treetable";
import type { TreeTableSortEvent } from "primevue/treetable";
import Column from "primevue/column";
import Fieldset from "primevue/fieldset";
import Button from "primevue/button";
import Skeleton from "primevue/skeleton";
import InputText from "primevue/inputtext";
import FloatLabel from "primevue/floatlabel";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import { data as defaultData } from "./alist.data.mjs";
import {
  fetchList,
  fetchListWithPassword,
  fetchHtmlAndComputeMd5,
} from "./alist.api.mjs";
import type { DataItem } from "./alist.api.mjs";

const toast = useToast();

const {
  path = "/",
  title = "吉の小网盘",
  host = "https://olist-eo.jwyihao.top",
} = defineProps<{
  path?: string;
  title?: string;
  host?: string;
}>();

// 下载源配置
interface DownloadSource {
  name: string;
  host: string;
  base: string;
  recommended?: boolean;
  description?: string;
}

const downloadSources: DownloadSource[] = [
  {
    name: "OneDrive 直连",
    host: "https://olist.jwyihao.top",
    base: "Fireworks",
    description: "直连 OneDrive，需要比较科学的网络环境",
  },
  {
    name: "EdgeOne 中转",
    host: "https://olist-eo.jwyihao.top",
    base: "Fireworks",
    recommended: true,
    description: "速度较快，但有 CDN 限速，推荐尝试",
  },
  {
    name: "ESA -> EO 中转",
    host: "https://olist-esa.jwyihao.top",
    base: "Fireworks",
    recommended: true,
    description: "命中缓存时速度最快，推荐尝试",
  },
  {
    name: "ESA -> EO -> VPS 中转",
    host: "https://olist.jwyihao.top",
    base: "Fireworks（EdgeOne）",
    description: "未命中缓存时速度较慢",
  },
];

// 下载弹窗状态
const downloadDialogVisible = ref(false);
const pendingDownloadNode = ref<TreeDataNode | null>(null);

interface TreeDataNode extends TreeNode {
  data: DataItem;
  children?: TreeDataNode[];
}

const data = ref<TreeDataNode[]>(
  path === "/"
    ? defaultData.map((item: DataItem, index: number) => {
        return {
          key: `${index}`,
          data: item,
          children: item.is_dir
            ? [
                {
                  key: `${index}-loading`,
                  data: {
                    name: "",
                    is_dir: true,
                    modified: new Date(),
                    size: 0,
                    path: "",
                  },
                  loading: true,
                },
              ]
            : undefined,
        };
      })
    : [
        {
          key: "loading",
          data: {
            name: "",
            is_dir: true,
            modified: new Date(),
            size: 0,
            path: "",
          },
          loading: true,
        },
      ],
);

const filters = ref<Record<string, string>>({});

const filteredData = computed(() => {
  return data.value.filter((node) => {
    if (filters.value.name && !node.data.name.includes(filters.value.name)) {
      return false;
    }
    return true;
  });
});

const expandedKeys = ref<Record<string, boolean>>({});
const selectedKeys =
  ref<Record<string, { checked: boolean; partialChecked: boolean }>>();

function normalizeSize(size: number): string {
  if (size < 1024) {
    return size + " B";
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + " KB";
  } else if (size < 1024 * 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(2) + " MB";
  } else {
    return (size / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }
}

// 打开下载选择对话框
function openDownloadDialog(node: TreeDataNode) {
  pendingDownloadNode.value = node;
  downloadDialogVisible.value = true;
}

// 执行实际下载
async function executeDownload(
  node: TreeDataNode,
  downloadHost: string,
  downloadBase: string,
) {
  if (node.data.is_dir) {
    if (node.children?.[0]?.loading) {
      await onExpand(node);
    }
    for (const child of node.children ?? []) {
      await executeDownload(child, downloadHost, downloadBase);
    }
  } else {
    const filePath = node.data.path.replace(/^\/+/, ""); // 移除开头的斜杠
    const url = `${downloadHost}/d/${downloadBase}/${filePath}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = node.data.name;
    a.click();
    a.remove();
    await new Promise((resolve) => {
      setTimeout(
        () => {
          nextTick(() => {
            resolve(true);
          });
        },
        5000 + node.data.size / 8000,
      );
    });
  }
}

// 使用选定源下载
async function downloadWithSource(source: (typeof downloadSources)[0]) {
  if (!pendingDownloadNode.value) return;
  downloadDialogVisible.value = false;
  await executeDownload(pendingDownloadNode.value, source.host, source.base);
}

async function groupDownload() {
  const selected = Object.entries(selectedKeys.value ?? {}).filter(
    ([, value]) => value.checked && value.partialChecked === false,
  );
  // 如果选中了文件，打开对话框让用户选择下载源
  if (selected.length > 0) {
    const firstKey = selected[0][0];
    const node = data.value.find((item) => item.key === firstKey);
    if (node) {
      openDownloadDialog(node);
    }
  }
}

const onExpand = async (node: TreeDataNode) => {
  if (node.children?.[0]?.loading) {
    const children = await fetchList(node.data.path, host);
    node.children = children.map((item: DataItem, index: number) => {
      return {
        key: `${node.key}-${index}`,
        data: item,
        children: item.is_dir
          ? [
              {
                key: `${node.key}-${index}-loading`,
                data: {
                  name: "",
                  is_dir: true,
                  modified: new Date(),
                  size: 0,
                  path: "",
                },
                loading: true,
              },
            ]
          : undefined,
      };
    });
  }
};

const onSort = (event: TreeTableSortEvent) => {
  data.value = data.value.sort((a, b) => {
    const field = event.sortField as keyof DataItem;
    const order = event.sortOrder ?? 1;
    if (a.data[field] < b.data[field]) {
      return -1 * order;
    } else if (a.data[field] > b.data[field]) {
      return 1 * order;
    } else {
      return 0;
    }
  });
};

// 校园网检测：尝试获取隐藏的"校内资源"文件夹
async function tryCampusNetworkDetection() {
  try {
    // 1. 获取 campus-url.txt
    const urlRes = await fetch("/campus-url.txt");
    if (!urlRes.ok) {
      console.log("[Campus] campus-url.txt not found");
      return;
    }
    const campusUrl = (await urlRes.text()).trim();
    if (!campusUrl) return;

    // 2. 尝试获取该 URL 并计算 MD5
    const md5 = await fetchHtmlAndComputeMd5(campusUrl);
    // console.log("[Campus] MD5 computed:", md5);

    // 3. 使用 MD5 作为密码请求校内资源
    const campusItems = await fetchListWithPassword(
      "/校内资源",
      host,
      "Fireworks",
      md5,
    );

    // 4. 成功！添加到列表
    const campusNode: TreeDataNode = {
      key: `campus-${data.value.length}`,
      data: {
        name: "🏫 校内资源",
        is_dir: true,
        modified: new Date(),
        size: 0,
        path: "/校内资源",
      },
      children: campusItems.map((item: DataItem, index: number) => ({
        key: `campus-${data.value.length}-${index}`,
        data: item,
        children: item.is_dir
          ? [
              {
                key: `campus-${data.value.length}-${index}-loading`,
                data: {
                  name: "",
                  is_dir: true,
                  modified: new Date(),
                  size: 0,
                  path: "",
                },
                loading: true,
              },
            ]
          : undefined,
      })),
    };

    data.value = [...data.value, campusNode];

    toast.add({
      severity: "success",
      summary: "校园网已连接",
      detail: "已解锁校内资源文件夹",
      life: 5000,
    });
  } catch (error) {
    // 检测失败（非校园网或其他错误），静默忽略
    console.log("[Campus] Detection failed:", error);
  }
}

onMounted(async () => {
  data.value = (await fetchList(path, host)).map(
    (item: DataItem, index: number) => {
      return {
        key: `${index}`,
        data: item,
        children: item.is_dir
          ? [
              {
                key: `${index}-loading`,
                data: {
                  name: "",
                  is_dir: true,
                  modified: new Date(),
                  size: 0,
                  path: "",
                },
                loading: true,
              },
            ]
          : undefined,
      };
    },
  );

  // 异步执行校园网检测，不阻塞主加载
  tryCampusNetworkDetection();
});
</script>

<template>
  <div class="flex flex-col items-end w-full" ref="alist">
    <Toast />
    <FloatLabel variant="on">
      <InputText id="search_alist" v-model="filters['name']" />
      <label for="search_alist">搜索</label>
    </FloatLabel>
    <Fieldset
      :legend="title"
      class="w-full alist-container"
      :pt="{
        contentContainer: {
          style: {
            width: '100%',
            contain: 'inline-size',
          },
        },
      }"
    >
      <TreeTable
        v-model:expandedKeys="expandedKeys"
        v-model:selectionKeys="selectedKeys"
        :value="filteredData"
        selectionMode="checkbox"
        lazy
        scrollable
        @nodeExpand="onExpand"
        @sort="onSort"
      >
        <Column expander>
          <template #header>
            <Button
              :icon="'pi pi-download'"
              size="small"
              class="h-(--p-button-sm-icon-only-width)"
              aria-label="Download"
              @click="groupDownload"
            />
          </template>
          <template #body="{ node }">
            <i v-if="node.loading" class="pi pi-spin pi-spinner" />
            <Button
              v-else-if="node.data.is_dir"
              :icon="
                expandedKeys[node.key] ? 'pi pi-folder-open' : 'pi pi-folder'
              "
              variant="text"
              severity="secondary"
              rounded
              :aria-label="expandedKeys[node.key] ? 'Collapse' : 'Expand'"
              @click="
                () => {
                  expandedKeys[node.key] = !expandedKeys[node.key];
                  if (expandedKeys[node.key]) {
                    onExpand(node);
                  }
                }
              "
            />
            <i
              v-else-if="/\.pdf$/.test(node.data.name)"
              class="pi pi-file-pdf"
            />
            <i
              v-else-if="/\.doc(x)?$/.test(node.data.name)"
              class="pi pi-file-word"
            />
            <i
              v-else-if="/\.xls(x)?$/.test(node.data.name)"
              class="pi pi-file-excel"
            />
            <i v-else class="pi pi-file" />
          </template>
        </Column>
        <Column field="name" header="文件名" sortable>
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              {{ node.data.name }}
            </template>
          </template>
        </Column>
        <Column field="modified" header="修改时间" sortable>
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              {{ node.data.modified.toLocaleString() }}
            </template>
          </template>
        </Column>
        <Column field="size" header="文件大小" sortable>
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              {{ normalizeSize(node.data.size) }}
            </template>
          </template>
        </Column>
        <Column>
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              <Button
                :icon="'pi pi-download'"
                size="small"
                aria-label="Download"
                severity="secondary"
                rounded
                @click="openDownloadDialog(node)"
              />
            </template>
          </template>
        </Column>
      </TreeTable>
    </Fieldset>

    <!-- 下载线路选择弹窗 -->
    <Dialog
      v-model:visible="downloadDialogVisible"
      modal
      header="选择下载线路"
      :style="{ width: '22rem' }"
    >
      <div class="flex flex-col gap-2">
        <Button
          v-for="source in downloadSources"
          :key="source.name"
          severity="secondary"
          variant="outlined"
          class="w-full flex-col items-start! gap-1! b-2!"
          @click="downloadWithSource(source)"
        >
          <div class="flex items-center gap-1.5">
            <Tag
              v-if="source.recommended"
              value="推荐"
              severity="success"
              rounded
              :pt="{
                root: {
                  style: {
                    padding: '0px 0.5rem',
                    fontSize: '0.65rem',
                    lineHeight: '1.25rem',
                  },
                },
              }"
            />
            <span class="font-medium">{{ source.name }}</span>
          </div>
          <span v-if="source.description" class="text-xs opacity-80 text-left">
            {{ source.description }}
          </span>
        </Button>
      </div>
    </Dialog>
  </div>
</template>

<style>
.alist-container.p-fieldset {
  padding: 0;
  overflow: hidden;
}

.alist-container .p-fieldset-legend {
  margin-left: 1.125rem;
  margin-bottom: -19.5px;
  position: relative;
  z-index: 2;
  background: linear-gradient(
    to bottom,
    var(--p-fieldset-legend-background) 51%,
    transparent 51%
  );
  border: none;
}

.alist-container .p-treetable-table {
  display: table;
  margin: unset;
  border-collapse: separate;
}

.alist-container .p-treetable-table tr {
  background-color: unset;
  border-top: unset;
  transition: unset;
}

.alist-container .p-treetable-header-cell {
  padding: var(--p-treetable-header-cell-padding);
  background: var(--p-treetable-header-cell-background);
  border-color: var(--p-treetable-header-cell-border-color);
  border-style: solid;
  border-width: 0 0 1px 0;
  color: var(--p-treetable-header-cell-color);
  font-weight: normal;
  text-align: start;
}

.alist-container .p-treetable-tbody > tr {
  outline-color: transparent;
  background: var(--p-treetable-row-background);
  color: var(--p-treetable-row-color);
  transition:
    background var(--p-treetable-transition-duration),
    color var(--p-treetable-transition-duration),
    border-color var(--p-treetable-transition-duration),
    outline-color var(--p-treetable-transition-duration),
    box-shadow var(--p-treetable-transition-duration);
}

.alist-container .p-treetable-node-toggle-button {
  visibility: hidden !important;
  width: 0 !important;
  margin-right: -0.5rem;
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { TreeNode } from "primevue/treenode";
import TreeTable from "primevue/treetable";
import Column from "primevue/column";
import Fieldset from "primevue/fieldset";
import Button from "primevue/button";
import Skeleton from "primevue/skeleton";
import InputText from "primevue/inputtext";
import FloatLabel from "primevue/floatlabel";

const {
  path = "/",
  title = "吉の小网盘",
  base = "https://alist.jwyihao.top",
} = defineProps<{
  path?: string;
  title?: string;
  base?: string;
}>();

interface DataItem {
  name: string;
  is_dir: boolean;
  modified: Date;
  size: number;
  path: string;
}

interface TreeDataNode extends TreeNode {
  data: DataItem;
  children?: TreeDataNode[];
}

const data = ref<TreeDataNode[]>([
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
]);

const filters = ref<Record<string, string>>({});

const filteredData = computed(() => {
  return data.value.filter((node) => {
    if (filters.value.name && !node.data.name.includes(filters.value.name)) {
      return false;
    }
    return true;
  });
});

const expandedKeys = ref({});
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

async function fetchList(path: string = "/") {
  const res = await fetch(`${base}/api/fs/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "",
    },
    body: JSON.stringify({
      path: `/Fireworks/${path}`,
    }),
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw "Error fetching data:" + data;
  }
  return data.data.content.map((item: any) => {
    return {
      name: item.name,
      is_dir: item.is_dir,
      modified: new Date(item.modified),
      size: item.size,
      path: `${path}/${item.name}`,
    };
  });
}

async function download(node: TreeDataNode) {
  if (node.data.is_dir) {
    if (node.children?.[0].loading) {
      await onExpand(node);
    }
    for (const child of node.children ?? []) {
      await download(child);
    }
  } else {
    const url = `${base}/d/Fireworks/${node.data.path}`;
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

async function groupDownload() {
  const selected = Object.entries(selectedKeys.value ?? {}).filter(
    ([, value]) => value.checked && value.partialChecked === false,
  );
  for (const [key] of selected) {
    const node = data.value.find((item) => item.key === key);
    if (node) {
      await download(node);
    }
  }
}

const onExpand = async (node) => {
  if (node.children[0].loading) {
    const children = await fetchList(node.data.path);
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

const onSort = (event) => {
  data.value = data.value.sort((a, b) => {
    const field = event.sortField;
    const order = event.sortOrder;
    if (a.data[field] < b.data[field]) {
      return -1 * order;
    } else if (a.data[field] > b.data[field]) {
      return 1 * order;
    } else {
      return 0;
    }
  });
};

onMounted(async () => {
  data.value = (await fetchList(path)).map((item: DataItem, index: number) => {
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
  });
});
</script>

<template>
  <div class="flex flex-col items-end w-full" ref="alist">
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
                @click="download(node)"
              />
            </template>
          </template>
        </Column>
      </TreeTable>
    </Fieldset>
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

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

// 校园网检测：使用图片验证
interface CampusVerifyData {
  images: Array<{ url: string; md5: string }>;
  generatedAt: string;
}

async function tryCampusNetworkDetection() {
  try {
    // 1. 获取验证数据
    const configRes = await fetch("/campus-verify.json");
    if (!configRes.ok) {
      console.log("[Campus] campus-verify.json not found");
      return;
    }
    const config: CampusVerifyData = await configRes.json();

    if (!config.images || config.images.length === 0) {
      console.log("[Campus] No verification images configured");
      return;
    }

    // 2. 并行加载所有图片并计算各自的密码
    console.log(`[Campus] Loading ${config.images.length} images...`);
    const passwordPromises = config.images.map((imgData) =>
      tryLoadImageAndComputePassword(imgData.url, imgData.md5),
    );
    const passwords = await Promise.all(passwordPromises);

    // 过滤掉失败的（null）
    const validPasswords = passwords.filter((p): p is string => p !== null);
    console.log(
      `[Campus] ${validPasswords.length}/${config.images.length} images loaded`,
    );

    if (validPasswords.length === 0) {
      console.log("[Campus] No images could be loaded");
      return;
    }

    // 3. 将所有密码排序后拼接，计算综合MD5
    const sortedPasswords = [...validPasswords].sort();
    const combinedPassword = computeMd5Inline(sortedPasswords.join(""));
    console.log(
      `[Campus] Combined password from ${validPasswords.length} images`,
    );

    // 4. 使用综合密码请求校内资源
    const campusItems = await fetchListWithPassword(
      "/校内资源",
      host,
      "Fireworks",
      combinedPassword,
    );

    // 5. 成功！添加到列表
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
    console.log("[Campus] Detection failed:", error);
  }
}

// 加载图片并使用尺寸计算密码
function tryLoadImageAndComputePassword(
  url: string,
  realMd5: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // 不设置 crossOrigin - 只需要获取尺寸，不需要读取图片数据，因此不需要 CORS

    const timeout = setTimeout(() => {
      resolve(null);
    }, 10000); // 10秒超时

    img.onload = () => {
      clearTimeout(timeout);
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      if (width === 0 || height === 0) {
        resolve(null);
        return;
      }

      // 使用MD5(realMd5 + 尺寸)作为密码
      const dimsStr = `${width}x${height}`;
      const password = md5(realMd5 + dimsStr);
      resolve(password);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    img.src = url;
  });
}

// MD5 函数已在 alist.api.mts 中定义，这里调用
function md5(str: string): string {
  // 调用 alist.api.mts 中已有的 MD5 实现
  return (window as any).__campusMd5?.(str) || computeMd5Inline(str);
}

// 内联MD5实现备用
function computeMd5Inline(string: string): string {
  function rotateLeft(value: number, shift: number): number {
    return (value << shift) | (value >>> (32 - shift));
  }
  function addUnsigned(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function F(x: number, y: number, z: number): number {
    return (x & y) | (~x & z);
  }
  function G(x: number, y: number, z: number): number {
    return (x & z) | (y & ~z);
  }
  function H(x: number, y: number, z: number): number {
    return x ^ y ^ z;
  }
  function I(x: number, y: number, z: number): number {
    return y ^ (x | ~z);
  }
  function FF(
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number,
  ): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), t));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number,
  ): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), t));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number,
  ): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), t));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number,
  ): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), t));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(str: string): number[] {
    const utf8 = unescape(encodeURIComponent(str));
    const length = utf8.length;
    const wordCount = ((length + 8) >>> 6) + 1;
    const words: number[] = new Array(wordCount * 16).fill(0);
    for (let i = 0; i < length; i++) {
      words[i >>> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
    }
    words[length >>> 2] |= 0x80 << ((length % 4) * 8);
    words[wordCount * 16 - 2] = length * 8;
    return words;
  }
  function wordToHex(value: number): string {
    let hex = "";
    for (let i = 0; i <= 3; i++) {
      const byte = (value >>> (i * 8)) & 0xff;
      hex += ("0" + byte.toString(16)).slice(-2);
    }
    return hex;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;
  const S11 = 7,
    S12 = 12,
    S13 = 17,
    S14 = 22,
    S21 = 5,
    S22 = 9,
    S23 = 14,
    S24 = 20,
    S31 = 4,
    S32 = 11,
    S33 = 16,
    S34 = 23,
    S41 = 6,
    S42 = 10,
    S43 = 15,
    S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a,
      BB = b,
      CC = c,
      DD = d;
    a = FF(a, b, c, d, x[k], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
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

  // 异步执行校园网检测，只在根目录时执行
  if (path === "/") {
    tryCampusNetworkDetection();
  }
});
</script>

<template>
  <div class="flex flex-col items-end w-full" ref="alist">
    <Toast
      :breakpoints="{
        '575px': { width: 'calc(100% - 2rem)', right: '1rem', left: '1rem' },
      }"
      :dt="{
        summaryFontSize: '0.875rem',
        detailFontSize: '0.8rem',
        iconSize: '1.25rem',
        contentPadding: '0.75rem',
        contentGap: '0.5rem',
      }"
      :pt="{
        closeButton: { style: { display: 'none' } },
      }"
    />
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
            overflow: 'auto',
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
        <Column
          field="name"
          header="文件名"
          sortable
          :style="{ minWidth: '120px' }"
        >
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              {{ node.data.name }}
            </template>
          </template>
        </Column>
        <Column
          field="modified"
          header="修改时间"
          sortable
          :style="{ minWidth: '140px' }"
        >
          <template #body="{ node }">
            <Skeleton v-if="node.loading" />
            <template v-else>
              {{ node.data.modified.toLocaleString() }}
            </template>
          </template>
        </Column>
        <Column
          field="size"
          header="文件大小"
          sortable
          :style="{ minWidth: '80px' }"
        >
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

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
import { toUtf8BinaryString } from "./md5-utf8.mjs";

const toast = useToast();

/**
 * AList / OList 文件列表组件。
 *
 * - 展示远端目录树（支持懒加载）
 * - 支持过滤、排序与下载（含多下载线路选择）
 * - 根目录下可尝试解锁“校内资源”目录
 * @component
 */
const {
  path = "/",
  title = "吉の小网盘",
  host = "https://olist-eo.jwyihao.top",
} = defineProps<{
  /**
   * 初始加载的目录路径（AList 路径）。
   *
   * - 当为 `/` 时会优先展示 `alist.data.mjs` 内置的默认数据（避免首屏空白），随后再拉取真实列表。
   *
   * @default "/"
   */
  path?: string;
  /**
   * UI 上 Fieldset 的标题。
   * @default "吉の小网盘"
   */
  title?: string;
  /**
   * AList 服务端地址（用于 `fetchList` 等 API 请求）。
   * @default "https://olist-eo.jwyihao.top"
   */
  host?: string;
}>();

// 下载源配置
interface DownloadSource {
  name: string;
  host: string;
  base: string;
  cacheHeaders?: string[]; // 用于检测缓存命中的 Header 名称列表
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
    cacheHeaders: ["EO-Cache-Status"],
    description: "速度较快，但有 CDN 限速，推荐尝试",
  },
  {
    name: "ESA -> EO 中转",
    host: "https://olist-esa.jwyihao.top",
    base: "Fireworks",
    cacheHeaders: ["X-Site-Cache-Status", "EO-Cache-Status"],
    description: "命中缓存时速度最快，推荐尝试",
  },
];

// 缓存状态类型
interface CacheStatusInfo {
  status: "checking" | "hit" | "secondary" | "miss" | "percentage";
  hitRate?: number; // 0-100，用于文件夹的命中百分比
}

// 每个下载源的缓存状态
const cacheStatusMap = ref<Record<string, CacheStatusInfo | null>>({});

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

/**
 * 将字节数格式化为人类可读的文件大小字符串。
 * @param size 文件大小（单位：Byte）
 */
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

// 递归收集所有文件（用于文件夹的缓存检测）
// 如果子文件夹未加载，会通过 API 获取
/**
 * 递归收集某个目录下的所有“文件路径”（不含文件夹），用于缓存命中率检测。
 *
 * @param folderPath 目标文件夹路径
 * @param sourceHost 下载源 host（用于 list API）
 * @param sourceBase 下载源 base
 * @returns 文件路径数组（可能为空；失败时返回空数组并记录错误日志）
 */
async function collectAllFilesForCacheCheck(
  folderPath: string,
  sourceHost: string,
  sourceBase: string,
): Promise<string[]> {
  try {
    const items = await fetchList(folderPath, sourceHost, sourceBase);
    const files: string[] = [];

    for (const item of items) {
      if (item.is_dir) {
        // 递归获取子文件夹中的文件
        const subFiles = await collectAllFilesForCacheCheck(
          item.path,
          sourceHost,
          sourceBase,
        );
        files.push(...subFiles);
      } else {
        files.push(item.path);
      }
    }

    return files;
  } catch (e) {
    console.error(`[Cache] Failed to list folder ${folderPath}:`, e);
    return [];
  }
}

// 检测单个文件的缓存状态，返回 'hit' | 'secondary' | 'miss'
/**
 * 检测单个文件节点在某个下载源上的缓存状态。
 * @returns
 * - `"hit"`：主缓存命中
 * - `"secondary"`：二级缓存命中
 * - `"miss"`：未命中
 * - `null`：该下载源未配置缓存检测 Header 或检测失败
 */
async function checkSingleFileCacheStatus(
  source: DownloadSource,
  fileNode: TreeDataNode,
): Promise<"hit" | "secondary" | "miss" | null> {
  return checkSingleFileCacheStatusByPath(source, fileNode.data.path);
}

// 检测单个文件的缓存状态（通过路径）
/**
 * 通过文件路径对某个下载源执行缓存命中检测（使用 `HEAD` 请求读取响应头）。
 *
 * 注意：仅当下载源配置了 `cacheHeaders` 时生效。
 */
async function checkSingleFileCacheStatusByPath(
  source: DownloadSource,
  filePath: string,
): Promise<"hit" | "secondary" | "miss" | null> {
  if (!source.cacheHeaders || source.cacheHeaders.length === 0) return null;

  try {
    const cleanPath = filePath.replace(/^\/+/, "");
    const encodedPath = cleanPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `${source.host}/d/${source.base}/${encodedPath}`;

    const res = await fetch(url, { method: "HEAD" });
    const headerValues = source.cacheHeaders.map((h) => res.headers.get(h));

    const firstHit = headerValues[0] === "HIT";
    const anyHit = headerValues.some((v) => v === "HIT");

    if (firstHit) return "hit";
    if (anyHit) return "secondary";
    return "miss";
  } catch (e) {
    console.error(`[Cache] Failed to check file:`, e);
    return null;
  }
}

// 检测缓存命中状态（主函数）
/**
 * 对指定节点（文件/文件夹）执行缓存状态检测，并把结果写入 `cacheStatusMap`。
 *
 * - 文件：检测一次并标注命中/未命中
 * - 文件夹：递归列出所有文件，并并行检测每个文件的命中情况，最终计算命中率
 */
async function checkCacheStatus(source: DownloadSource, node: TreeDataNode) {
  if (!source.cacheHeaders || source.cacheHeaders.length === 0) return;

  // 设置检测中状态
  cacheStatusMap.value[source.name] = { status: "checking" };

  try {
    if (!node.data.is_dir) {
      // 单文件检测
      const result = await checkSingleFileCacheStatus(source, node);
      if (result === null) {
        cacheStatusMap.value[source.name] = null;
      } else {
        cacheStatusMap.value[source.name] = { status: result };
      }
    } else {
      // 文件夹检测 - 通过 API 获取所有文件并计算命中率
      const allFilePaths = await collectAllFilesForCacheCheck(
        node.data.path,
        source.host,
        source.base,
      );
      if (allFilePaths.length === 0) {
        cacheStatusMap.value[source.name] = null;
        return;
      }

      // 并行检测所有文件
      const results = await Promise.all(
        allFilePaths.map((path) =>
          checkSingleFileCacheStatusByPath(source, path),
        ),
      );

      // 计算命中率（hit 和 secondary 都算命中）
      const validResults = results.filter(
        (r): r is "hit" | "secondary" | "miss" => r !== null,
      );
      if (validResults.length === 0) {
        cacheStatusMap.value[source.name] = null;
        return;
      }

      const hitCount = validResults.filter(
        (r) => r === "hit" || r === "secondary",
      ).length;
      const hitRate = Math.round((hitCount / validResults.length) * 100);

      cacheStatusMap.value[source.name] = {
        status: "percentage",
        hitRate,
      };
    }
  } catch (e) {
    console.error(`[Cache] Failed to check ${source.name}:`, e);
    cacheStatusMap.value[source.name] = null;
  }
}

// 打开下载选择对话框
/**
 * 打开“下载线路选择”对话框，并对支持缓存检测的线路异步发起检测。
 */
function openDownloadDialog(node: TreeDataNode) {
  pendingDownloadNode.value = node;
  downloadDialogVisible.value = true;

  // 重置缓存状态并异步检测
  cacheStatusMap.value = {};
  for (const source of downloadSources) {
    if (source.cacheHeaders) {
      checkCacheStatus(source, node);
    }
  }
}

// 执行实际下载
/**
 * 执行下载：
 * - 若为文件夹：递归下载其子文件（必要时先触发加载子目录）。
 * - 若为文件：构造下载链接并触发浏览器下载。
 *
 * 说明：这里使用创建 `<a>` 并点击的方式触发下载；为了避免过快触发导致浏览器拦截，
 * 会按文件大小进行一定的延时。
 */
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
    const encodedPath = filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `${downloadHost}/d/${downloadBase}/${encodedPath}`;
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
/**
 * 使用用户选择的下载源开始下载（会关闭对话框）。
 */
async function downloadWithSource(source: (typeof downloadSources)[0]) {
  if (!pendingDownloadNode.value) return;
  downloadDialogVisible.value = false;
  await executeDownload(pendingDownloadNode.value, source.host, source.base);
}

/**
 * 批量下载入口：当勾选了若干条目时，取第一个条目作为下载起点并弹出线路选择。
 */
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

const CAMPUS_VERIFY_CONFIG_URL = "/campus-verify.json";
const CAMPUS_IMAGE_HOST = "zb.hit.edu.cn";
const CAMPUS_IMAGE_PATH_PREFIXES = ["/upload/hit/image/", "/images/help/"];

function normalizeCampusImageUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    const pathname = parsed.pathname.replace(/^\/+/, "/");

    if (parsed.protocol !== "https:" || parsed.hostname !== CAMPUS_IMAGE_HOST) {
      return null;
    }

    if (
      !CAMPUS_IMAGE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      return null;
    }

    parsed.pathname = pathname;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 尝试进行校园网检测，并在成功时把“校内资源”目录追加到列表中。
 */
async function tryCampusNetworkDetection() {
  try {
    // 1. 获取验证数据
    const configRes = await fetch(CAMPUS_VERIFY_CONFIG_URL, {
      cache: "no-cache",
    });
    if (!configRes.ok) {
      console.log("[Campus] campus-verify.json not found");
      return;
    }
    const config: CampusVerifyData = await configRes.json();

    if (!config.images || config.images.length === 0) {
      console.log("[Campus] No verification images configured");
      return;
    }

    const verificationImages = config.images.flatMap((imgData) => {
      const normalizedUrl = normalizeCampusImageUrl(imgData.url);
      if (!normalizedUrl) {
        console.warn(
          `[Campus] Ignoring invalid verification image: ${imgData.url}`,
        );
        return [];
      }

      return [{ ...imgData, url: normalizedUrl }];
    });

    if (verificationImages.length === 0) {
      console.log("[Campus] No valid verification images configured");
      return;
    }

    // 2. 并行加载所有图片并计算各自的密码
    console.log(`[Campus] Loading ${verificationImages.length} images...`);
    const passwordPromises = verificationImages.map((imgData) =>
      tryLoadImageAndComputePassword(imgData.url, imgData.md5),
    );
    const passwords = await Promise.all(passwordPromises);

    // 过滤掉失败的（null）
    const validPasswords = passwords.filter((p): p is string => p !== null);
    console.log(
      `[Campus] ${validPasswords.length}/${verificationImages.length} images loaded`,
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
/**
 * 加载一张图片，仅通过其自然尺寸（不读取像素数据）计算访问密码。
 *
 * @param url 图片 URL
 * @param realMd5 图片内容的真实 MD5（来自配置文件，用作盐）
 * @returns 密码字符串；加载/超时/尺寸异常则返回 `null`
 */
function tryLoadImageAndComputePassword(
  url: string,
  realMd5: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // 不设置 crossOrigin - 只需要获取尺寸，不需要读取图片数据，因此不需要 CORS

    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = (cancelLoad: boolean) => {
      clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      if (cancelLoad) {
        img.src = "";
      }
    };

    const finish = (value: string | null, cancelLoad: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(cancelLoad);
      resolve(value);
    };

    timeout = setTimeout(() => {
      finish(null, true);
    }, 5000);

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      if (width === 0 || height === 0) {
        finish(null, false);
        return;
      }

      // 使用MD5(realMd5 + 尺寸)作为密码
      const dimsStr = `${width}x${height}`;
      const password = md5(realMd5 + dimsStr);
      finish(password, false);
    };

    img.onerror = () => {
      finish(null, true);
    };

    img.src = url;
  });
}

// MD5 函数已在 alist.api.mts 中定义，这里调用
/**
 * 计算字符串 MD5。
 *
 * - 优先使用页面全局注入的实现（`window.__campusMd5`）
 * - 若不存在则回退到本文件的 `computeMd5Inline`
 */
function md5(str: string): string {
  // 调用 alist.api.mts 中已有的 MD5 实现
  return (window as any).__campusMd5?.(str) || computeMd5Inline(str);
}

// 内联MD5实现备用
/**
 * 备用的内联 MD5 实现（用于无法获取外部实现时）。
 *
 * 注意：这是为“校园网检测”准备的兜底实现，性能不是重点。
 */
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
    const utf8 = toUtf8BinaryString(str);
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
            <!-- 缓存检测中 -->
            <Tag
              v-if="cacheStatusMap[source.name]?.status === 'checking'"
              severity="warn"
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
            >
              <i class="pi pi-spin pi-spinner mr-1" style="font-size: 0.6rem" />
              检测中
            </Tag>
            <!-- 缓存命中 -->
            <Tag
              v-else-if="cacheStatusMap[source.name]?.status === 'hit'"
              value="缓存命中"
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
            <!-- 二级命中 -->
            <Tag
              v-else-if="cacheStatusMap[source.name]?.status === 'secondary'"
              value="二级命中"
              severity="warn"
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
            <!-- 未命中 -->
            <Tag
              v-else-if="cacheStatusMap[source.name]?.status === 'miss'"
              value="未命中"
              severity="danger"
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
            <!-- 文件夹命中率 -->
            <Tag
              v-else-if="cacheStatusMap[source.name]?.status === 'percentage'"
              :value="`${cacheStatusMap[source.name]?.hitRate}%命中`"
              :severity="
                (cacheStatusMap[source.name]?.hitRate ?? 0) >= 80
                  ? 'success'
                  : (cacheStatusMap[source.name]?.hitRate ?? 0) >= 50
                    ? 'warn'
                    : 'danger'
              "
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

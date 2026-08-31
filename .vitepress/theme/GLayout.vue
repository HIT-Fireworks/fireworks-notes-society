<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { nextTick, provide, watch } from "vue";
import { useData } from "vitepress";
import { createMermaidRenderer } from "vitepress-mermaid-renderer";

const { isDark } = useData();

const { Layout } = DefaultTheme;

const enableTransitions = () =>
  "startViewTransition" in document &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

provide("toggle-appearance", async ({ clientX: x, clientY: y }: MouseEvent) => {
  if (!enableTransitions()) {
    isDark.value = !isDark.value;
    return;
  }

  const clipPath = [
    `circle(0px at ${x}px ${y}px)`,
    `circle(${Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y),
    )}px at ${x}px ${y}px)`,
  ];

  await document.startViewTransition(async () => {
    isDark.value = !isDark.value;
    await nextTick();
  }).ready;

  document.documentElement.animate(
    { clipPath: isDark.value ? clipPath.reverse() : clipPath },
    {
      duration: 300,
      easing: "ease-in",
      pseudoElement: `::view-transition-${isDark.value ? "old" : "new"}(root)`,
    },
  );
});

const initMermaid = () => {
  const mermaidRenderer = createMermaidRenderer({
    theme: isDark.value ? "dark" : "forest",
  });
};

// initial mermaid setup
nextTick(() => initMermaid());

// on theme change, re-render mermaid charts
watch(
  () => isDark.value,
  () => {
    initMermaid();
  },
);
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <a
        class="github-star-link"
        href="https://github.com/HIT-Fireworks/fireworks-notes-society"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="在 GitHub 上查看薪火笔记社 Stars"
      >
        <img
          src="https://img.shields.io/github/stars/HIT-Fireworks/fireworks-notes-society"
          alt="GitHub Stars"
        />
      </a>
    </template>
  </Layout>
</template>

<style>
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

::view-transition-old(root),
.dark::view-transition-new(root) {
  z-index: 1;
}

::view-transition-new(root),
.dark::view-transition-old(root) {
  z-index: 9999;
}

.VPSwitchAppearance {
  width: 22px !important;
}

.VPSwitchAppearance .check {
  transform: none !important;
}
.github-star-link {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: 24px;
  margin-right: 12px;
  line-height: 0;
}

.github-star-link img {
  display: block;
  width: auto;
  height: 20px;
}
</style>

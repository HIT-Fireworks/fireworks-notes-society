<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  path?: string;
  caption?: string;
}>();

const REPO = "https://github.com/HITLittleZheng/HITCS";

const href = computed(() =>
  props.path ? `${REPO}/tree/main${props.path}` : REPO
);

const displayCaption = computed(() => {
  if (props.caption) return props.caption;
  return "查看 HITCS 的更多资料";
});
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="hitcs-link-card no-icon"
  >
    <span class="pi pi-github hitcs-link-icon" />
    <span class="hitcs-link-text">{{ displayCaption }}</span>
    <span class="pi pi-arrow-up-right hitcs-link-arrow" />
  </a>
</template>

<style>
.hitcs-link-card {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-decoration: none !important;
  font-size: 0.875rem;
  font-weight: 500;
  transition: border-color 0.25s, background-color 0.25s, color 0.25s;
  line-height: 1.5;
}

.hitcs-link-card:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-alt);
  text-decoration: none !important;
}

.hitcs-link-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
  text-decoration: none !important;
}

.hitcs-link-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hitcs-link-arrow {
  font-size: 0.75rem;
  opacity: 0.6;
  flex-shrink: 0;
}
</style>

<script setup lang="ts">
import OListItem from "./OListItem.vue";

const { path = "/" } = defineProps<{
  path?: string;
}>();
</script>

<template>
  <OListItem :path="path" />
</template>

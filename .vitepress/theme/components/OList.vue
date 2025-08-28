<script setup lang="ts">
import { defineProps } from "vue";
import OListItem from "./OListItem.vue";

const { path = "/" } = defineProps<{
  path?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <OListItem :path="path" />

    <OListItem
      :path="path"
      title="吉の小网盘（EdgeOne）"
      base="Fireworks（EdgeOne）"
    />
  </div>
</template>

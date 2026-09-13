<script setup lang="ts">
import type { StoryStore } from '../lib/store';

const props = defineProps<{ store: StoryStore }>();
const store = props.store;
</script>

<template>
  <section class="snapshot-error" data-testid="snapshot-error" role="alert">
    <h2>本地快照已损坏</h2>
    <p>
      浏览器中保存的故事进度无法识别（版本不符或内容缺失）。为避免错乱，本次没有套用任何损坏数据。
    </p>
    <p>你可以清除损坏数据后重新录入故事；清除前我们不会覆盖原有内容。</p>
    <button type="button" class="primary" data-testid="clear-corrupt" @click="store.discardCorruptSnapshot()">
      清除损坏数据并重新录入
    </button>
  </section>
</template>

<script setup lang="ts">
import type { ChoiceStore } from '../lib/choiceStore';

const props = defineProps<{ store: ChoiceStore }>();
const store = props.store;
</script>

<template>
  <section class="choice-error" data-testid="choice-error" role="alert">
    <h2>选择板数据已损坏</h2>
    <p>
      浏览器中保存的现场选择板数据无法识别（版本不符或内容缺失）。为避免错乱，本次没有套用任何损坏数据。
    </p>
    <p>这不会影响故事草稿与演示；清除选择板数据后即可重新发布，故事内容保持不变。</p>
    <button
      type="button"
      class="primary"
      data-testid="choice-clear-corrupt"
      @click="store.discardCorruptData()"
    >
      清除损坏数据并重建选择板
    </button>
    <p><a href="#story" data-testid="choice-error-back">← 返回故事编辑</a></p>
  </section>
</template>

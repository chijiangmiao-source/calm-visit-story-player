<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createStoryStore } from './lib/store';
import { createChoiceStore } from './lib/choiceStore';
import StoryEditor from './components/StoryEditor.vue';
import StoryPresenter from './components/StoryPresenter.vue';
import SnapshotError from './components/SnapshotError.vue';
import ChoiceBoard from './components/ChoiceBoard.vue';
import ChoiceDataError from './components/ChoiceDataError.vue';

// 故事与现场选择板是两个相互独立的本地数据集与仓库：
// 任一侧损坏或写入失败都不影响另一侧载入。
const store = createStoryStore();
const choiceStore = createChoiceStore();

// 选择板作为编辑页旁的独立入口，用 #choice 直达；其余情况保持故事页
const isChoiceRoute = ref(window.location.hash === '#choice');
function onHashChange() {
  isChoiceRoute.value = window.location.hash === '#choice';
}
onMounted(() => window.addEventListener('hashchange', onHashChange));
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange);
  store.dispose();
});
</script>

<template>
  <main class="app">
    <template v-if="isChoiceRoute">
      <ChoiceDataError v-if="choiceStore.state.corrupt" :store="choiceStore" />
      <ChoiceBoard v-else :store="choiceStore" />
    </template>
    <template v-else>
      <SnapshotError v-if="store.state.corrupt" :store="store" />
      <StoryPresenter
        v-else-if="store.state.view === 'presenter' && store.state.session"
        :store="store"
      />
      <StoryEditor v-else :store="store" />
    </template>
  </main>
</template>

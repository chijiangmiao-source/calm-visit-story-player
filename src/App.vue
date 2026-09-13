<script setup lang="ts">
import { createStoryStore } from './lib/store';
import StoryEditor from './components/StoryEditor.vue';
import StoryPresenter from './components/StoryPresenter.vue';
import SnapshotError from './components/SnapshotError.vue';

const store = createStoryStore();
</script>

<template>
  <main class="app">
    <SnapshotError v-if="store.state.corrupt" :store="store" />
    <StoryPresenter
      v-else-if="store.state.view === 'presenter' && store.state.session"
      :store="store"
    />
    <StoryEditor v-else :store="store" />
  </main>
</template>

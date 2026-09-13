<script setup lang="ts">
import { computed } from 'vue';
import type { StoryStore } from '../lib/store';
import { formatTime } from '../lib/format';
import { MAX_PAGES, MIN_PAGES, THEME_COLORS, isPageReady } from '../lib/story';

const props = defineProps<{ store: StoryStore }>();
const store = props.store;

const savedTime = computed(() =>
  store.state.savedAt ? formatTime(store.state.savedAt) : '',
);

function onTextInput(id: string, field: 'title' | 'description', event: Event) {
  store.updatePage(id, { [field]: (event.target as HTMLInputElement).value });
}
</script>

<template>
  <section class="editor">
    <header class="editor__header">
      <h1>逐页故事续播台</h1>
      <p>
        为即将到达的环境提前录制 {{ MIN_PAGES }}–{{ MAX_PAGES }} 页故事；演示时一次只显示一页，
        刷新或误关浏览器后会从离开的那一页继续。
      </p>
    </header>

    <p v-if="!store.persistenceAvailable" class="alert" role="alert">
      当前浏览器无法使用本地存储，刷新后进度将丢失。
    </p>
    <p v-if="store.state.saveError" class="alert" role="alert" data-testid="save-error">
      {{ store.state.saveError }}
    </p>
    <p v-else-if="savedTime" class="saved" data-testid="save-status">
      已保存到本地 · {{ savedTime }}
    </p>

    <p class="hint" data-testid="page-count">
      已录入 {{ store.state.draftPages.length }} / {{ MAX_PAGES }} 页（{{
        MIN_PAGES
      }}
      页起可开始演示，每页需填写标题、说明并选择主题色）
    </p>

    <p v-if="store.state.draftPages.length === 0" class="empty" data-testid="empty-draft">
      还没有页面，点击下方“添加一页”开始录入。
    </p>

    <ol class="pages">
      <li
        v-for="(page, index) in store.state.draftPages"
        :key="page.id"
        class="page-card"
        data-testid="page-card"
      >
        <div class="page-card__head">
          <strong>第 {{ index + 1 }} 页</strong>
          <span v-if="!isPageReady(page)" class="page-card__warn">标题与说明不能为空</span>
          <span class="page-card__actions">
            <button
              type="button"
              class="page-card__reorder-btn"
              data-testid="move-up"
              :disabled="index === 0"
              :title="index === 0 ? '这已经是第一页' : '把本页向前移动一位'"
              @click="store.moveDraftPage(page.id, 'up')"
            >
              ↑ 上移
            </button>
            <button
              type="button"
              class="page-card__reorder-btn"
              data-testid="move-down"
              :disabled="index === store.state.draftPages.length - 1"
              :title="index === store.state.draftPages.length - 1 ? '这已经是最后一页' : '把本页向后移动一位'"
              @click="store.moveDraftPage(page.id, 'down')"
            >
              ↓ 下移
            </button>
            <button type="button" data-testid="remove-page" @click="store.removePage(page.id)">
              删除本页
            </button>
          </span>
        </div>

        <label class="field">
          <span>标题（必填）</span>
          <input
            type="text"
            data-testid="title-input"
            :value="page.title"
            placeholder="例如：下一站是牙科诊室"
            @input="onTextInput(page.id, 'title', $event)"
          />
        </label>

        <label class="field">
          <span>说明（必填）</span>
          <textarea
            rows="3"
            data-testid="desc-input"
            :value="page.description"
            placeholder="例如：那里会有点吵，我们戴好耳机，看完就可以回家。"
            @input="onTextInput(page.id, 'description', $event)"
          ></textarea>
        </label>

        <fieldset class="field">
          <legend>主题色（六选一）</legend>
          <div class="swatches">
            <label
              v-for="color in THEME_COLORS"
              :key="color.id"
              class="swatch"
              :class="{ 'swatch--active': page.color === color.id }"
            >
              <input
                type="radio"
                :name="`color-${page.id}`"
                :value="color.id"
                :checked="page.color === color.id"
                :data-testid="`color-${color.id}`"
                @change="store.updatePage(page.id, { color: color.id })"
              />
              <span
                class="swatch__chip"
                :style="{ backgroundColor: color.background, borderColor: color.accent }"
              ></span>
              {{ color.label }}
            </label>
          </div>
        </fieldset>
      </li>
    </ol>

    <div class="editor__actions">
      <button
        type="button"
        data-testid="add-page"
        :disabled="store.state.draftPages.length >= MAX_PAGES"
        @click="store.addPage()"
      >
        ＋ 添加一页
      </button>
      <button
        type="button"
        class="primary"
        data-testid="start-presentation"
        :disabled="!store.canStart()"
        @click="store.startPresentation()"
      >
        ▶ 开始演示
      </button>
    </div>
  </section>
</template>

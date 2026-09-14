<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { StoryStore } from '../lib/store';
import { formatTime } from '../lib/format';
import { themeColorById } from '../lib/story';

const props = defineProps<{ store: StoryStore }>();
const store = props.store;

const session = computed(() => store.state.session);
const currentPage = computed(() => {
  const s = session.value;
  return s ? (s.pages[s.pageIndex] ?? null) : null;
});
const theme = computed(() => themeColorById(currentPage.value?.color ?? ''));
const isLastPage = computed(() => {
  const s = session.value;
  return s !== null && s.pageIndex === s.pages.length - 1;
});
const isAutoPlaying = computed(() => session.value?.playMode === 'auto');
const savedTime = computed(() =>
  store.state.savedAt ? formatTime(store.state.savedAt) : '',
);

// 页码导航：展开后列出冻结副本的页码与标题，可从中直接选页
const navOpen = ref(false);
/** 最近一次写入失败、未能跳转到的页索引；用于在导航中标出 */
const navFailedIndex = ref<number | null>(null);

function toggleNav() {
  navOpen.value = !navOpen.value;
  // 关闭导航时清除失败标记，下次打开从干净状态开始
  if (!navOpen.value) navFailedIndex.value = null;
}

/**
 * 选页沿用 store 的翻页提交链路：只有目标索引有效且快照写入成功才回到单页画面；
 * 写入失败时导航保持打开并标出未能跳转的页，当前页与倒计时维持原状，可重试或关闭。
 */
function selectPage(index: number) {
  if (store.jumpToPage(index)) {
    navOpen.value = false;
    navFailedIndex.value = null;
  } else {
    navFailedIndex.value = index;
  }
}

/**
 * 切换自动翻页：沿用“先写快照后更新”链路，只有提交成功才改变模式。
 * 复选框是单向 :checked 绑定，提交失败时状态没有变化、Vue 不会回写 DOM，
 * 必须手动把开关拨回真实状态，避免“看似已开却没有倒计时”（或反向）的脱节。
 */
function onAutoplayToggle(event: Event) {
  const input = event.target as HTMLInputElement;
  const ok = store.setPlayMode(input.checked ? 'auto' : 'manual');
  if (!ok) input.checked = isAutoPlaying.value;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    store.prevPage();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    store.nextPage();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  // 组件卸载（回到编辑等）必须取消旧计时器，避免卸载后重复推进
  store.dispose();
});
</script>

<template>
  <section
    v-if="session && session.status === 'completed'"
    class="presenter presenter--done"
    data-testid="completed-screen"
  >
    <div class="presenter__card">
      <h2>故事讲完了！</h2>
      <p>全部 {{ session.pages.length }} 页都看完了，做得很好。</p>
      <div class="presenter__actions">
        <button type="button" class="primary" data-testid="restart-session" @click="store.restartSession()">
          ↺ 重新开始
        </button>
        <button type="button" data-testid="exit-to-editor" @click="store.exitToEditor()">
          回到编辑
        </button>
      </div>
      <p v-if="store.state.saveError" class="alert" role="alert" data-testid="save-error">
        {{ store.state.saveError }}
      </p>
      <p v-else-if="savedTime" class="saved" data-testid="save-status">已保存到本地 · {{ savedTime }}</p>
    </div>
  </section>

  <section
    v-else-if="session && currentPage"
    class="presenter"
    :style="{ backgroundColor: theme.background, color: theme.text }"
    data-testid="presenter"
  >
    <div class="presenter__card">
      <p class="presenter__indicator" data-testid="page-indicator">
        第 {{ session.pageIndex + 1 }} / {{ session.pages.length }} 页
      </p>

      <div class="pagenav">
        <button
          type="button"
          class="pagenav__toggle"
          data-testid="page-nav-toggle"
          :aria-expanded="navOpen"
          @click="toggleNav"
        >
          {{ navOpen ? '▴ 收起页码导航' : '▾ 选择页面' }}
        </button>
        <ol v-if="navOpen" class="pagenav__list" data-testid="page-nav">
          <li v-for="(page, index) in session.pages" :key="page.id">
            <button
              type="button"
              class="pagenav__item"
              :class="{
                'pagenav__item--current': index === session.pageIndex,
                'pagenav__item--failed': index === navFailedIndex,
              }"
              :aria-current="index === session.pageIndex ? 'page' : undefined"
              data-testid="page-nav-item"
              @click="selectPage(index)"
            >
              <span class="pagenav__no">第 {{ index + 1 }} 页</span>
              <span class="pagenav__title">{{ page.title }}</span>
            </button>
            <p
              v-if="index === navFailedIndex"
              class="pagenav__failed-note"
              role="alert"
              data-testid="page-nav-failed"
            >
              未能跳转到该页，请重试或关闭导航
            </p>
          </li>
        </ol>
      </div>

      <h2 data-testid="page-title" :style="{ color: theme.accent }">{{ currentPage.title }}</h2>
      <p class="presenter__desc" data-testid="page-description">{{ currentPage.description }}</p>

      <label class="autoplay">
        <input
          type="checkbox"
          data-testid="autoplay-toggle"
          :checked="isAutoPlaying"
          @change="onAutoplayToggle"
        />
        <span>自动翻页（每 8 秒）</span>
        <span
          v-if="isAutoPlaying && !isLastPage"
          class="autoplay__countdown"
          data-testid="autoplay-countdown"
        >
          {{ store.state.autoRemainingSeconds }} 秒后翻到下一页
        </span>
        <span v-else-if="isAutoPlaying && isLastPage" class="autoplay__countdown" data-testid="autoplay-countdown">
          已到最后一页
        </span>
      </label>

      <div class="presenter__actions">
        <button
          type="button"
          data-testid="prev-page"
          :disabled="session.pageIndex === 0"
          @click="store.prevPage()"
        >
          ← 上一页
        </button>
        <button
          v-if="isLastPage"
          type="button"
          class="primary"
          data-testid="complete-session"
          @click="store.completeSession()"
        >
          ✓ 完成
        </button>
        <button v-else type="button" class="primary" data-testid="next-page" @click="store.nextPage()">
          下一页 →
        </button>
      </div>

      <p class="presenter__tip">也可以按键盘 ← / → 翻页；手动翻页后自动计时重新开始</p>

      <div class="presenter__secondary">
        <button type="button" data-testid="restart-session" @click="store.restartSession()">
          ↺ 重新开始
        </button>
        <button type="button" data-testid="exit-to-editor" @click="store.exitToEditor()">
          回到编辑
        </button>
      </div>

      <p v-if="store.state.saveError" class="alert" role="alert" data-testid="save-error">
        {{ store.state.saveError }}
      </p>
      <p v-else-if="savedTime" class="saved" data-testid="save-status">
        已保存到本地 · {{ savedTime }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChoiceStore } from '../lib/choiceStore';
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  chosenOptionOf,
  type ChoiceFormIssue,
} from '../lib/choice';
import { formatTime } from '../lib/format';

const props = defineProps<{ store: ChoiceStore }>();
const store = props.store;

const round = computed(() => store.currentRound());
const resultOption = computed(() => (round.value ? chosenOptionOf(round.value) : null));
const createdTime = computed(() => (round.value ? formatTime(round.value.createdAt) : ''));

// ---- 照护者发布表单 ----
// 进入时用最近一轮预填，便于“修改内容再次发布下一轮”
const initial = store.currentRound();
const prompt = ref(initial?.prompt ?? '');
const optionLabels = ref<string[]>(
  initial ? initial.options.map((option) => option.label) : ['', ''],
);
/** 最近一次发布尝试发现的校验问题（随输入实时重算） */
const issues = ref<ChoiceFormIssue[]>([]);
/** 写入失败时就近显示的错误（发布 / 选择分别记录在对应位置旁） */
const publishError = ref<string | null>(null);
const selectError = ref<string | null>(null);

const formIssue = computed(() => issues.value.find((i) => i.scope === 'form')?.message ?? null);
const promptIssue = computed(
  () => issues.value.find((i) => i.scope === 'prompt')?.message ?? null,
);
const optionIssues = computed(() =>
  issues.value.filter((i): i is Extract<ChoiceFormIssue, { scope: 'option' }> => i.scope === 'option'),
);

function addOptionRow() {
  if (optionLabels.value.length >= MAX_OPTIONS) return;
  optionLabels.value = [...optionLabels.value, ''];
}

function removeOptionRow(index: number) {
  if (optionLabels.value.length <= MIN_OPTIONS) return;
  optionLabels.value = optionLabels.value.filter((_, i) => i !== index);
}

/** 发布服务只接受完整内容；校验不过或写入失败都保留表单当前内容 */
function onPublish() {
  const result = store.publish({
    prompt: prompt.value,
    options: optionLabels.value,
  });
  issues.value = result.issues;
  if (result.ok) {
    issues.value = [];
    publishError.value = null;
    selectError.value = null;
    // 预填新一轮内容，照护者可在此基础上修改后发布再下一轮
    const latest = store.currentRound();
    if (latest) {
      prompt.value = latest.prompt;
      optionLabels.value = latest.options.map((option) => option.label);
    }
    return;
  }
  // issues 为空说明表单完整、是本地写入失败：在表单附近说明未保存
  if (result.issues.length === 0) {
    publishError.value = store.state.saveError;
  } else {
    publishError.value = null;
  }
}

/** 选择服务只接受当前待选择轮次中的选项；失败时在选项附近说明未保存 */
function onSelect(optionId: string) {
  selectError.value = null;
  const ok = store.select(optionId);
  if (ok) {
    publishError.value = null;
    return;
  }
  selectError.value =
    store.state.saveError ?? '本轮选择未能保存，页面仍保持待选择，请重试。';
}
</script>

<template>
  <section class="choice" data-testid="choice-board">
    <header class="choice__header">
      <a class="choice__back" href="#story" data-testid="choice-back">← 返回故事编辑</a>
      <h1>现场选择板</h1>
      <p>临时改道或情绪紧张时，发布一轮清晰可确认的选择；孩子点选后本轮立即锁定。</p>
    </header>

    <p v-if="!store.persistenceAvailable" class="alert" role="alert">
      当前浏览器无法使用本地存储，刷新后选择记录将丢失。
    </p>

    <!-- 孩子端：当前轮 -->
    <div class="choice__stage" data-testid="choice-stage">
      <p v-if="!round" class="choice__empty" data-testid="choice-empty">
        还没有发布选择。请照护者在下方填写一句提示和 {{ MIN_OPTIONS }}–{{ MAX_OPTIONS }} 个选项后发布。
      </p>

      <template v-else>
        <p class="choice__meta" data-testid="choice-round-no">
          第 {{ store.state.rounds.length }} 轮 · 发布于 {{ createdTime }}
        </p>
        <p
          class="choice__status"
          :class="round.status === 'chosen' ? 'choice__status--done' : 'choice__status--pending'"
          data-testid="choice-status"
        >
          {{ round.status === 'chosen' ? '已选定 · 本轮已锁定' : '待选择 · 请点选一项' }}
        </p>
        <h2 class="choice__prompt" data-testid="choice-prompt-text">{{ round.prompt }}</h2>

        <div class="choice__options" role="group" :aria-label="round.prompt">
          <button
            v-for="option in round.options"
            :key="option.id"
            type="button"
            class="choice__option"
            :class="{ 'choice__option--chosen': option.id === resultOption?.id }"
            :aria-pressed="option.id === resultOption?.id"
            :disabled="round.status === 'chosen'"
            :data-testid="`choice-option-${option.id}`"
            data-choice-option
            @click="onSelect(option.id)"
          >
            {{ option.label }}
          </button>
        </div>

        <div
          v-if="round.status === 'chosen' && resultOption"
          class="choice__result"
          data-testid="choice-result"
        >
          ✓ 本轮选择：<strong>{{ resultOption.label }}</strong>
        </div>

        <p v-if="selectError" class="alert choice__option-error" role="alert" data-testid="choice-select-error">
          {{ selectError }}
        </p>
      </template>
    </div>

    <!-- 照护者端：发布 / 发布下一轮 -->
    <form class="choice__form" data-testid="choice-form" @submit.prevent="onPublish">
      <h2>{{ round ? '修改内容并发布下一轮' : '发布一轮选择' }}</h2>

      <label class="field">
        <span>给孩子的一句提示（必填）</span>
        <input
          type="text"
          v-model="prompt"
          data-testid="choice-prompt-input"
          placeholder="例如：现在馆内临时改道，我们接下来先做哪一件？"
        />
      </label>
      <p v-if="promptIssue" class="choice__field-error" role="alert" data-testid="choice-prompt-error">
        {{ promptIssue }}
      </p>

      <fieldset class="field">
        <legend>选项（{{ MIN_OPTIONS }}–{{ MAX_OPTIONS }} 个，内容不能为空且不能重复）</legend>
        <div
          v-for="(_label, index) in optionLabels"
          :key="index"
          class="choice__option-row"
        >
          <input
            type="text"
            v-model="optionLabels[index]"
            :data-testid="`choice-option-input-${index}`"
            data-choice-option-input
            :placeholder="`选项 ${index + 1}`"
          />
          <button
            type="button"
            class="choice__remove"
            data-testid="choice-remove-option"
            :disabled="optionLabels.length <= MIN_OPTIONS"
            :title="optionLabels.length <= MIN_OPTIONS ? `至少保留 ${MIN_OPTIONS} 个选项` : '删除该选项'"
            @click="removeOptionRow(index)"
          >
            删除
          </button>
        </div>
        <p
          v-for="issue in optionIssues"
          :key="`err-option-${issue.index}`"
          class="choice__field-error"
          role="alert"
          :data-testid="`choice-option-error-${issue.index}`"
        >
          第 {{ issue.index + 1 }} 个选项：{{ issue.message }}
        </p>
      </fieldset>

      <p v-if="formIssue" class="choice__field-error" role="alert" data-testid="choice-form-issue">
        {{ formIssue }}
      </p>

      <div class="choice__form-actions">
        <button
          type="button"
          data-testid="choice-add-option"
          :disabled="optionLabels.length >= MAX_OPTIONS"
          @click="addOptionRow"
        >
          ＋ 添加选项
        </button>
        <button type="submit" class="primary" data-testid="choice-publish">
          {{ round ? '发布下一轮' : '发布本轮选择' }}
        </button>
      </div>

      <p v-if="publishError" class="alert" role="alert" data-testid="choice-publish-error">
        {{ publishError }} 表单内容已保留，可直接重试。
      </p>
      <p v-else-if="store.state.savedAt && round" class="saved" data-testid="choice-saved">
        已保存到本地 · {{ formatTime(store.state.savedAt) }}
      </p>
    </form>
  </section>
</template>

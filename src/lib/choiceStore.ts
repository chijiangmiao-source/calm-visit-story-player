import { reactive } from 'vue';
import {
  createMemoryStorage,
  getDefaultStorage,
} from './snapshot';
import {
  createChoiceRound,
  lockChoice,
  validateChoiceDraft,
  type ChoiceDraftInput,
  type ChoiceFormIssue,
  type ChoiceRound,
} from './choice';
import {
  clearChoiceBoard,
  loadChoiceBoard,
  saveChoiceBoard,
  type ChoiceBoardData,
  type StorageLike,
} from './choiceStorage';

export interface ChoiceStoreState {
  rounds: ChoiceRound[];
  /** 启动时检测到损坏的选择板数据：只阻断选择板，在清除前不写入 */
  corrupt: boolean;
  saveError: string | null;
  savedAt: string | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createChoiceStore(storage?: StorageLike) {
  const backing = storage ?? getDefaultStorage();
  const persistenceAvailable = backing !== null;
  const target: StorageLike = backing ?? createMemoryStorage();

  const state = reactive<ChoiceStoreState>({
    rounds: [],
    corrupt: false,
    saveError: null,
    savedAt: null,
  });

  // 启动恢复：选择板数据独立校验，损坏只进入选择板自己的错误态
  const loaded = loadChoiceBoard(target);
  if (loaded.kind === 'corrupt') {
    state.corrupt = true;
  } else if (loaded.kind === 'ok') {
    state.rounds = loaded.data.rounds;
  }

  /**
   * 所有变更的唯一出口：先把下一份数据同步写入 localStorage，
   * 成功后才更新画面；写入失败保留操作前内容并给出错误反馈。
   */
  function commit(nextRounds: ChoiceRound[]): boolean {
    if (state.corrupt) return false;
    const data: ChoiceBoardData = { schemaVersion: 1, rounds: clone(nextRounds) };
    try {
      saveChoiceBoard(target, data);
    } catch {
      state.saveError = '无法写入浏览器本地存储，本次操作未保存。请检查存储设置后重试。';
      return false;
    }
    state.rounds = nextRounds;
    state.saveError = null;
    state.savedAt = new Date().toISOString();
    return true;
  }

  /** 当前轮：始终是最后发布的一轮；一轮发布追加为新的独立轮次 */
  function currentRound(): ChoiceRound | null {
    return state.rounds.length === 0 ? null : state.rounds[state.rounds.length - 1];
  }

  /**
   * 发布服务：只接受完整内容（提示非空、2-4 个非空且不重复的选项）。
   * 校验不过或写入失败都不改变现有轮次，返回问题列表或 false。
   */
  function publish(input: ChoiceDraftInput): { ok: boolean; issues: ChoiceFormIssue[] } {
    const issues = validateChoiceDraft(input);
    if (issues.length > 0) return { ok: false, issues };
    const round = createChoiceRound(input);
    if (!round) return { ok: false, issues: validateChoiceDraft(input) };
    const ok = commit([...state.rounds, round]);
    return { ok, issues: [] };
  }

  /**
   * 选择服务：只接受当前待选择轮次中的选项。
   * 轮次已锁定、选项不属于本轮或写入失败时返回 false，画面保持原样。
   */
  function select(optionId: string): boolean {
    const round = currentRound();
    if (!round) return false;
    const locked = lockChoice(round, optionId);
    if (!locked) return false;
    const nextRounds = state.rounds.slice(0, -1);
    nextRounds.push(locked);
    return commit(nextRounds);
  }

  /** 损坏数据的唯一出口：清除选择板坏数据后重建，不触碰故事快照 */
  function discardCorruptData(): void {
    try {
      clearChoiceBoard(target);
    } catch {
      // 清除失败也继续进入空状态，后续发布时会再次尝试写入
    }
    state.corrupt = false;
    state.rounds = [];
    state.saveError = null;
    state.savedAt = null;
  }

  return {
    state,
    persistenceAvailable,
    currentRound,
    publish,
    select,
    discardCorruptData,
  };
}

export type ChoiceStore = ReturnType<typeof createChoiceStore>;

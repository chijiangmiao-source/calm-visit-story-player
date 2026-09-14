import { reactive } from 'vue';
import {
  SCHEMA_VERSION,
  clearSnapshot,
  createMemoryStorage,
  getDefaultStorage,
  loadSnapshot,
  saveSnapshot,
  type PlayMode,
  type PresentationSession,
  type Snapshot,
  type StorageLike,
} from './snapshot';
import {
  canStartPresentation,
  createPage,
  isThemeColorId,
  movePage,
  MAX_PAGES,
  type MoveDirection,
  type StoryPage,
} from './story';

export type ViewName = 'editor' | 'presenter';

/** 自动播放固定节奏：每 8 秒提交下一页（每秒一个计时打点） */
export const AUTOPLAY_INTERVAL_MS = 1000;
export const AUTOPLAY_TICKS_PER_PAGE = 8;

export interface StoreState {
  view: ViewName;
  draftPages: StoryPage[];
  session: PresentationSession | null;
  /** 启动时检测到损坏快照：在用户清除前不写入任何数据 */
  corrupt: boolean;
  saveError: string | null;
  savedAt: string | null;
  /** 自动播放距下一次翻页剩余秒数（8..1）；非自动播放时为 0 */
  autoRemainingSeconds: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 只有进行中、自动模式且未到最后一页时，计时器才应该存在 */
function shouldAutoPlay(session: PresentationSession | null): boolean {
  return (
    !!session &&
    session.status === 'presenting' &&
    session.playMode === 'auto' &&
    session.pageIndex < session.pages.length - 1
  );
}

export function createStoryStore(storage?: StorageLike) {
  const backing = storage ?? getDefaultStorage();
  const persistenceAvailable = backing !== null;
  const target: StorageLike = backing ?? createMemoryStorage();

  const state = reactive<StoreState>({
    view: 'editor',
    draftPages: [],
    session: null,
    corrupt: false,
    saveError: null,
    savedAt: null,
    autoRemainingSeconds: 0,
  });

  // 全场只有一个计时器：任何页面切换 / 模式切换 / 重新开始 / 退出 / 卸载
  // 都先取消旧计时器，再按需开启新的八秒周期，避免重复推进。
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let ticksLeft = 0;

  /** 取消旧计时器并清空倒计时显示 */
  function clearTimer(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    ticksLeft = 0;
    state.autoRemainingSeconds = 0;
  }

  /** 按当前会话状态对账：该停就停、该开就从完整八秒开始 */
  function syncTimer(): void {
    if (intervalId !== null && !shouldAutoPlay(state.session)) {
      clearTimer();
    }
    if (intervalId === null && shouldAutoPlay(state.session)) {
      ticksLeft = AUTOPLAY_TICKS_PER_PAGE;
      state.autoRemainingSeconds = AUTOPLAY_TICKS_PER_PAGE;
      intervalId = setInterval(tick, AUTOPLAY_INTERVAL_MS);
    }
  }

  /** 从当前页重新计时：先取消旧周期，再按当前模式开启完整八秒 */
  function resetTimer(): void {
    clearTimer();
    syncTimer();
  }

  /** 计时器到点：成功翻页由 goToPage 开启新周期；写入失败则停在原页并关闭自动播放 */
  function tick(): void {
    const session = state.session;
    if (!session || !shouldAutoPlay(session)) {
      clearTimer();
      return;
    }
    ticksLeft -= 1;
    if (ticksLeft > 0) {
      state.autoRemainingSeconds = ticksLeft;
      return;
    }
    const ok = goToPage(session.pageIndex + 1);
    if (!ok) {
      // 定时翻页写入失败：画面停在原页（commitNext 已保证状态不变），
      // 内存态切回手动关闭自动播放，存储错误提示继续显示，不做额外写入。
      clearTimer();
      if (state.session && state.session.playMode === 'auto') {
        state.session = { ...state.session, playMode: 'manual' };
      }
    }
  }

  // 启动恢复：只接受整体合法的快照；损坏则进入错误态，不部分套用、不覆盖
  const loaded = loadSnapshot(target);
  if (loaded.kind === 'corrupt') {
    state.corrupt = true;
  } else if (loaded.kind === 'ok') {
    state.draftPages = loaded.snapshot.draft?.pages ?? [];
    state.session = loaded.snapshot.session;
    state.view = loaded.snapshot.session ? 'presenter' : 'editor';
    // 刷新恢复自动播放：从当前页的完整八秒重新计时，不沿用刷新前的剩余时间
    syncTimer();
  }

  /**
   * 所有变更操作的唯一出口：先把下一份快照同步写入 localStorage，
   * 写入成功后才应用到界面状态；写入失败则界面保持不变并给出错误反馈。
   */
  function commitNext(next: {
    draftPages: StoryPage[];
    session: PresentationSession | null;
    view?: ViewName;
  }): boolean {
    if (state.corrupt) return false;
    const snapshot: Snapshot = {
      schemaVersion: SCHEMA_VERSION,
      draft: { pages: clone(next.draftPages) },
      session: next.session ? clone(next.session) : null,
    };
    try {
      saveSnapshot(target, snapshot);
    } catch {
      state.saveError = '无法写入浏览器本地存储，本次操作未保存。请检查存储设置后重试。';
      return false;
    }
    state.draftPages = next.draftPages;
    state.session = next.session;
    if (next.view !== undefined) state.view = next.view;
    state.saveError = null;
    state.savedAt = new Date().toISOString();
    return true;
  }

  // ---- 草稿编辑（每次创建/编辑都会先落盘再反馈） ----

  function addPage(): boolean {
    if (state.draftPages.length >= MAX_PAGES) return false;
    return commitNext({
      draftPages: [...state.draftPages, createPage()],
      session: state.session,
    });
  }

  function removePage(id: string): boolean {
    // 页面不存在：不提交、状态完全不变
    if (!state.draftPages.some((p) => p.id === id)) return false;
    return commitNext({
      draftPages: state.draftPages.filter((p) => p.id !== id),
      session: state.session,
    });
  }

  function updatePage(id: string, patch: Partial<Omit<StoryPage, 'id'>>): boolean {
    if (patch.color !== undefined && !isThemeColorId(patch.color)) return false;
    // 页面不存在：拒绝操作，不产生写入
    if (!state.draftPages.some((p) => p.id === id)) return false;
    return commitNext({
      draftPages: state.draftPages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      session: state.session,
    });
  }

  /** 调整草稿叙事次序：仅在没有进行中的会话且目标位置有效时提交新数组 */
  function moveDraftPage(id: string, direction: MoveDirection): boolean {
    // 启动演示会冻结当前草稿副本，已启动的会话不接受重排
    if (state.session) return false;
    const next = movePage(state.draftPages, id, direction);
    if (!next) return false; // 页面不存在或已到边界：不提交、状态不变
    return commitNext({ draftPages: next, session: null });
  }

  // ---- 演示会话 ----

  /** 启动演示：默认手动模式，不开启计时 */
  function startPresentation(): boolean {
    if (!canStartPresentation(state.draftPages)) return false;
    const session: PresentationSession = {
      pages: clone(state.draftPages),
      pageIndex: 0,
      status: 'presenting',
      startedAt: new Date().toISOString(),
      completedAt: null,
      playMode: 'manual',
    };
    const ok = commitNext({ draftPages: state.draftPages, session, view: 'presenter' });
    if (ok) resetTimer();
    return ok;
  }

  function goToPage(index: number): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    const clamped = Math.min(Math.max(index, 0), session.pages.length - 1);
    if (clamped === session.pageIndex) return false;
    const ok = commitNext({
      draftPages: state.draftPages,
      session: { ...session, pageIndex: clamped },
    });
    if (!ok) return false;
    // 手动前后翻页（以及自动到点后的翻页）都从新页面重新计时：
    // 取消旧计时器，避免旧周期继续推进。
    resetTimer();
    return true;
  }

  /**
   * 页码导航直接跳转：目标索引必须落在页面范围内。
   * 越界或非法索引不提交、不改变会话与计时器；选择当前页幂等成功、不产生写入；
   * 有效跳转沿用现有翻页提交链路，写入成功后从该页重新计时。
   */
  function jumpToPage(index: number): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    if (!Number.isInteger(index) || index < 0 || index >= session.pages.length) return false;
    if (index === session.pageIndex) return true; // 已在该页：无需写入
    return goToPage(index);
  }

  function nextPage(): boolean {
    return state.session ? goToPage(state.session.pageIndex + 1) : false;
  }

  function prevPage(): boolean {
    return state.session ? goToPage(state.session.pageIndex - 1) : false;
  }

  /** 切换手动 / 自动播放：模式随快照保存；开启后从当前页计完整八秒 */
  function setPlayMode(mode: PlayMode): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    if (session.playMode === mode) return true; // 幂等，重复切换不产生写入
    const ok = commitNext({
      draftPages: state.draftPages,
      session: { ...session, playMode: mode },
    });
    if (!ok) return false;
    resetTimer();
    return true;
  }

  function completeSession(): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    // 只有翻到最后一页才允许标记完成，否则继续播放
    if (session.pageIndex !== session.pages.length - 1) return false;
    const ok = commitNext({
      draftPages: state.draftPages,
      session: {
        ...session,
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    });
    if (ok) clearTimer(); // 完成后不再自动推进，等待“重新开始 / 回到编辑”
    return ok;
  }

  /** 重新开始：回到第一页并覆盖旧进度（含完成状态）；播放模式保留并重新计时 */
  function restartSession(): boolean {
    const session = state.session;
    if (!session) return false;
    const ok = commitNext({
      draftPages: state.draftPages,
      session: {
        ...session,
        pageIndex: 0,
        status: 'presenting',
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });
    if (ok) resetTimer();
    return ok;
  }

  /** 结束演示回到编辑：草稿保留，会话清除，计时器取消 */
  function exitToEditor(): boolean {
    const ok = commitNext({ draftPages: state.draftPages, session: null, view: 'editor' });
    if (ok) clearTimer();
    return ok;
  }

  /** 组件卸载时取消计时器，避免卸载后继续推进 */
  function dispose(): void {
    clearTimer();
  }

  /** 损坏快照的唯一出口：清除坏数据，回到可重新录入的编辑器 */
  function discardCorruptSnapshot(): void {
    try {
      clearSnapshot(target);
    } catch {
      // 清除失败也继续进入编辑态，后续写入会再次尝试
    }
    clearTimer();
    state.corrupt = false;
    state.draftPages = [];
    state.session = null;
    state.view = 'editor';
    state.saveError = null;
  }

  function canStart(): boolean {
    return canStartPresentation(state.draftPages);
  }

  return {
    state,
    persistenceAvailable,
    canStart,
    addPage,
    removePage,
    updatePage,
    moveDraftPage,
    startPresentation,
    goToPage,
    jumpToPage,
    nextPage,
    prevPage,
    setPlayMode,
    completeSession,
    restartSession,
    exitToEditor,
    discardCorruptSnapshot,
    dispose,
  };
}

export type StoryStore = ReturnType<typeof createStoryStore>;

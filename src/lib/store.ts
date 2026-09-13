import { reactive } from 'vue';
import {
  SCHEMA_VERSION,
  clearSnapshot,
  createMemoryStorage,
  getDefaultStorage,
  loadSnapshot,
  saveSnapshot,
  type PresentationSession,
  type Snapshot,
  type StorageLike,
} from './snapshot';
import {
  canStartPresentation,
  createPage,
  isThemeColorId,
  MAX_PAGES,
  type StoryPage,
} from './story';

export type ViewName = 'editor' | 'presenter';

export interface StoreState {
  view: ViewName;
  draftPages: StoryPage[];
  session: PresentationSession | null;
  /** 启动时检测到损坏快照：在用户清除前不写入任何数据 */
  corrupt: boolean;
  saveError: string | null;
  savedAt: string | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  });

  // 启动恢复：只接受整体合法的快照；损坏则进入错误态，不部分套用、不覆盖
  const loaded = loadSnapshot(target);
  if (loaded.kind === 'corrupt') {
    state.corrupt = true;
  } else if (loaded.kind === 'ok') {
    state.draftPages = loaded.snapshot.draft?.pages ?? [];
    state.session = loaded.snapshot.session;
    state.view = loaded.snapshot.session ? 'presenter' : 'editor';
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
    return commitNext({
      draftPages: state.draftPages.filter((p) => p.id !== id),
      session: state.session,
    });
  }

  function updatePage(id: string, patch: Partial<Omit<StoryPage, 'id'>>): boolean {
    if (patch.color !== undefined && !isThemeColorId(patch.color)) return false;
    return commitNext({
      draftPages: state.draftPages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      session: state.session,
    });
  }

  // ---- 演示会话 ----

  function startPresentation(): boolean {
    if (!canStartPresentation(state.draftPages)) return false;
    const session: PresentationSession = {
      pages: clone(state.draftPages),
      pageIndex: 0,
      status: 'presenting',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    return commitNext({ draftPages: state.draftPages, session, view: 'presenter' });
  }

  function goToPage(index: number): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    const clamped = Math.min(Math.max(index, 0), session.pages.length - 1);
    if (clamped === session.pageIndex) return false;
    return commitNext({
      draftPages: state.draftPages,
      session: { ...session, pageIndex: clamped },
    });
  }

  function nextPage(): boolean {
    return state.session ? goToPage(state.session.pageIndex + 1) : false;
  }

  function prevPage(): boolean {
    return state.session ? goToPage(state.session.pageIndex - 1) : false;
  }

  function completeSession(): boolean {
    const session = state.session;
    if (!session || session.status !== 'presenting') return false;
    return commitNext({
      draftPages: state.draftPages,
      session: {
        ...session,
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    });
  }

  /** 重新开始：回到第一页并覆盖旧进度（含完成状态） */
  function restartSession(): boolean {
    const session = state.session;
    if (!session) return false;
    return commitNext({
      draftPages: state.draftPages,
      session: {
        ...session,
        pageIndex: 0,
        status: 'presenting',
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });
  }

  /** 结束演示回到编辑：草稿保留，会话清除 */
  function exitToEditor(): boolean {
    return commitNext({ draftPages: state.draftPages, session: null, view: 'editor' });
  }

  /** 损坏快照的唯一出口：清除坏数据，回到可重新录入的编辑器 */
  function discardCorruptSnapshot(): void {
    try {
      clearSnapshot(target);
    } catch {
      // 清除失败也继续进入编辑态，后续写入会再次尝试
    }
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
    startPresentation,
    goToPage,
    nextPage,
    prevPage,
    completeSession,
    restartSession,
    exitToEditor,
    discardCorruptSnapshot,
  };
}

export type StoryStore = ReturnType<typeof createStoryStore>;

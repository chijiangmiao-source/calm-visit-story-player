import { isPageReady, isThemeColorId, MAX_PAGES, MIN_PAGES, type StoryPage } from './story';

/**
 * 快照结构版本。任何不兼容的结构变更都必须递增此版本，
 * 旧版本快照在恢复时会被整体拒绝，绝不部分套用。
 */
export const SCHEMA_VERSION = 1;

export const STORAGE_KEY = 'story-resume:snapshot';

/** 编辑中的草稿，与演示会话相互独立 */
export interface StoryDraft {
  pages: StoryPage[];
}

export type SessionStatus = 'presenting' | 'completed';

/** 播放模式：手动翻页，或按固定八秒节奏自动翻页 */
export type PlayMode = 'manual' | 'auto';

/** 一次演示会话：启动时冻结的故事副本 + 当前页码 + 完成状态 + 播放模式 */
export interface PresentationSession {
  pages: StoryPage[];
  pageIndex: number;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  playMode: PlayMode;
}

export interface Snapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  draft: StoryDraft | null;
  session: PresentationSession | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; snapshot: Snapshot }
  | { kind: 'corrupt' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 结构校验：字段必须存在且类型正确。
 * 标题与说明允许为空字符串——草稿可能录入到一半，
 * 是否可演示由 isPageReady / 会话级校验把关。
 */
function parsePage(value: unknown): StoryPage | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.id)) return undefined;
  if (typeof value.title !== 'string') return undefined;
  if (typeof value.description !== 'string') return undefined;
  if (!isThemeColorId(value.color)) return undefined;
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    color: value.color,
  };
}

function parsePages(
  value: unknown,
  min: number,
  options: { requireReady: boolean },
): StoryPage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length < min || value.length > MAX_PAGES) return undefined;
  const pages: StoryPage[] = [];
  for (const item of value) {
    const page = parsePage(item);
    if (!page) return undefined;
    // 演示会话中的页面必须字段完整（非空标题与说明）
    if (options.requireReady && !isPageReady(page)) return undefined;
    pages.push(page);
  }
  return pages;
}

/** undefined 表示损坏；null 表示合法地不存在 */
function parseDraft(value: unknown): StoryDraft | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  // 草稿允许未填完的页面，刷新后应能继续编辑
  const pages = parsePages(value.pages, 0, { requireReady: false });
  if (!pages) return undefined;
  return { pages };
}

/** undefined 表示损坏；null 表示合法地不存在 */
function parseSession(value: unknown): PresentationSession | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const pages = parsePages(value.pages, MIN_PAGES, { requireReady: true });
  if (!pages) return undefined;
  const { pageIndex, status, startedAt, completedAt } = value;
  // 索引必须落在页面范围内
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex)) return undefined;
  if (pageIndex < 0 || pageIndex >= pages.length) return undefined;
  if (status !== 'presenting' && status !== 'completed') return undefined;
  if (!isNonEmptyString(startedAt)) return undefined;
  if (completedAt !== null && !isNonEmptyString(completedAt)) return undefined;
  if (status === 'completed' && completedAt === null) return undefined;
  // 缺少该字段的旧快照按手动模式恢复；字段存在但取值非法则整体判损坏
  if (value.playMode !== undefined && value.playMode !== 'manual' && value.playMode !== 'auto') {
    return undefined;
  }
  const playMode = value.playMode === 'auto' ? 'auto' : 'manual';
  return { pages, pageIndex, status, startedAt, completedAt, playMode };
}

/**
 * 整体校验快照：版本正确、每个页面字段完整、索引在范围内才接受；
 * 任何一部分损坏都返回 null，调用方不得部分套用。
 */
export function validateSnapshot(data: unknown): Snapshot | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== SCHEMA_VERSION) return null;
  const draft = parseDraft(data.draft);
  if (draft === undefined) return null;
  const session = parseSession(data.session);
  if (session === undefined) return null;
  return { schemaVersion: SCHEMA_VERSION, draft, session };
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot);
}

export function loadSnapshot(storage: StorageLike): LoadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { kind: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  const snapshot = validateSnapshot(data);
  return snapshot ? { kind: 'ok', snapshot } : { kind: 'corrupt' };
}

/** 同步写入；失败（如配额不足）会抛错，由调用方决定如何反馈 */
export function saveSnapshot(storage: StorageLike, snapshot: Snapshot): void {
  storage.setItem(STORAGE_KEY, serializeSnapshot(snapshot));
}

export function clearSnapshot(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY);
}

export function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 隐私模式等场景下访问 localStorage 本身就会抛错
  }
  return null;
}

/** localStorage 不可用时的内存兜底：应用可运行，但刷新后不保留 */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

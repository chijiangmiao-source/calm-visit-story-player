import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  clearSnapshot,
  createMemoryStorage,
  loadSnapshot,
  saveSnapshot,
  serializeSnapshot,
  validateSnapshot,
  type Snapshot,
} from './snapshot';
import { MAX_PAGES, THEME_COLORS } from './story';

const COLOR = THEME_COLORS[0].id;

function makePage(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', title: '去地铁站', description: '我们先坐电梯下楼。', color: COLOR, ...overrides };
}

function makePages(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makePage({ id: `p${i + 1}`, title: `第${i + 1}页` }),
  );
}

function validSnapshot(): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    draft: { pages: makePages(2) },
    session: {
      pages: makePages(3),
      pageIndex: 1,
      status: 'presenting',
      startedAt: '2026-09-13T08:00:00.000Z',
      completedAt: null,
      playMode: 'manual',
    },
  };
}

describe('validateSnapshot：整体校验规则', () => {
  it('接受结构完整的快照并原样返回', () => {
    const snapshot = validSnapshot();
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
  });

  it('接受草稿与会话都为 null 的空快照', () => {
    expect(validateSnapshot({ schemaVersion: SCHEMA_VERSION, draft: null, session: null })).toEqual({
      schemaVersion: SCHEMA_VERSION,
      draft: null,
      session: null,
    });
  });

  it('拒绝版本不符（更高、更低、缺失）', () => {
    for (const schemaVersion of [SCHEMA_VERSION + 1, SCHEMA_VERSION - 1, undefined, '1']) {
      expect(validateSnapshot({ ...validSnapshot(), schemaVersion })).toBeNull();
    }
  });

  it('拒绝非对象输入', () => {
    for (const data of [null, undefined, 42, 'snapshot', [], true]) {
      expect(validateSnapshot(data)).toBeNull();
    }
  });

  it('拒绝标题为空或缺失的页面', () => {
    for (const title of ['', '   ', 123, undefined]) {
      const snapshot = validSnapshot();
      snapshot.session!.pages[0] = makePage({ title }) as never;
      expect(validateSnapshot(snapshot)).toBeNull();
    }
  });

  it('拒绝说明为空或缺失的页面', () => {
    for (const description of ['', '  ', null, undefined]) {
      const snapshot = validSnapshot();
      snapshot.session!.pages[0] = makePage({ description }) as never;
      expect(validateSnapshot(snapshot)).toBeNull();
    }
  });

  it('拒绝六个内置主题色之外的颜色', () => {
    const snapshot = validSnapshot();
    snapshot.session!.pages[0] = makePage({ color: '#ff00ff' });
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('拒绝页码越界（负数、超出页数、非整数、非数字）', () => {
    for (const pageIndex of [-1, 3, 1.5, Number.NaN, '1']) {
      const snapshot = validSnapshot();
      (snapshot.session as unknown as Record<string, unknown>).pageIndex = pageIndex;
      expect(validateSnapshot(snapshot)).toBeNull();
    }
  });

  it('接受边界页码 0 与最后一页', () => {
    for (const pageIndex of [0, 2]) {
      const snapshot = validSnapshot();
      snapshot.session!.pageIndex = pageIndex;
      expect(validateSnapshot(snapshot)).not.toBeNull();
    }
  });

  it('拒绝会话页数少于 2 页或超过 12 页', () => {
    const tooFew = validSnapshot();
    tooFew.session!.pages = makePages(1);
    expect(validateSnapshot(tooFew)).toBeNull();

    const tooMany = validSnapshot();
    tooMany.session!.pages = makePages(MAX_PAGES + 1);
    expect(validateSnapshot(tooMany)).toBeNull();
  });

  it('拒绝未知会话状态', () => {
    const snapshot = validSnapshot();
    (snapshot.session as unknown as Record<string, unknown>).status = 'paused';
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('完成状态必须带完成时间', () => {
    const ok = validSnapshot();
    ok.session!.status = 'completed';
    ok.session!.pageIndex = ok.session!.pages.length - 1;
    ok.session!.completedAt = '2026-09-13T09:00:00.000Z';
    expect(validateSnapshot(ok)).not.toBeNull();

    const missing = validSnapshot();
    missing.session!.status = 'completed';
    missing.session!.pageIndex = missing.session!.pages.length - 1;
    missing.session!.completedAt = null;
    expect(validateSnapshot(missing)).toBeNull();
  });

  it('拒绝“已完成但页码仍在中间”的前后矛盾会话', () => {
    // 三页会话：完成状态只可能出现在最后一页（索引 2）
    for (const pageIndex of [0, 1]) {
      const snapshot = validSnapshot();
      snapshot.session!.status = 'completed';
      snapshot.session!.completedAt = '2026-09-13T09:00:00.000Z';
      snapshot.session!.pageIndex = pageIndex;
      expect(validateSnapshot(snapshot)).toBeNull();
    }

    // 完成状态且停在最后一页：自洽，接受
    const consistent = validSnapshot();
    consistent.session!.status = 'completed';
    consistent.session!.completedAt = '2026-09-13T09:00:00.000Z';
    consistent.session!.pageIndex = 2;
    expect(validateSnapshot(consistent)).not.toBeNull();
  });

  it('播放模式：接受 manual / auto，缺少该字段的旧快照按 manual 恢复', () => {
    const old = validSnapshot();
    delete (old.session as unknown as Record<string, unknown>).playMode;
    expect(validateSnapshot(old)).toMatchObject({
      session: { playMode: 'manual' },
    });

    const auto = validSnapshot();
    auto.session!.playMode = 'auto';
    expect(validateSnapshot(auto)).toMatchObject({ session: { playMode: 'auto' } });

    const nullMode = validSnapshot();
    (nullMode.session as unknown as Record<string, unknown>).playMode = null;
    expect(validateSnapshot(nullMode)).toBeNull();

    for (const playMode of ['fast', '', 42]) {
      const broken = validSnapshot();
      (broken.session as unknown as Record<string, unknown>).playMode = playMode;
      expect(validateSnapshot(broken)).toBeNull();
    }
  });

  it('会话损坏时草稿再合法也整体拒绝，不得部分套用', () => {
    const snapshot = validSnapshot();
    (snapshot.session as unknown as Record<string, unknown>).pageIndex = 99;
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('草稿损坏时会话再合法也整体拒绝，不得部分套用', () => {
    const snapshot = validSnapshot();
    snapshot.draft = { pages: [makePage({ color: 'not-a-color' })] };
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('草稿允许未填完的页面（空标题/空说明），刷新后可继续编辑', () => {
    const snapshot = validSnapshot();
    snapshot.draft = {
      pages: [makePage({ title: '', description: '' }), makePage({ title: '写了一半', description: '' })],
    };
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
  });

  it('草稿页字段缺失或类型错误仍属损坏', () => {
    for (const broken of [
      makePage({ title: undefined }),
      makePage({ description: 42 }),
      makePage({ id: '' }),
      makePage({ color: '#ff00ff' }),
    ]) {
      const snapshot = validSnapshot();
      snapshot.draft = { pages: [broken] };
      expect(validateSnapshot(snapshot)).toBeNull();
    }
  });
});

describe('localStorage 读写', () => {
  it('写入后可完整读回（往返一致）', () => {
    const storage = createMemoryStorage();
    const snapshot = validSnapshot();
    saveSnapshot(storage, snapshot);
    const result = loadSnapshot(storage);
    expect(result).toEqual({ kind: 'ok', snapshot });
    expect(storage.getItem(STORAGE_KEY)).toBe(serializeSnapshot(snapshot));
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it('没有数据时返回 empty', () => {
    expect(loadSnapshot(createMemoryStorage())).toEqual({ kind: 'empty' });
  });

  it('非 JSON 内容判定为损坏', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{oops');
    expect(loadSnapshot(storage)).toEqual({ kind: 'corrupt' });
  });

  it('结构非法的 JSON 判定为损坏', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 999 }));
    expect(loadSnapshot(storage)).toEqual({ kind: 'corrupt' });
  });

  it('清除后回到 empty', () => {
    const storage = createMemoryStorage();
    saveSnapshot(storage, validSnapshot());
    clearSnapshot(storage);
    expect(loadSnapshot(storage)).toEqual({ kind: 'empty' });
  });
});

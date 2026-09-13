import { describe, expect, it } from 'vitest';
import { createStoryStore } from './store';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createMemoryStorage,
  type Snapshot,
  type StorageLike,
} from './snapshot';
import { THEME_COLORS } from './story';

function readRaw(storage: StorageLike): Snapshot {
  const raw = storage.getItem(STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as Snapshot;
}

/** 录入两页合法故事并启动演示 */
function buildStartedStore(storage: StorageLike) {
  const store = createStoryStore(storage);
  store.addPage();
  store.addPage();
  const [p1, p2] = store.state.draftPages;
  store.updatePage(p1.id, { title: '去地铁站', description: '我们先坐电梯下楼。' });
  store.updatePage(p2.id, { title: '进站刷卡', description: '闸机会“嘀”一声。' });
  expect(store.startPresentation()).toBe(true);
  return store;
}

describe('store：每次操作先写快照再反馈', () => {
  it('创建与编辑草稿后立即写入带 schemaVersion 的快照', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    const page = store.state.draftPages[0];
    store.updatePage(page.id, { title: '标题', description: '说明' });

    const saved = readRaw(storage);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.draft?.pages).toHaveLength(1);
    expect(saved.draft?.pages[0]).toMatchObject({ title: '标题', description: '说明' });
    expect(saved.session).toBeNull();
  });

  it('启动、翻页、完成、重新开始都会同步落盘', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    expect(readRaw(storage).session).toMatchObject({ pageIndex: 0, status: 'presenting' });

    store.nextPage();
    expect(readRaw(storage).session).toMatchObject({ pageIndex: 1, status: 'presenting' });

    store.completeSession();
    const completed = readRaw(storage).session;
    expect(completed).toMatchObject({ status: 'completed', pageIndex: 1 });
    expect(completed?.completedAt).toBeTruthy();

    store.restartSession();
    const restarted = readRaw(storage).session;
    expect(restarted).toMatchObject({ pageIndex: 0, status: 'presenting', completedAt: null });
  });

  it('重新开始会覆盖旧进度而不是追加', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    store.nextPage();
    store.completeSession();
    const before = readRaw(storage).session!;
    store.restartSession();
    const after = readRaw(storage).session!;
    expect(after.pageIndex).toBe(0);
    expect(after.status).toBe('presenting');
    expect(after.completedAt).toBeNull();
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('模拟刷新：新实例从同一存储恢复出相同页码、内容与完成状态', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    store.nextPage();
    store.completeSession();

    const revived = createStoryStore(storage);
    expect(revived.state.view).toBe('presenter');
    expect(revived.state.session).toEqual(store.state.session);
    expect(revived.state.session?.status).toBe('completed');
    expect(revived.state.session?.pages.map((p) => p.title)).toEqual(['去地铁站', '进站刷卡']);
  });

  it('草稿与演示会话互不影响：编辑草稿不改变进行中的会话内容', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    const draftId = store.state.draftPages[0].id;
    store.updatePage(draftId, { title: '改过的标题' });
    expect(store.state.session?.pages[0].title).toBe('去地铁站');
    expect(readRaw(storage).session?.pages[0].title).toBe('去地铁站');
  });

  it('演示中翻页越界会被夹紧且不产生多余写入', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    expect(store.goToPage(99)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(1);
    const savedAt = store.state.savedAt;
    expect(store.goToPage(99)).toBe(false); // 已在最后一页，不再写入
    expect(store.state.savedAt).toBe(savedAt);
    expect(store.prevPage()).toBe(true);
    expect(store.state.session?.pageIndex).toBe(0);
  });

  it('写入失败时界面状态不变并给出错误反馈', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const store = createStoryStore(failing);
    expect(store.addPage()).toBe(false);
    expect(store.state.draftPages).toHaveLength(0);
    expect(store.state.saveError).toBeTruthy();
    expect(store.state.savedAt).toBeNull();
  });

  it('损坏快照：进入错误态、不部分套用，清除后可重新录入', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, draft: { pages: [{ title: '' }] }, session: null }),
    );
    const store = createStoryStore(storage);
    expect(store.state.corrupt).toBe(true);
    expect(store.state.draftPages).toHaveLength(0);
    // 损坏未清除前拒绝写入
    expect(store.addPage()).toBe(false);

    store.discardCorruptSnapshot();
    expect(store.state.corrupt).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(store.addPage()).toBe(true);
    expect(store.state.draftPages).toHaveLength(1);
  });

  it('未填完或暂时清空的草稿页面，刷新后仍可继续编辑（不判损坏）', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    const [p1, p2] = store.state.draftPages;
    store.updatePage(p1.id, { title: '只写了一半', description: '先存着' });
    store.updatePage(p2.id, { title: '又清空了', description: '想想再写' });
    store.updatePage(p2.id, { title: '', description: '' }); // 暂时清空

    // 模拟刷新：从同一存储恢复
    const revived = createStoryStore(storage);
    expect(revived.state.corrupt).toBe(false);
    expect(revived.state.view).toBe('editor');
    expect(revived.state.draftPages).toHaveLength(2);
    expect(revived.state.draftPages[0].title).toBe('只写了一半');
    expect(revived.state.draftPages[1].title).toBe('');
    // 恢复后可以继续编辑并正常落盘
    expect(revived.updatePage(revived.state.draftPages[1].id, { title: '补上了' })).toBe(true);
    expect(readRaw(storage).draft?.pages[1].title).toBe('补上了');
  });

  it('拒绝非法主题色与不足两页的启动', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    const page = store.state.draftPages[0];
    expect(store.updatePage(page.id, { color: 'not-a-color' })).toBe(false);
    expect(store.state.draftPages[0].color).toBe(THEME_COLORS[0].id);
    expect(store.startPresentation()).toBe(false); // 只有一页
  });

  it('上移/下移：先落盘再重排，页面对象与字段保持完整', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    store.addPage();
    const [p1, p2, p3] = store.state.draftPages;
    store.updatePage(p1.id, { title: '第一页', description: '说明一' });
    store.updatePage(p2.id, { title: '第二页', description: '说明二' });
    store.updatePage(p3.id, { title: '第三页', description: '说明三' });

    // 第三页连续上移到首位：[p1,p2,p3] → [p1,p3,p2] → [p3,p1,p2]
    expect(store.moveDraftPage(p3.id, 'up')).toBe(true);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p3.id, p2.id]);
    expect(readRaw(storage).draft?.pages.map((p) => p.id)).toEqual([p1.id, p3.id, p2.id]);
    expect(store.moveDraftPage(p3.id, 'up')).toBe(true);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
    expect(readRaw(storage).draft?.pages.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
    // 已到首位，继续上移被拒绝且不再写入
    expect(store.moveDraftPage(p3.id, 'up')).toBe(false);
    expect(readRaw(storage).draft?.pages.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);

    // 首项下移回到原位，再一路下移到末位，继续下移被拒绝
    expect(store.moveDraftPage(p3.id, 'down')).toBe(true);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p3.id, p2.id]);
    expect(store.moveDraftPage(p3.id, 'down')).toBe(true);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p2.id, p3.id]);
    expect(store.moveDraftPage(p3.id, 'down')).toBe(false); // 已在末位

    // 字段内容随页面一起移动、没有丢失
    const last = store.state.draftPages[2];
    expect(last.id).toBe(p3.id);
    expect(last).toMatchObject({ title: '第三页', description: '说明三' });
  });

  it('移动到边界之外：页面内容、顺序与保存状态均不发生变化', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    const [p1, p2] = store.state.draftPages;
    store.updatePage(p1.id, { title: '标题一', description: '说明一' });
    store.updatePage(p2.id, { title: '标题二', description: '说明二' });
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.moveDraftPage(p1.id, 'up')).toBe(false); // 首项上移
    expect(store.moveDraftPage(p2.id, 'down')).toBe(false); // 末项下移
    expect(store.moveDraftPage('不存在的id', 'up')).toBe(false);

    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(store.state.draftPages[0].title).toBe('标题一');
    expect(store.state.draftPages[1].title).toBe('标题二');
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
  });

  it('已启动的会话不接受重排；冻结副本的顺序保持启动时的草稿次序', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    const [p1, p2] = store.state.draftPages;
    const sessionSnapshot = JSON.parse(JSON.stringify(store.state.session));

    // 演示中尝试重排：会话与草稿都不变，不产生写入
    const savedAt = store.state.savedAt;
    expect(store.moveDraftPage(p2.id, 'up')).toBe(false);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(store.state.session).toEqual(sessionSnapshot);
    expect(store.state.savedAt).toBe(savedAt);

    // 回到编辑后可以重新排序；再次启动时冻结的副本按新顺序播放
    expect(store.exitToEditor()).toBe(true);
    expect(store.moveDraftPage(p2.id, 'up')).toBe(true);
    expect(store.state.draftPages.map((p) => p.id)).toEqual([p2.id, p1.id]);
    expect(store.startPresentation()).toBe(true);
    expect(store.state.session?.pages.map((p) => p.title)).toEqual(['进站刷卡', '去地铁站']);
  });

  it('调整顺序后模拟刷新：新实例按数组原序恢复草稿', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    store.addPage();
    const [p1, p2, p3] = store.state.draftPages;
    store.updatePage(p1.id, { title: '第一页', description: '说明一' });
    store.updatePage(p2.id, { title: '第二页', description: '说明二' });
    store.updatePage(p3.id, { title: '第三页', description: '说明三' });
    store.moveDraftPage(p3.id, 'up');
    store.moveDraftPage(p3.id, 'up');
    expect(store.state.draftPages.map((p) => p.title)).toEqual(['第三页', '第一页', '第二页']);

    const revived = createStoryStore(storage);
    expect(revived.state.view).toBe('editor');
    expect(revived.state.draftPages.map((p) => p.title)).toEqual(['第三页', '第一页', '第二页']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStoryStore, AUTOPLAY_INTERVAL_MS, AUTOPLAY_TICKS_PER_PAGE } from './store';
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

  it('删除不存在的页面：拒绝操作，内容、保存时间与快照完全不变', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    const [p1, p2] = store.state.draftPages;
    store.updatePage(p1.id, { title: '标题一', description: '说明一' });
    store.updatePage(p2.id, { title: '标题二', description: '说明二' });
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.removePage('不存在的id')).toBe(false);

    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(store.state.draftPages[0].title).toBe('标题一');
    expect(store.state.draftPages[1].title).toBe('标题二');
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
  });

  it('更新不存在的页面：拒绝操作，不产生写入与保存时间刷新', () => {
    const storage = createMemoryStorage();
    const store = createStoryStore(storage);
    store.addPage();
    store.addPage();
    const [p1, p2] = store.state.draftPages;
    store.updatePage(p1.id, { title: '标题一', description: '说明一' });
    store.updatePage(p2.id, { title: '标题二', description: '说明二' });
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.updatePage('不存在的id', { title: '新标题' })).toBe(false);
    expect(store.updatePage('不存在的id', { color: 'mint' })).toBe(false);

    expect(store.state.draftPages.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(store.state.draftPages[0].title).toBe('标题一');
    expect(store.state.draftPages[1].title).toBe('标题二');
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
  });

  it('未到最后一页时触发完成：拒绝并继续播放，到末页后才可完成', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    // 两页故事，刚在第一页开始播放
    expect(store.state.session?.pageIndex).toBe(0);
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.completeSession()).toBe(false);
    expect(store.state.session?.status).toBe('presenting');
    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.session?.completedAt).toBeNull();
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);

    // 翻到最后一页后可以正常完成并落盘
    expect(store.nextPage()).toBe(true);
    expect(store.completeSession()).toBe(true);
    expect(readRaw(storage).session).toMatchObject({ status: 'completed', pageIndex: 1 });
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

/** 录入 n 页合法故事并启动演示 */
function buildStartedStoreWithPages(storage: StorageLike, count: number) {
  const store = createStoryStore(storage);
  for (let i = 0; i < count; i += 1) store.addPage();
  store.state.draftPages.forEach((page, index) => {
    store.updatePage(page.id, { title: `第${index + 1}页`, description: `第${index + 1}页说明` });
  });
  expect(store.startPresentation()).toBe(true);
  return store;
}

const EIGHT_SECONDS = AUTOPLAY_INTERVAL_MS * AUTOPLAY_TICKS_PER_PAGE;

describe('store：自动播放（可控时钟）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('启动演示默认手动模式，不开启任何计时器', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    expect(store.state.session?.playMode).toBe('manual');
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(store.state.session?.pageIndex).toBe(0);
  });

  it('播放模式随快照保存；重复设为相同模式不产生多余写入', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    expect(readRaw(storage).session?.playMode).toBe('manual');

    expect(store.setPlayMode('auto')).toBe(true);
    expect(readRaw(storage).session?.playMode).toBe('auto');
    const savedAt = store.state.savedAt;
    expect(store.setPlayMode('auto')).toBe(true);
    expect(store.state.savedAt).toBe(savedAt);
  });

  it('每 8 秒只推进一次：不足八秒不动，整八秒提交下一页', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage); // 两页故事
    expect(store.setPlayMode('auto')).toBe(true);
    expect(store.state.autoRemainingSeconds).toBe(8);
    expect(vi.getTimerCount()).toBe(1);

    // 剩余秒数每秒递减；不足八秒不翻页
    vi.advanceTimersByTime(7_999);
    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.autoRemainingSeconds).toBe(1);

    // 整八秒提交下一页；两页故事到达末页后计时器停止
    vi.advanceTimersByTime(1);
    expect(store.state.session?.pageIndex).toBe(1);
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(readRaw(storage).session?.pageIndex).toBe(1);

    // 末页只是停止自动推进，等待现有“完成”操作，绝不自行完成
    vi.advanceTimersByTime(30_000);
    expect(store.state.session?.pageIndex).toBe(1);
    expect(store.state.session?.status).toBe('presenting');
    expect(store.state.session?.completedAt).toBeNull();
  });

  it('多页故事连续前进：每次翻页都以新的完整八秒周期取代旧计时器', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');

    vi.advanceTimersByTime(EIGHT_SECONDS);
    expect(store.state.session?.pageIndex).toBe(1);
    expect(store.state.autoRemainingSeconds).toBe(8);
    expect(vi.getTimerCount()).toBe(1); // 旧计时器已取消、新周期已建立

    vi.advanceTimersByTime(EIGHT_SECONDS);
    expect(store.state.session?.pageIndex).toBe(2);
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0); // 末页停止
    expect(store.state.session?.status).toBe('presenting');
  });

  it('手动前后翻页会从当前页重新计时（旧周期不继续推进）', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000); // 已走 5 秒，剩 3 秒
    expect(store.state.autoRemainingSeconds).toBe(3);

    expect(store.nextPage()).toBe(true); // 手动提前翻到第二页
    expect(store.state.session?.pageIndex).toBe(1);
    expect(store.state.autoRemainingSeconds).toBe(8); // 重新开始完整八秒
    vi.advanceTimersByTime(7_999);
    expect(store.state.session?.pageIndex).toBe(1);
    vi.advanceTimersByTime(1);
    expect(store.state.session?.pageIndex).toBe(2);

    // 向后翻页同样重置计时
    expect(store.prevPage()).toBe(true);
    expect(store.state.session?.pageIndex).toBe(1);
    expect(store.state.autoRemainingSeconds).toBe(8);
    vi.advanceTimersByTime(EIGHT_SECONDS);
    expect(store.state.session?.pageIndex).toBe(2);
  });

  it('关闭自动播放立即取消计时，之后不再自动翻页', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000);

    expect(store.setPlayMode('manual')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(readRaw(storage).session?.playMode).toBe('manual');
    vi.advanceTimersByTime(30_000);
    expect(store.state.session?.pageIndex).toBe(0);
  });

  it('刷新自动播放中的会话：恢复自动模式并从完整八秒重新计时', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000); // 仅剩 3 秒时“刷新”
    expect(store.state.autoRemainingSeconds).toBe(3);
    store.dispose();

    const revived = createStoryStore(storage);
    expect(revived.state.session?.playMode).toBe('auto');
    expect(revived.state.autoRemainingSeconds).toBe(8); // 从完整八秒重新计时
    expect(vi.getTimerCount()).toBe(1);
    // 若沿用刷新前的剩余 3 秒，此处早已翻页；重新计时后第七秒仍在第一页
    vi.advanceTimersByTime(7_999);
    expect(revived.state.session?.pageIndex).toBe(0);
    vi.advanceTimersByTime(1);
    expect(revived.state.session?.pageIndex).toBe(1);
  });

  it('缺少 playMode 字段的旧快照按手动模式恢复，不自动翻页', () => {
    const storage = createMemoryStorage();
    buildStartedStore(storage);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
    delete raw.session.playMode;
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const revived = createStoryStore(storage);
    expect(revived.state.session?.playMode).toBe('manual');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(revived.state.session?.pageIndex).toBe(0);
  });

  it('定时翻页写入失败：停在原页、关闭自动播放并继续显示存储错误', () => {
    const memory = createMemoryStorage();
    let failWrites = false;
    const flaky: StorageLike = {
      getItem: (key) => memory.getItem(key),
      setItem: (key, value) => {
        if (failWrites) throw new Error('QuotaExceededError');
        memory.setItem(key, value);
      },
      removeItem: (key) => memory.removeItem(key),
    };
    const store = buildStartedStoreWithPages(flaky, 3);
    store.setPlayMode('auto');
    expect(store.state.saveError).toBeNull();

    failWrites = true; // 存储在计时到点时不可用
    vi.advanceTimersByTime(EIGHT_SECONDS);

    expect(store.state.session?.pageIndex).toBe(0); // 画面停在原页
    expect(store.state.session?.playMode).toBe('manual'); // 自动播放已关闭
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0); // 旧计时器已清理，不再重复尝试推进
    expect(store.state.saveError).toBeTruthy(); // 继续显示现有存储错误提示

    vi.advanceTimersByTime(30_000);
    expect(store.state.session?.pageIndex).toBe(0);
  });

  it('重新开始、回到编辑、组件卸载都会取消旧计时器', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(EIGHT_SECONDS); // 到末页自动停
    expect(store.state.session?.pageIndex).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    // 重新开始：保留自动模式，回到第一页重新计时
    expect(store.restartSession()).toBe(true);
    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.session?.playMode).toBe('auto');
    expect(store.state.autoRemainingSeconds).toBe(8);
    expect(vi.getTimerCount()).toBe(1);

    // 回到编辑：会话清除、计时器取消
    expect(store.exitToEditor()).toBe(true);
    expect(store.state.session).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // 组件卸载时重复取消也是安全的
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完成后计时器停止，且完成态不允许切换播放模式', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStore(storage);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(EIGHT_SECONDS); // 自动到达末页并停止
    expect(store.completeSession()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.setPlayMode('manual')).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(store.state.session?.status).toBe('completed');
  });
});

describe('store：页码导航直接跳转', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('有效跳转一次到位并落盘；自动模式下从目标页重新计完整八秒', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000); // 已走 5 秒，剩 3 秒
    expect(store.state.autoRemainingSeconds).toBe(3);

    // 向前跳到中间页：倒计时从完整八秒重新开始
    expect(store.jumpToPage(1)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(1);
    expect(readRaw(storage).session?.pageIndex).toBe(1);
    expect(store.state.autoRemainingSeconds).toBe(8);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(7_999);
    expect(store.state.session?.pageIndex).toBe(1); // 旧周期没有继续推进
    vi.advanceTimersByTime(1);
    expect(store.state.session?.pageIndex).toBe(2);

    // 向后跳回第一页同样重新计时
    expect(store.jumpToPage(0)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.autoRemainingSeconds).toBe(8);
    expect(vi.getTimerCount()).toBe(1);

    // 直接跳到最后一页：与翻页到末页一致，自动推进停止
    expect(store.jumpToPage(2)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(2);
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.state.session?.status).toBe('presenting'); // 不自行完成
  });

  it('手动模式下跳转不产生计时器，快照同步更新', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    expect(store.jumpToPage(2)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(2);
    expect(readRaw(storage).session?.pageIndex).toBe(2);
    expect(store.state.autoRemainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    expect(store.jumpToPage(0)).toBe(true);
    expect(readRaw(storage).session?.pageIndex).toBe(0);
  });

  it('越界与非法索引：会话、快照、保存时间与计时器完全不变', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000); // 剩 3 秒
    expect(store.state.autoRemainingSeconds).toBe(3);
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.jumpToPage(-1)).toBe(false);
    expect(store.jumpToPage(3)).toBe(false);
    expect(store.jumpToPage(99)).toBe(false);
    expect(store.jumpToPage(1.5)).toBe(false);

    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
    expect(store.state.autoRemainingSeconds).toBe(3); // 倒计时未被重置
    expect(vi.getTimerCount()).toBe(1);

    // 原周期不受干扰：剩余 3 秒走完照常自动翻页
    vi.advanceTimersByTime(3_000);
    expect(store.state.session?.pageIndex).toBe(1);
  });

  it('选择当前页：幂等成功但不产生写入、不重置计时', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000);
    const savedAt = store.state.savedAt;
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.jumpToPage(0)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(0);
    expect(store.state.savedAt).toBe(savedAt);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
    expect(store.state.autoRemainingSeconds).toBe(3);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('写入失败：停留原页、倒计时与自动模式维持原状，存储恢复后可重试成功', () => {
    const memory = createMemoryStorage();
    let failWrites = false;
    const flaky: StorageLike = {
      getItem: (key) => memory.getItem(key),
      setItem: (key, value) => {
        if (failWrites) throw new Error('QuotaExceededError');
        memory.setItem(key, value);
      },
      removeItem: (key) => memory.removeItem(key),
    };
    const store = buildStartedStoreWithPages(flaky, 3);
    store.setPlayMode('auto');
    vi.advanceTimersByTime(5_000); // 剩 3 秒
    expect(store.state.autoRemainingSeconds).toBe(3);

    failWrites = true;
    expect(store.jumpToPage(2)).toBe(false);
    expect(store.state.session?.pageIndex).toBe(0); // 画面停在原页
    expect(store.state.autoRemainingSeconds).toBe(3); // 倒计时维持原状
    expect(store.state.session?.playMode).toBe('auto'); // 不关闭自动播放
    expect(vi.getTimerCount()).toBe(1); // 原周期继续
    expect(store.state.saveError).toBeTruthy(); // 沿用现有存储错误提示

    // 存储恢复后重试同一目标：跳转成功并从完整八秒重新计时
    failWrites = false;
    expect(store.jumpToPage(2)).toBe(true);
    expect(store.state.session?.pageIndex).toBe(2);
    expect(store.state.saveError).toBeNull();
    expect(readRaw(memory).session?.pageIndex).toBe(2);
    expect(store.state.autoRemainingSeconds).toBe(0); // 末页停止
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完成态不接受跳转', () => {
    const storage = createMemoryStorage();
    const store = buildStartedStoreWithPages(storage, 3);
    expect(store.jumpToPage(2)).toBe(true);
    expect(store.completeSession()).toBe(true);
    const savedRaw = storage.getItem(STORAGE_KEY);

    expect(store.jumpToPage(0)).toBe(false);
    expect(store.state.session?.status).toBe('completed');
    expect(store.state.session?.pageIndex).toBe(2);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedRaw);
  });
});

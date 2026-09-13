import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'story-resume:snapshot';

/** 录入一个两页故事并启动演示 */
async function createAndStart(page: Page) {
  await page.goto('/');
  await page.getByTestId('add-page').click();
  await page.getByTestId('add-page').click();

  const cards = page.getByTestId('page-card');
  await cards.nth(0).getByTestId('title-input').fill('去地铁站');
  await cards.nth(0).getByTestId('desc-input').fill('我们先坐电梯下楼。');
  await cards.nth(0).getByTestId('color-mint').check();
  await cards.nth(1).getByTestId('title-input').fill('进站刷卡');
  await cards.nth(1).getByTestId('desc-input').fill('闸机会“嘀”一声。');
  await cards.nth(1).getByTestId('color-coral').check();

  await page.getByTestId('start-presentation').click();
  await expect(page.getByTestId('presenter')).toBeVisible();
}

test('刷新后续播：页码、内容与刷新前完全一致', async ({ page }) => {
  await createAndStart(page);
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await expect(page.getByTestId('page-title')).toHaveText('去地铁站');

  // 按钮翻到第二页
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 2 页');
  await expect(page.getByTestId('page-title')).toHaveText('进站刷卡');
  await expect(page.getByTestId('page-description')).toHaveText('闸机会“嘀”一声。');

  // 刷新（模拟浏览器被误关后重开）：仍在第二页，内容一致
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 2 页');
  await expect(page.getByTestId('page-title')).toHaveText('进站刷卡');
  await expect(page.getByTestId('page-description')).toHaveText('闸机会“嘀”一声。');

  // 键盘方向键翻回第一页，刷新后依然保持
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await expect(page.getByTestId('page-title')).toHaveText('去地铁站');

  // 键盘向右翻页同样生效
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 2 页');
});

test('完成状态持久化；重新开始回到第一页并覆盖旧进度', async ({ page }) => {
  await createAndStart(page);
  await page.getByTestId('next-page').click();
  await page.getByTestId('complete-session').click();
  await expect(page.getByTestId('completed-screen')).toBeVisible();

  // 刷新后仍是完成状态
  await page.reload();
  await expect(page.getByTestId('completed-screen')).toBeVisible();

  // 重新开始：回到第一页，旧进度被覆盖
  await page.getByTestId('restart-session').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await expect(page.getByTestId('page-title')).toHaveText('去地铁站');

  const snapshot = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  );
  expect(snapshot.session).toMatchObject({ pageIndex: 0, status: 'presenting', completedAt: null });

  // 刷新后仍是“第一页、进行中”，而不是旧的完成状态
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await expect(page.getByTestId('completed-screen')).toBeHidden();
});

test('草稿未填完时刷新不判损坏，可继续编辑', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-page').click();
  await page.getByTestId('add-page').click();

  const cards = page.getByTestId('page-card');
  // 第一页写了一半，第二页完全空白
  await cards.nth(0).getByTestId('title-input').fill('只写了一半');

  await page.reload();
  await expect(page.getByTestId('snapshot-error')).toBeHidden();
  await expect(page.getByTestId('page-card')).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('title-input')).toHaveValue('只写了一半');
  await expect(cards.nth(1).getByTestId('title-input')).toHaveValue('');

  // 暂时清空已填内容再刷新，依然不判损坏
  await cards.nth(0).getByTestId('title-input').fill('');
  await page.reload();
  await expect(page.getByTestId('snapshot-error')).toBeHidden();
  await expect(page.getByTestId('page-card')).toHaveCount(2);

  // 可以继续录入直至启动演示
  await cards.nth(0).getByTestId('title-input').fill('去地铁站');
  await cards.nth(0).getByTestId('desc-input').fill('我们先坐电梯下楼。');
  await cards.nth(1).getByTestId('title-input').fill('进站刷卡');
  await cards.nth(1).getByTestId('desc-input').fill('闸机会“嘀”一声。');
  await page.getByTestId('start-presentation').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
});

test('损坏快照：给出错误反馈，可清除后重新录入', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify({ schemaVersion: 999, session: { pageIndex: 99 } })),
    STORAGE_KEY,
  );
  await page.reload();

  // 不部分套用坏数据，而是给出可操作的错误反馈
  await expect(page.getByTestId('snapshot-error')).toBeVisible();
  await expect(page.getByTestId('presenter')).toBeHidden();

  await page.getByTestId('clear-corrupt').click();
  await expect(page.getByTestId('snapshot-error')).toBeHidden();
  await expect(page.getByTestId('add-page')).toBeVisible();
  const cleared = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(cleared).toBeNull();

  // 重新录入的路径仍然可用
  await createAndStart(page);
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
});

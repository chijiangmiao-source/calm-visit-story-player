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

/** 录入指定页数的故事并启动演示 */
async function createPagesAndStart(page: Page, count: number) {
  await page.goto('/');
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('add-page').click();
  }
  const cards = page.getByTestId('page-card');
  for (let i = 0; i < count; i += 1) {
    await cards.nth(i).getByTestId('title-input').fill(`第${i + 1}页标题`);
    await cards.nth(i).getByTestId('desc-input').fill(`第${i + 1}页说明`);
  }
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

test('上移调整叙事次序：编辑器顺序、演示播放顺序与刷新恢复一致', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-page').click();
  await page.getByTestId('add-page').click();
  await page.getByTestId('add-page').click();

  const cards = page.getByTestId('page-card');
  const titles = ['第一站', '第二站', '第三站'];
  for (let i = 0; i < 3; i += 1) {
    await cards.nth(i).getByTestId('title-input').fill(titles[i]);
    await cards.nth(i).getByTestId('desc-input').fill(`${titles[i]}的说明`);
  }

  // 边界按钮：首项“上移”、末项“下移”禁用
  await expect(cards.nth(0).getByTestId('move-up')).toBeDisabled();
  await expect(cards.nth(2).getByTestId('move-down')).toBeDisabled();
  await expect(cards.nth(0).getByTestId('move-down')).toBeEnabled();
  await expect(cards.nth(2).getByTestId('move-up')).toBeEnabled();

  // 第三页连续上移到首位：[1,2,3] → [1,3,2] → [3,1,2]
  await cards.nth(2).getByTestId('move-up').click();
  await cards.nth(1).getByTestId('move-up').click();

  const reordered = ['第三站', '第一站', '第二站'];
  for (let i = 0; i < 3; i += 1) {
    await expect(cards.nth(i).getByTestId('title-input')).toHaveValue(reordered[i]);
    await expect(cards.nth(i).locator('strong')).toHaveText(`第 ${i + 1} 页`);
  }
  // 新的首项上移禁用、原首项（现第二页）上移恢复可用
  await expect(cards.nth(0).getByTestId('move-up')).toBeDisabled();
  await expect(cards.nth(1).getByTestId('move-up')).toBeEnabled();

  // 刷新编辑页：顺序仍由现有快照按数组原序恢复，无需迁移
  await page.reload();
  const restoredCards = page.getByTestId('page-card');
  for (let i = 0; i < 3; i += 1) {
    await expect(restoredCards.nth(i).getByTestId('title-input')).toHaveValue(reordered[i]);
  }

  // 启动演示冻结调整后的次序，逐页播放顺序一致
  await page.getByTestId('start-presentation').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第三站');
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-title')).toHaveText('第一站');
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第二站');

  // 演示中刷新，仍停在调整后次序的第三页
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第二站');
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

test('自动播放：默认手动；开启后每 8 秒连续前进，按钮与方向键仍可干预', async ({ page }) => {
  await createPagesAndStart(page, 3);

  // 演示开始后默认手动模式，没有开关勾选与倒计时
  const toggle = page.getByTestId('autoplay-toggle');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('autoplay-countdown')).toBeHidden();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');

  // 原有按钮仍可临时干预（自动未开启时）
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 3 页');

  // 开启自动播放：从当前页完整八秒倒计时
  await toggle.check();
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('8 秒后翻到下一页');

  // 到点连续前进到第三页
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页', { timeout: 12_000 });
  await expect(page.getByTestId('page-title')).toHaveText('第3页标题');

  // 末页自动停止：只显示“已到最后一页”，不会自行完成
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('已到最后一页');
  await expect(page.getByTestId('completed-screen')).toBeHidden();
  await expect(page.getByTestId('complete-session')).toBeVisible();
  await page.waitForTimeout(9_000);
  await expect(page.getByTestId('completed-screen')).toBeHidden();
  await expect(page.getByTestId('complete-session')).toBeVisible();

  // 现有“完成”操作仍由照护者手动触发
  await page.getByTestId('complete-session').click();
  await expect(page.getByTestId('completed-screen')).toBeVisible();
});

test('自动播放中手动翻页会从当前页重新计时', async ({ page }) => {
  await createPagesAndStart(page, 3);
  await page.getByTestId('autoplay-toggle').check();
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('8 秒后翻到下一页');

  // 等几秒后手动提前翻页：倒计时重新从 8 秒开始
  await page.waitForTimeout(3_000);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 3 页');
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('8 秒后翻到下一页');

  // 重置后的完整八秒内不应自动跳走
  await page.waitForTimeout(7_000);
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 3 页');

  // 八秒到点后才自动前进
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页', { timeout: 4_000 });
});

test('自动播放刷新后续播：模式保留、从完整八秒重新计时，关闭开关后停止', async ({ page }) => {
  await createPagesAndStart(page, 2);
  await page.getByTestId('autoplay-toggle').check();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');

  // 数秒后刷新：模式随快照恢复，但计时从完整八秒重新开始
  await page.waitForTimeout(3_000);
  await page.reload();
  await expect(page.getByTestId('presenter')).toBeVisible();
  await expect(page.getByTestId('autoplay-toggle')).toBeChecked();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('8 秒后翻到下一页');

  // 刷新后 7 秒内不翻页（证明没有沿用刷新前仅剩的 5 秒）
  await page.waitForTimeout(7_000);
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');

  // 完整八秒后自动翻到末页并停止
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 2 页', { timeout: 4_000 });
  await expect(page.getByTestId('autoplay-countdown')).toHaveText('已到最后一页');

  // 再刷新：仍停在末页、自动模式保留、不自行完成
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 2 页');
  await expect(page.getByTestId('autoplay-toggle')).toBeChecked();
  await page.waitForTimeout(9_000);
  await expect(page.getByTestId('completed-screen')).toBeHidden();
  await expect(page.getByTestId('complete-session')).toBeVisible();

  // 关闭开关即停止自动播放
  await page.getByTestId('autoplay-toggle').uncheck();
  await expect(page.getByTestId('autoplay-countdown')).toBeHidden();
  await page.waitForTimeout(9_000);
  await expect(page.getByTestId('completed-screen')).toBeHidden();
});

test('缺少播放模式字段的旧快照按手动模式恢复，不会自动翻页', async ({ page }) => {
  await createAndStart(page);
  // 移除快照中的新字段，模拟旧版本写入的数据
  await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key)!);
    delete raw.session.playMode;
    localStorage.setItem(key, JSON.stringify(raw));
  }, STORAGE_KEY);

  await page.reload();
  await expect(page.getByTestId('presenter')).toBeVisible();
  await expect(page.getByTestId('autoplay-toggle')).not.toBeChecked();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
  await page.waitForTimeout(9_000);
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 2 页');
});

test('页码导航：从第二页直跳首尾页，刷新停在最后选择；写入失败保持原页可重试', async ({ page }) => {
  await createPagesAndStart(page, 3);
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 3 页');

  const navToggle = page.getByTestId('page-nav-toggle');
  const navItems = page.getByTestId('page-nav-item');

  // 展开导航：按页码与标题列出冻结副本
  await navToggle.click();
  await expect(page.getByTestId('page-nav')).toBeVisible();
  await expect(navItems).toHaveCount(3);
  await expect(navItems.nth(0)).toContainText('第 1 页');
  await expect(navItems.nth(0)).toContainText('第1页标题');
  await expect(navItems.nth(2)).toContainText('第 3 页');
  await expect(navItems.nth(2)).toContainText('第3页标题');

  // 从第二页直接跳到第一页：回到单页画面，导航收起
  await navItems.nth(0).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第1页标题');
  await expect(page.getByTestId('page-nav')).toBeHidden();

  // 后续按钮与方向键都从该页继续
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 2 / 3 页');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');

  // 再直接跳到最后一页
  await navToggle.click();
  await navItems.nth(2).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第3页标题');

  // 刷新后停在最后一次成功选择的位置
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第3页标题');

  // 存储写入失败：导航保持打开、标出未能跳转，当前页维持原状
  await page.evaluate(() => {
    (window as unknown as { __origSetItem: typeof Storage.prototype.setItem }).__origSetItem =
      Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
  });
  await navToggle.click();
  await navItems.nth(0).click();
  await expect(page.getByTestId('page-nav')).toBeVisible(); // 导航保持打开
  await expect(page.getByTestId('page-nav-failed')).toBeVisible(); // 标出未能跳转
  await expect(page.getByTestId('page-indicator')).toHaveText('第 3 / 3 页'); // 停留原页
  await expect(page.getByTestId('save-error')).toBeVisible(); // 现有存储错误提示

  // 存储恢复后可直接重试：跳转成功、导航收起、错误提示消除
  await page.evaluate(() => {
    Storage.prototype.setItem = (
      window as unknown as { __origSetItem: typeof Storage.prototype.setItem }
    ).__origSetItem;
  });
  await navItems.nth(0).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');
  await expect(page.getByTestId('page-nav')).toBeHidden();
  await expect(page.getByTestId('save-error')).toBeHidden();

  // 重试成功后的位置同样持久化
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('第 1 / 3 页');
  await expect(page.getByTestId('page-title')).toHaveText('第1页标题');
});

import { expect, test, type Page } from '@playwright/test';

const CHOICE_KEY = 'choice-board:rounds';
const STORY_KEY = 'story-resume:snapshot';

/** 打开发布表单并发布一轮（默认两个选项；addExtra 可增加到 3-4 个） */
async function publishRound(
  page: Page,
  prompt: string,
  options: string[],
) {
  await page.goto('/#choice');
  await page.getByTestId('choice-prompt-input').fill(prompt);
  const inputs = page.locator('[data-choice-option-input]');
  const needAdd = options.length - 2;
  for (let i = 0; i < needAdd; i += 1) {
    await page.getByTestId('choice-add-option').click();
  }
  await expect(inputs).toHaveCount(options.length);
  for (let i = 0; i < options.length; i += 1) {
    await inputs.nth(i).fill(options[i]);
  }
  await page.getByTestId('choice-publish').click();
}

/** 模拟本地存储写入失败（如配额不足） */
async function simulateStorageFailure(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
    w.__origSetItem = w.__origSetItem ?? Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
  });
}

/** 恢复本地存储的正常写入 */
async function restoreStorage(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
    if (w.__origSetItem) Storage.prototype.setItem = w.__origSetItem;
  });
}

test('编辑页旁有独立入口进入选择板，空状态提示先发布', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('choice-entry')).toBeVisible();
  await page.getByTestId('choice-entry').click();
  await expect(page).toHaveURL(/#choice$/);
  await expect(page.getByTestId('choice-board')).toBeVisible();
  await expect(page.getByTestId('choice-empty')).toBeVisible();
  await expect(page.getByTestId('choice-prompt-input')).toBeVisible();
  // 返回入口回到故事编辑页
  await page.getByTestId('choice-back').click();
  await expect(page).toHaveURL(/[^#]$|#story$/);
  await expect(page.getByTestId('add-page')).toBeVisible();
});

test('发布三个选项、完成选择后锁定；刷新确认锁定结果', async ({ page }) => {
  await publishRound(page, '临时改道了，我们先做哪一件？', [
    '先去洗手间',
    '在休息区坐一会儿',
    '去看大鱼缸',
  ]);

  // 当前轮进入待选择阶段，展示提示与三个选项
  await expect(page.getByTestId('choice-round-no')).toContainText('第 1 轮');
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await expect(page.getByTestId('choice-prompt-text')).toHaveText('临时改道了，我们先做哪一件？');
  const optionButtons = page.locator('[data-choice-option]');
  await expect(optionButtons).toHaveCount(3);
  await expect(optionButtons.nth(0)).toBeEnabled();

  // 孩子点选第二项：本轮立即锁定
  await optionButtons.nth(1).click();
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('在休息区坐一会儿');
  // 所有选项按钮禁用，无法再次选择
  for (let i = 0; i < 3; i += 1) {
    await expect(optionButtons.nth(i)).toBeDisabled();
  }

  // 已落盘：最后一轮为 chosen 且结果指向第二项
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHOICE_KEY);
  expect(saved.rounds).toHaveLength(1);
  expect(saved.rounds[0].status).toBe('chosen');
  const chosenId = saved.rounds[0].chosenOptionId;
  expect(saved.rounds[0].options.find((o: { id: string }) => o.id === chosenId).label).toBe(
    '在休息区坐一会儿',
  );

  // 刷新：恢复最后一轮及其锁定结果
  await page.reload();
  await expect(page.getByTestId('choice-board')).toBeVisible();
  await expect(page.getByTestId('choice-round-no')).toContainText('第 1 轮');
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('在休息区坐一会儿');
  await expect(optionButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(optionButtons.nth(0)).toBeDisabled();

  // 照护者修改内容再次发布下一轮：表单已用上一轮预填，改成新的三项
  await page.getByTestId('choice-prompt-input').fill('缓一缓之后，接下来呢？');
  const inputs = page.locator('[data-choice-option-input]');
  await expect(inputs).toHaveCount(3);
  await inputs.nth(0).fill('慢慢走进展厅');
  await inputs.nth(1).fill('先回家');
  await inputs.nth(2).fill('再去一次洗手间');
  await page.getByTestId('choice-publish').click();

  await expect(page.getByTestId('choice-round-no')).toContainText('第 2 轮');
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  const roundTwoButtons = page.locator('[data-choice-option]');
  await expect(roundTwoButtons).toHaveCount(3);
  await roundTwoButtons.nth(0).click();
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('慢慢走进展厅');

  // 刷新后恢复的是最后一轮（第二轮）的锁定结果
  await page.reload();
  await expect(page.getByTestId('choice-round-no')).toContainText('第 2 轮');
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('慢慢走进展厅');
  const savedTwo = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHOICE_KEY);
  expect(savedTwo.rounds).toHaveLength(2);
  expect(savedTwo.rounds[0].status).toBe('chosen');
  expect(savedTwo.rounds[1].status).toBe('chosen');
});

test('发布校验：提示或选项为空、选项重复、数量越界都会被拒绝且不发布', async ({ page }) => {
  await page.goto('/#choice');
  const inputs = page.locator('[data-choice-option-input]');

  // 空提示 + 一个空选项：逐条标注，轮次不出现
  await page.getByTestId('choice-publish').click();
  await expect(page.getByTestId('choice-prompt-error')).toBeVisible();
  await expect(page.getByTestId('choice-option-error-0')).toBeVisible();
  await expect(page.getByTestId('choice-option-error-1')).toBeVisible();
  await expect(page.getByTestId('choice-empty')).toBeVisible();

  // 填好提示与两项，但重复：拒绝并标注重复项
  await page.getByTestId('choice-prompt-input').fill('选一个');
  await inputs.nth(0).fill('喝水');
  await inputs.nth(1).fill(' 喝水 ');
  await page.getByTestId('choice-publish').click();
  await expect(page.getByTestId('choice-option-error-1')).toContainText('不能重复');
  await expect(page.getByTestId('choice-empty')).toBeVisible();

  // 添加按钮到 4 个后禁用，不能超出 4 个；删除至少保留 2 个
  await page.getByTestId('choice-add-option').click();
  await page.getByTestId('choice-add-option').click();
  await expect(page.locator('[data-choice-option-input]')).toHaveCount(4);
  await expect(page.getByTestId('choice-add-option')).toBeDisabled();
  const removeButtons = page.getByTestId('choice-remove-option');
  for (let i = 0; i < 2; i += 1) await removeButtons.nth(0).click();
  await expect(page.locator('[data-choice-option-input]')).toHaveCount(2);
  const removeAtTwo = page.getByTestId('choice-remove-option');
  await expect(removeAtTwo).toHaveCount(2);
  await expect(removeAtTwo.first()).toBeDisabled();
  await expect(removeAtTwo.nth(1)).toBeDisabled();

  // 改为两项合法内容后发布成功
  await page.locator('[data-choice-option-input]').nth(0).fill('喝水');
  await page.locator('[data-choice-option-input]').nth(1).fill('休息');
  await page.getByTestId('choice-publish').click();
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await expect(page.locator('[data-choice-option]')).toHaveCount(2);
});

test('损坏的选择板数据只阻断该入口：故事草稿照常载入，清除后可重建', async ({ page }) => {
  // 先在故事编辑页留下一个草稿页（写入故事快照）
  await page.goto('/');
  await page.getByTestId('add-page').click();
  await page.getByTestId('title-input').fill('草稿页标题');

  // 写入损坏的选择板数据（非 JSON），随后整页重新加载到选择板入口
  await page.evaluate((key) => localStorage.setItem(key, '{oops'), CHOICE_KEY);
  await page.goto('/#choice');
  await page.reload();

  // 选择板入口被阻断，给出清除入口
  await expect(page.getByTestId('choice-error')).toBeVisible();
  await expect(page.getByTestId('choice-board')).toBeHidden();

  // 返回故事编辑：草稿与录入能力照常，没有被选择板坏数据波及
  await page.getByTestId('choice-error-back').click();
  await expect(page.getByTestId('add-page')).toBeVisible();
  await expect(page.getByTestId('page-card')).toHaveCount(1);
  await expect(page.getByTestId('title-input')).toHaveValue('草稿页标题');
  // 故事快照完好
  const storyRaw = await page.evaluate((key) => localStorage.getItem(key), STORY_KEY);
  expect(storyRaw).not.toBeNull();
  expect(JSON.parse(storyRaw!).draft.pages[0].title).toBe('草稿页标题');

  // 进入选择板清除坏数据并重建
  await page.getByTestId('choice-entry').click();
  await page.getByTestId('choice-clear-corrupt').click();
  await expect(page.getByTestId('choice-error')).toBeHidden();
  await expect(page.getByTestId('choice-empty')).toBeVisible();
  const cleared = await page.evaluate((key) => localStorage.getItem(key), CHOICE_KEY);
  expect(cleared).toBeNull();
  // 故事快照仍在
  expect(await page.evaluate((key) => localStorage.getItem(key), STORY_KEY)).toBe(storyRaw);

  // 重建：可以正常发布与选择
  await publishRound(page, '现在想先做什么？', ['抱一抱', '喝口水']);
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await page.locator('[data-choice-option]').nth(0).click();
  await expect(page.getByTestId('choice-result')).toContainText('抱一抱');
});

test('故事快照损坏时选择板入口仍可正常使用（两侧互不阻断）', async ({ page }) => {
  // 故事快照损坏：故事页进入错误态
  await page.goto('/');
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify({ schemaVersion: 999 })),
    STORY_KEY,
  );
  await page.reload();
  await expect(page.getByTestId('snapshot-error')).toBeVisible();

  // 选择板入口不受故事坏数据影响，可直接打开发布
  await page.goto('/#choice');
  await expect(page.getByTestId('choice-board')).toBeVisible();
  await expect(page.getByTestId('choice-error')).toBeHidden();
  await publishRound(page, '先缓一缓，选一个动作？', ['深呼吸', '抱安抚巾']);
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await page.locator('[data-choice-option]').nth(0).click();
  await expect(page.getByTestId('choice-result')).toContainText('深呼吸');

  // 回到故事页仍是故事的损坏提示，两侧状态各自独立
  await page.goto('/');
  await expect(page.getByTestId('snapshot-error')).toBeVisible();
});

test('发布写入失败：保留表单内容并在表单附近说明未保存，恢复后可重试', async ({ page }) => {
  await page.goto('/#choice');
  await page.getByTestId('choice-prompt-input').fill('先做哪件事？');
  const inputs = page.locator('[data-choice-option-input]');
  await inputs.nth(0).fill('看鱼缸');
  await inputs.nth(1).fill('坐一会儿');

  await simulateStorageFailure(page);
  await page.getByTestId('choice-publish').click();

  // 表单内容原样保留、轮次没有发布，并就近说明未保存
  await expect(page.getByTestId('choice-prompt-input')).toHaveValue('先做哪件事？');
  await expect(page.locator('[data-choice-option-input]').nth(0)).toHaveValue('看鱼缸');
  await expect(page.getByTestId('choice-publish-error')).toBeVisible();
  await expect(page.getByTestId('choice-empty')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), CHOICE_KEY)).toBeNull();

  // 存储恢复后直接重试：发布成功，错误消除
  await restoreStorage(page);
  await page.getByTestId('choice-publish').click();
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await expect(page.getByTestId('choice-publish-error')).toBeHidden();
});

test('选择写入失败：停在待选择并在选项附近说明，恢复后重试即锁定，刷新仍锁定', async ({ page }) => {
  await publishRound(page, '接下来怎么办？', ['戴上耳机', '去安静角']);
  const firstOption = page.locator('[data-choice-option]').nth(0);
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');

  await simulateStorageFailure(page);
  await firstOption.click();

  // 未锁定：状态仍是待选择、按钮仍可点，并在选项附近说明未保存
  await expect(page.getByTestId('choice-status')).toHaveText('待选择 · 请点选一项');
  await expect(page.getByTestId('choice-select-error')).toBeVisible();
  await expect(firstOption).toBeEnabled();
  let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHOICE_KEY);
  expect(saved.rounds[0].status).toBe('pending');
  expect(saved.rounds[0].chosenOptionId).toBeNull();

  // 恢复存储后重试同一项：锁定成功
  await restoreStorage(page);
  await firstOption.click();
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('戴上耳机');
  await expect(page.getByTestId('choice-select-error')).toBeHidden();

  // 刷新后锁定结果依旧
  await page.reload();
  await expect(page.getByTestId('choice-status')).toHaveText('已选定 · 本轮已锁定');
  await expect(page.getByTestId('choice-result')).toContainText('戴上耳机');
  saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHOICE_KEY);
  expect(saved.rounds[0].status).toBe('chosen');
});

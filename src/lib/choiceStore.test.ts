import { describe, expect, it } from 'vitest';
import { createChoiceStore } from './choiceStore';
import {
  CHOICE_STORAGE_KEY,
  type StorageLike,
} from './choiceStorage';
import { STORAGE_KEY, createMemoryStorage } from './snapshot';

function readRaw(storage: StorageLike) {
  const raw = storage.getItem(CHOICE_STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as { schemaVersion: number; rounds: unknown[] };
}

const validInput = () => ({
  prompt: '现在临时改道，我们先做什么？',
  options: ['先去洗手间', '在休息区坐一会儿', '直接去展厅'],
});

describe('choiceStore：发布服务只接受完整内容，先落盘再更新画面', () => {
  it('完整内容发布成功：追加为一轮并写入独立存储键', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    const result = store.publish(validInput());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);

    expect(store.state.rounds).toHaveLength(1);
    const round = store.currentRound()!;
    expect(round.prompt).toBe('现在临时改道，我们先做什么？');
    expect(round.status).toBe('pending');
    expect(round.options).toHaveLength(3);

    const saved = readRaw(storage);
    expect(saved.schemaVersion).toBe(1);
    expect(saved.rounds).toHaveLength(1);
  });

  it('内容不完整时拒绝发布：不产生轮次、不写入、返回逐条问题', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);

    const result = store.publish({ prompt: '', options: ['甲', ''] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.scope === 'prompt')).toBe(true);
    expect(result.issues.some((i) => i.scope === 'option' && i.index === 1)).toBe(true);
    expect(store.state.rounds).toHaveLength(0);
    expect(storage.getItem(CHOICE_STORAGE_KEY)).toBeNull();
  });

  it('重复选项拒绝发布', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    const result = store.publish({ prompt: '提示', options: ['甲', ' 甲 '] });
    expect(result.ok).toBe(false);
    expect(store.state.rounds).toHaveLength(0);
  });

  it('照护者修改内容再次发布：追加为新的独立轮次，旧轮次保留', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());
    const first = store.currentRound()!;
    expect(store.select(first.options[0].id)).toBe(true);

    const second = store.publish({
      prompt: '做完这件，然后呢？',
      options: ['回酒店休息', '继续参观'],
    });
    expect(second.ok).toBe(true);
    expect(store.state.rounds).toHaveLength(2);
    // 旧轮次及其锁定结果完整保留
    expect(store.state.rounds[0].id).toBe(first.id);
    expect(store.state.rounds[0].status).toBe('chosen');
    // 当前轮是新发布的待选择轮次
    expect(store.currentRound()!.status).toBe('pending');
    expect(store.currentRound()!.id).not.toBe(first.id);
    expect(readRaw(storage).rounds).toHaveLength(2);
  });
});

describe('choiceStore：选择服务只接受当前待选择轮次中的选项', () => {
  it('孩子点选后本轮锁定结果并落盘；再次选择被拒绝', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());
    const round = store.currentRound()!;
    const picked = round.options[2];

    expect(store.select(picked.id)).toBe(true);
    const locked = store.currentRound()!;
    expect(locked.status).toBe('chosen');
    expect(locked.chosenOptionId).toBe(picked.id);
    expect(readRaw(storage).rounds[0]).toMatchObject({
      status: 'chosen',
      chosenOptionId: picked.id,
    });

    // 锁定后不能改选
    expect(store.select(round.options[0].id)).toBe(false);
    expect(store.currentRound()!.chosenOptionId).toBe(picked.id);
  });

  it('拒绝不属于当前轮的选项 id（含其他轮次的选项）', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());
    const firstRoundOption = store.currentRound()!.options[0].id;
    store.select(firstRoundOption);
    store.publish({ prompt: '第二轮', options: ['新甲', '新乙'] });

    const current = store.currentRound()!;
    // 用旧轮次的选项 id 选择当前轮：拒绝
    expect(store.select(firstRoundOption)).toBe(false);
    expect(current.status).toBe('pending');
    // 完全陌生的 id：拒绝
    expect(store.select('not-an-option')).toBe(false);
  });

  it('没有任何轮次时选择无效', () => {
    const store = createChoiceStore(createMemoryStorage());
    expect(store.select('whatever')).toBe(false);
  });
});

describe('choiceStore：独立恢复（刷新恢复最后一轮及锁定结果）', () => {
  it('刷新后新实例恢复全部轮次，最后一轮为已锁定轮次并带结果', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());
    const first = store.currentRound()!;
    store.select(first.options[1].id);
    store.publish({ prompt: '第二轮提示', options: ['选项A', '选项B', '选项C'] });
    const second = store.currentRound()!;
    store.select(second.options[0].id);

    // 模拟刷新：从同一存储重建
    const revived = createChoiceStore(storage);
    expect(revived.state.corrupt).toBe(false);
    expect(revived.state.rounds).toHaveLength(2);
    const current = revived.currentRound()!;
    expect(current.id).toBe(second.id);
    expect(current.status).toBe('chosen');
    expect(current.chosenOptionId).toBe(second.options[0].id);
    expect(current.prompt).toBe('第二轮提示');
    // 旧轮次的锁定结果同样恢复
    expect(revived.state.rounds[0].id).toBe(first.id);
    expect(revived.state.rounds[0].chosenOptionId).toBe(first.options[1].id);
  });

  it('刷新停在待选择轮次时，恢复后仍可完成一次选择', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());

    const revived = createChoiceStore(storage);
    expect(revived.currentRound()!.status).toBe('pending');
    const optionId = revived.currentRound()!.options[0].id;
    expect(revived.select(optionId)).toBe(true);
    expect(revived.currentRound()!.status).toBe('chosen');
  });
});

describe('choiceStore：与故事快照相互独立', () => {
  it('选择板数据损坏只阻断选择板入口，故事快照仍可正常载入', () => {
    const storage = createMemoryStorage();
    // 先写入一份合法的故事快照
    const storySnapshot = {
      schemaVersion: 1,
      draft: { pages: [] },
      session: null,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(storySnapshot));
    // 选择板数据损坏
    storage.setItem(CHOICE_STORAGE_KEY, '{broken json');

    const choiceStore = createChoiceStore(storage);
    expect(choiceStore.state.corrupt).toBe(true);
    // 损坏期间拒绝发布/选择，不覆盖坏数据
    expect(choiceStore.publish(validInput()).ok).toBe(false);
    expect(choiceStore.select('x')).toBe(false);

    // 故事快照原样保留、可正常读取
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(storySnapshot));
  });

  it('选择板的读写只使用自己的键，不触碰故事快照', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ marker: 'story' }));
    const store = createChoiceStore(storage);
    store.publish(validInput());
    store.select(store.currentRound()!.options[0].id);
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ marker: 'story' }));
  });

  it('清除损坏的选择板数据后可重建，故事快照不受影响', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ marker: 'story' }));
    storage.setItem(CHOICE_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, rounds: [] }));

    const store = createChoiceStore(storage);
    expect(store.state.corrupt).toBe(true);
    store.discardCorruptData();
    expect(store.state.corrupt).toBe(false);
    expect(storage.getItem(CHOICE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ marker: 'story' }));

    expect(store.publish(validInput()).ok).toBe(true);
    expect(store.state.rounds).toHaveLength(1);
  });
});

describe('choiceStore：结构非法的已存数据判定损坏', () => {
  it('非 JSON 或版本不符：判损坏', () => {
    const storage1 = createMemoryStorage();
    storage1.setItem(CHOICE_STORAGE_KEY, '{broken json');
    expect(createChoiceStore(storage1).state.corrupt).toBe(true);

    const storage2 = createMemoryStorage();
    storage2.setItem(CHOICE_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, rounds: [] }));
    expect(createChoiceStore(storage2).state.corrupt).toBe(true);
  });

  it('chosen 但结果 id 不属于本轮：判损坏', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());
    const raw = JSON.parse(storage.getItem(CHOICE_STORAGE_KEY)!);
    raw.rounds[0].status = 'chosen';
    raw.rounds[0].chosenOptionId = 'missing-option';
    storage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(raw));

    const revived = createChoiceStore(storage);
    expect(revived.state.corrupt).toBe(true);
  });

  it('重复选项、选项数量越界、坏时间：判损坏', () => {
    const storage = createMemoryStorage();
    const store = createChoiceStore(storage);
    store.publish(validInput());

    const brokenVariants: Array<(raw: { rounds: Array<Record<string, unknown>> }) => void> = [
      (raw) => {
        (raw.rounds[0].options as Array<{ label: string }>)[1].label = '先去洗手间';
      },
      (raw) => {
        raw.rounds[0].options = [{ id: 'a', label: '仅一项' }];
      },
      (raw) => {
        raw.rounds[0].createdAt = 'not-a-date';
      },
      (raw) => {
        raw.rounds[0].status = 'chosen';
        raw.rounds[0].chosenOptionId = null;
      },
    ];

    for (const breakIt of brokenVariants) {
      const raw = JSON.parse(storage.getItem(CHOICE_STORAGE_KEY)!);
      breakIt(raw);
      storage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(raw));
      expect(createChoiceStore(storage).state.corrupt).toBe(true);
    }
  });
});

describe('choiceStore：写入失败保留操作前内容并提示', () => {
  function flakyStorage(failWrites: { value: boolean }) {
    const memory = createMemoryStorage();
    const flaky: StorageLike = {
      getItem: (key) => memory.getItem(key),
      setItem: (key, value) => {
        if (failWrites.value) throw new Error('QuotaExceededError');
        memory.setItem(key, value);
      },
      removeItem: (key) => memory.removeItem(key),
    };
    return { flaky, memory };
  }

  it('发布写入失败：现有轮次保持不变、返回失败并给出错误反馈', () => {
    const failWrites = { value: false };
    const { flaky, memory } = flakyStorage(failWrites);
    const store = createChoiceStore(flaky);
    store.publish(validInput());
    const beforeRaw = memory.getItem(CHOICE_STORAGE_KEY);

    failWrites.value = true;
    const result = store.publish({ prompt: '新一轮', options: ['甲', '乙'] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([]); // 表单完整，纯粹是写入失败
    expect(store.state.rounds).toHaveLength(1); // 操作前内容保留
    expect(store.currentRound()!.prompt).toBe('现在临时改道，我们先做什么？');
    expect(store.state.saveError).toBeTruthy();
    expect(memory.getItem(CHOICE_STORAGE_KEY)).toBe(beforeRaw); // 存储未被改动

    // 存储恢复后可正常发布下一轮
    failWrites.value = false;
    expect(store.publish({ prompt: '新一轮', options: ['甲', '乙'] }).ok).toBe(true);
    expect(store.state.rounds).toHaveLength(2);
    expect(store.state.saveError).toBeNull();
  });

  it('选择写入失败：轮次仍保持待选择，可重试成功', () => {
    const failWrites = { value: false };
    const { flaky } = flakyStorage(failWrites);
    const store = createChoiceStore(flaky);
    store.publish(validInput());
    const optionId = store.currentRound()!.options[0].id;

    failWrites.value = true;
    expect(store.select(optionId)).toBe(false);
    expect(store.currentRound()!.status).toBe('pending'); // 未锁定
    expect(store.currentRound()!.chosenOptionId).toBeNull();
    expect(store.state.saveError).toBeTruthy();

    failWrites.value = false;
    expect(store.select(optionId)).toBe(true);
    expect(store.currentRound()!.status).toBe('chosen');
  });
});

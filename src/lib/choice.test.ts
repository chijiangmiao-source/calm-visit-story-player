import { describe, expect, it } from 'vitest';
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  canPublishChoice,
  chosenOptionOf,
  createChoiceRound,
  createChoiceOption,
  lockChoice,
  validateChoiceDraft,
} from './choice';

const validInput = () => ({
  prompt: '现在临时改道，我们先做什么？',
  options: ['先去洗手间', '在休息区坐一会儿', '直接去展厅'],
});

describe('validateChoiceDraft：发布服务只接受完整内容', () => {
  it('接受一句非空提示与 2-4 个非空且不重复的选项', () => {
    expect(validateChoiceDraft(validInput())).toEqual([]);
    expect(canPublishChoice(validInput())).toBe(true);
    expect(canPublishChoice({ prompt: '提示', options: ['甲', '乙'] })).toBe(true);
    expect(
      canPublishChoice({ prompt: '提示', options: ['甲', '乙', '丙', '丁'] }),
    ).toBe(true);
  });

  it('拒绝空提示（含纯空白）', () => {
    for (const prompt of ['', '   ']) {
      const issues = validateChoiceDraft({ prompt, options: ['甲', '乙'] });
      expect(issues.some((i) => i.scope === 'prompt')).toBe(true);
      expect(canPublishChoice({ prompt, options: ['甲', '乙'] })).toBe(false);
    }
  });

  it('选项数量必须在 2-4 个之间', () => {
    expect(validateChoiceDraft({ prompt: '提示', options: ['只有一个'] })[0]).toMatchObject({
      scope: 'form',
    });
    expect(
      validateChoiceDraft({ prompt: '提示', options: ['甲', '乙', '丙', '丁', '戊'] }),
    ).toContainEqual(expect.objectContaining({ scope: 'form' }));
    expect(MIN_OPTIONS).toBe(2);
    expect(MAX_OPTIONS).toBe(4);
  });

  it('拒绝空选项（含纯空白）并指向下标', () => {
    const issues = validateChoiceDraft({ prompt: '提示', options: ['甲', '', '  '] });
    expect(issues).toContainEqual(expect.objectContaining({ scope: 'option', index: 1 }));
    expect(issues).toContainEqual(expect.objectContaining({ scope: 'option', index: 2 }));
  });

  it('拒绝重复选项：去空白后比较，只标注重复出现的那一项', () => {
    const issues = validateChoiceDraft({
      prompt: '提示',
      options: ['喝水', ' 喝水 ', '休息'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ scope: 'option', index: 1 });
  });
});

describe('createChoiceRound：轮次构造', () => {
  it('内容完整时构造待选择轮次：独立标识、提示、选项、创建时间与空结果', () => {
    const round = createChoiceRound(validInput(), {
      id: 'round-1',
      createdAt: '2026-09-14T09:00:00.000Z',
    });
    expect(round).not.toBeNull();
    expect(round!.id).toBe('round-1');
    expect(round!.prompt).toBe('现在临时改道，我们先做什么？');
    expect(round!.options).toHaveLength(3);
    expect(round!.options.map((o) => o.label)).toEqual(['先去洗手间', '在休息区坐一会儿', '直接去展厅']);
    // 每个选项拥有轮次内唯一标识
    expect(new Set(round!.options.map((o) => o.id)).size).toBe(3);
    expect(round!.createdAt).toBe('2026-09-14T09:00:00.000Z');
    expect(round!.status).toBe('pending');
    expect(round!.chosenOptionId).toBeNull();
  });

  it('提示与选项文案按去空白后的文本保存', () => {
    const round = createChoiceRound({ prompt: '  选一个  ', options: [' 甲 ', '乙  '] });
    expect(round!.prompt).toBe('选一个');
    expect(round!.options.map((o) => o.label)).toEqual(['甲', '乙']);
  });

  it('不注入标识与时间时自动生成（独立 id、合法 ISO 时间）', () => {
    const a = createChoiceRound(validInput());
    const b = createChoiceRound(validInput());
    expect(a!.id).toBeTruthy();
    expect(a!.id).not.toBe(b!.id);
    expect(Number.isNaN(new Date(a!.createdAt).getTime())).toBe(false);
  });

  it('内容不完整时拒绝构造，绝不产生半成品轮次', () => {
    expect(createChoiceRound({ prompt: '', options: ['甲', '乙'] })).toBeNull();
    expect(createChoiceRound({ prompt: '提示', options: ['甲'] })).toBeNull();
    expect(createChoiceRound({ prompt: '提示', options: ['甲', '甲'] })).toBeNull();
  });

  it('可注入选项工厂，便于测试与特殊场景', () => {
    let seq = 0;
    const round = createChoiceRound(
      { prompt: '提示', options: ['甲', '乙'] },
      { createOption: () => ({ id: `opt-${(seq += 1)}`, label: '' }) },
    );
    expect(round!.options.map((o) => o.id)).toEqual(['opt-1', 'opt-2']);
  });

  it('createChoiceOption 返回带独立标识的空选项', () => {
    const option = createChoiceOption();
    expect(option.id).toBeTruthy();
    expect(option.label).toBe('');
  });
});

describe('lockChoice：单次选择，选择后锁定', () => {
  const round = createChoiceRound(validInput(), { id: 'round-1' })!;

  it('只接受本轮选项中的一个：锁定并记录结果，返回不可变新对象', () => {
    const target = round.options[1];
    const locked = lockChoice(round, target.id);
    expect(locked).not.toBeNull();
    expect(locked).not.toBe(round);
    expect(locked!.status).toBe('chosen');
    expect(locked!.chosenOptionId).toBe(target.id);
    expect(chosenOptionOf(locked!)?.label).toBe(target.label);
    // 原轮次保持待选择（不可变更新）
    expect(round.status).toBe('pending');
    expect(round.chosenOptionId).toBeNull();
  });

  it('拒绝不属于本轮的选项 id', () => {
    expect(lockChoice(round, 'not-in-round')).toBeNull();
  });

  it('已锁定的轮次不能再次选择（结果不可更改）', () => {
    const locked = lockChoice(round, round.options[0].id)!;
    expect(lockChoice(locked, round.options[1].id)).toBeNull();
    expect(locked.chosenOptionId).toBe(round.options[0].id);
    // 原结果仍可取回
    expect(chosenOptionOf(locked)?.id).toBe(round.options[0].id);
  });

  it('待选择轮次没有选定结果', () => {
    expect(chosenOptionOf(round)).toBeNull();
  });
});

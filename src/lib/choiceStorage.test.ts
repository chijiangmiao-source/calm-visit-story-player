import { describe, expect, it } from 'vitest';
import {
  CHOICE_STORAGE_KEY,
  clearChoiceBoard,
  loadChoiceBoard,
  saveChoiceBoard,
  serializeChoiceBoardData,
  validateChoiceBoardData,
  type ChoiceBoardData,
} from './choiceStorage';
import { createMemoryStorage } from './snapshot';
import { createChoiceRound, lockChoice } from './choice';

function round(overrides: Record<string, unknown> = {}) {
  return {
    ...createChoiceRound({
      prompt: '临时改道，先做什么？',
      options: ['去洗手间', '休息区坐一会儿', '直接进展厅'],
    }, { id: 'round-1', createdAt: '2026-09-14T09:00:00.000Z' })!,
    ...overrides,
  };
}

function validData(): ChoiceBoardData {
  return { schemaVersion: 1, rounds: [round()] };
}

describe('validateChoiceBoardData：整体校验规则', () => {
  it('接受空轮次列表与结构完整的数据', () => {
    expect(validateChoiceBoardData({ schemaVersion: 1, rounds: [] })).toEqual({
      schemaVersion: 1,
      rounds: [],
    });
    const data = validData();
    expect(validateChoiceBoardData(data)).toEqual(data);
  });

  it('接受已锁定且结果属于本轮的轮次', () => {
    const pending = round();
    const locked = lockChoice(pending, pending.options[1].id)!;
    const data = { schemaVersion: 1 as const, rounds: [locked] };
    expect(validateChoiceBoardData(data)).toEqual(data);
  });

  it('拒绝版本不符、非对象或缺少 rounds', () => {
    expect(validateChoiceBoardData({ schemaVersion: 2, rounds: [] })).toBeNull();
    expect(validateChoiceBoardData({ rounds: [] })).toBeNull();
    for (const bad of [null, undefined, 42, 'x', [], true]) {
      expect(validateChoiceBoardData(bad)).toBeNull();
    }
  });

  it('拒绝轮次 id / 提示 / 创建时间缺失或非法', () => {
    for (const patch of [
      { id: '' },
      { prompt: '   ' },
      { prompt: 42 },
      { createdAt: '' },
      { createdAt: 'not-a-date' },
      { status: 'paused' },
    ]) {
      expect(validateChoiceBoardData({ schemaVersion: 1, rounds: [round(patch)] })).toBeNull();
    }
  });

  it('拒绝选项数量越界、空文案或重复文案', () => {
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [round({ options: [{ id: 'a', label: '唯一' }] })],
      }),
    ).toBeNull();
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [
          round({
            options: [
              { id: 'a', label: '甲' },
              { id: 'b', label: ' 甲 ' },
            ],
          }),
        ],
      }),
    ).toBeNull();
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [
          round({
            options: [
              { id: 'a', label: '甲' },
              { id: 'a', label: '乙' },
            ],
          }),
        ],
      }),
    ).toBeNull();
  });

  it('拒绝阶段与结果矛盾：pending 带结果、chosen 缺结果或结果不属于本轮', () => {
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [round({ status: 'pending', chosenOptionId: 'x' })],
      }),
    ).toBeNull();
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [round({ status: 'chosen', chosenOptionId: null })],
      }),
    ).toBeNull();
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [round({ status: 'chosen', chosenOptionId: 'missing' })],
      }),
    ).toBeNull();
  });

  it('任一轮损坏或轮次 id 重复都整体拒绝', () => {
    const good = round({ id: 'round-1' });
    const bad = round({ id: 'round-2', prompt: '' });
    expect(validateChoiceBoardData({ schemaVersion: 1, rounds: [good, bad] })).toBeNull();
    expect(
      validateChoiceBoardData({
        schemaVersion: 1,
        rounds: [round({ id: 'same' }), round({ id: 'same' })],
      }),
    ).toBeNull();
  });
});

describe('localStorage 读写（选择板独立键）', () => {
  it('写入后可完整读回（往返一致）', () => {
    const storage = createMemoryStorage();
    const data = validData();
    saveChoiceBoard(storage, data);
    expect(loadChoiceBoard(storage)).toEqual({ kind: 'ok', data });
    expect(storage.getItem(CHOICE_STORAGE_KEY)).toBe(serializeChoiceBoardData(data));
  });

  it('没有数据时返回 empty', () => {
    expect(loadChoiceBoard(createMemoryStorage())).toEqual({ kind: 'empty' });
  });

  it('非 JSON 与结构非法内容判定为损坏', () => {
    const storage = createMemoryStorage();
    storage.setItem(CHOICE_STORAGE_KEY, '{oops');
    expect(loadChoiceBoard(storage)).toEqual({ kind: 'corrupt' });

    storage.setItem(CHOICE_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, rounds: [] }));
    expect(loadChoiceBoard(storage)).toEqual({ kind: 'corrupt' });
  });

  it('清除后回到 empty', () => {
    const storage = createMemoryStorage();
    saveChoiceBoard(storage, validData());
    clearChoiceBoard(storage);
    expect(loadChoiceBoard(storage)).toEqual({ kind: 'empty' });
  });
});

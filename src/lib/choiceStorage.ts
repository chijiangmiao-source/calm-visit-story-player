import { MAX_OPTIONS, MIN_OPTIONS, type ChoiceRound } from './choice';

/**
 * 现场选择板数据与故事快照完全分离：
 * 独立的 localStorage 键、独立的校验与损坏态。
 * 选择板数据损坏只阻断选择板入口，故事草稿与演示快照照常载入。
 */
export const CHOICE_STORAGE_KEY = 'choice-board:rounds';

export interface ChoiceBoardData {
  schemaVersion: 1;
  /** 历轮选择，按创建时间排序，最后一轮为当前轮 */
  rounds: ChoiceRound[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ChoiceLoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; data: ChoiceBoardData }
  | { kind: 'corrupt' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 解析单个选项：id 与文案都必须是非空字符串 */
function parseOption(value: unknown): { id: string; label: string } | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.id)) return undefined;
  if (typeof value.label !== 'string' || value.label.trim().length === 0) return undefined;
  return { id: value.id, label: value.label };
}

/**
 * 解析一轮选择：
 * 独立标识、提示、2-4 个选项（id 不重复、文案去空白后不重复）、
 * 创建时间、阶段与结果必须自洽（chosen 必须带属于本轮的结果 id）。
 * 任一字段不符即视为损坏，绝不部分套用。
 */
function parseRound(value: unknown): ChoiceRound | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.id)) return undefined;
  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) return undefined;
  if (!Array.isArray(value.options)) return undefined;
  if (value.options.length < MIN_OPTIONS || value.options.length > MAX_OPTIONS) return undefined;

  const options: { id: string; label: string }[] = [];
  const optionIds = new Set<string>();
  const labels = new Set<string>();
  for (const item of value.options) {
    const option = parseOption(item);
    if (!option) return undefined;
    if (optionIds.has(option.id)) return undefined;
    const normalized = option.label.trim();
    if (labels.has(normalized)) return undefined;
    optionIds.add(option.id);
    labels.add(normalized);
    options.push({ id: option.id, label: option.label });
  }

  if (!isNonEmptyString(value.createdAt)) return undefined;
  if (Number.isNaN(new Date(value.createdAt).getTime())) return undefined;
  if (value.status !== 'pending' && value.status !== 'chosen') return undefined;

  if (value.status === 'pending') {
    if (value.chosenOptionId !== null) return undefined;
    return {
      id: value.id,
      prompt: value.prompt,
      options,
      createdAt: value.createdAt,
      status: 'pending',
      chosenOptionId: null,
    };
  }

  // chosen：结果 id 必须存在且属于本轮选项
  if (!isNonEmptyString(value.chosenOptionId)) return undefined;
  if (!options.some((option) => option.id === value.chosenOptionId)) return undefined;
  return {
    id: value.id,
    prompt: value.prompt,
    options,
    createdAt: value.createdAt,
    status: 'chosen',
    chosenOptionId: value.chosenOptionId as string,
  };
}

/**
 * 整体校验选择板数据：版本正确、轮次结构完整才接受；
 * 任何一轮损坏都整体拒绝（只阻断选择板，不影响故事数据）。
 */
export function validateChoiceBoardData(data: unknown): ChoiceBoardData | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 1) return null;
  if (!Array.isArray(data.rounds)) return null;
  const rounds: ChoiceRound[] = [];
  const roundIds = new Set<string>();
  for (const item of data.rounds) {
    const round = parseRound(item);
    if (!round) return null;
    if (roundIds.has(round.id)) return null;
    roundIds.add(round.id);
    rounds.push(round);
  }
  return { schemaVersion: 1, rounds };
}

export function serializeChoiceBoardData(data: ChoiceBoardData): string {
  return JSON.stringify(data);
}

export function loadChoiceBoard(storage: StorageLike): ChoiceLoadResult {
  const raw = storage.getItem(CHOICE_STORAGE_KEY);
  if (raw === null) return { kind: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  const parsed = validateChoiceBoardData(data);
  return parsed ? { kind: 'ok', data: parsed } : { kind: 'corrupt' };
}

/** 同步写入；失败（如配额不足）会抛错，由调用方保留操作前内容并提示 */
export function saveChoiceBoard(storage: StorageLike, data: ChoiceBoardData): void {
  storage.setItem(CHOICE_STORAGE_KEY, serializeChoiceBoardData(data));
}

export function clearChoiceBoard(storage: StorageLike): void {
  storage.removeItem(CHOICE_STORAGE_KEY);
}

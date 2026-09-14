/**
 * 现场选择板领域模型：
 * 与“逐页故事”完全独立——展厅临时改道或孩子情绪紧张时，
 * 照护者临时发布一轮选择，孩子点选其中一项后本轮锁定。
 */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** 一轮选择所处阶段：待选择，或孩子已选定某一项后锁定 */
export type ChoiceRoundStatus = 'pending' | 'chosen';

export interface ChoiceOption {
  /** 轮次内唯一标识 */
  id: string;
  /** 选项内容，发布时非空 */
  label: string;
}

/** 一轮选择：独立标识、提示、选项、创建时间、阶段及选定结果 */
export interface ChoiceRound {
  id: string;
  prompt: string;
  options: ChoiceOption[];
  createdAt: string;
  status: ChoiceRoundStatus;
  /** 选定选项的 id；status 为 chosen 时必填 */
  chosenOptionId: string | null;
}

/** 照护者发布一轮时填写的内容：一句提示 + 2-4 个不重复的选项 */
export interface ChoiceDraftInput {
  prompt: string;
  options: string[];
}

/** 创建一个空选项行 */
export function createChoiceOption(): ChoiceOption {
  return { id: crypto.randomUUID(), label: '' };
}

/** 发布前的表单校验问题；key 为 null 表示整表问题（如选项数不足） */
export type ChoiceFormIssue =
  | { scope: 'prompt'; message: string }
  | { scope: 'option'; index: number; message: string }
  | { scope: 'form'; message: string };

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * 发布服务只接受完整内容：
 * - 提示非空；
 * - 选项数量在 2-4 个之间；
 * - 每个选项非空，且去空白后互不重复。
 * 返回全部问题（用于表单逐条标注）；没有问题时可构造轮次。
 */
export function validateChoiceDraft(input: ChoiceDraftInput): ChoiceFormIssue[] {
  const issues: ChoiceFormIssue[] = [];
  if (isBlank(input.prompt)) {
    issues.push({ scope: 'prompt', message: '请填写一句给孩子的提示。' });
  }

  const count = input.options.length;
  if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
    issues.push({
      scope: 'form',
      message: `一轮选择需要 ${MIN_OPTIONS}-${MAX_OPTIONS} 个选项，当前为 ${count} 个。`,
    });
    return issues; // 数量不合法时不再逐条标注
  }

  const seen = new Map<string, number>(); // 规范化文本 -> 第一次出现的下标
  input.options.forEach((label, index) => {
    if (isBlank(label)) {
      issues.push({ scope: 'option', index, message: '选项内容不能为空。' });
      return;
    }
    const normalized = label.trim();
    const firstIndex = seen.get(normalized);
    if (firstIndex === undefined) {
      seen.set(normalized, index);
    } else {
      issues.push({ scope: 'option', index, message: '选项不能重复，请换一个内容。' });
    }
  });
  return issues;
}

export function canPublishChoice(input: ChoiceDraftInput): boolean {
  return validateChoiceDraft(input).length === 0;
}

export interface CreateRoundOptions {
  id?: string;
  createdAt?: string;
  createOption?: () => ChoiceOption;
}

/**
 * 轮次构造：发布服务的唯一入口。
 * 只接受通过完整校验的内容，否则返回 null，绝不产生半成品轮次。
 * 选项文案按去空白后的文本保存。
 */
export function createChoiceRound(
  input: ChoiceDraftInput,
  options: CreateRoundOptions = {},
): ChoiceRound | null {
  if (!canPublishChoice(input)) return null;
  const createOption = options.createOption ?? createChoiceOption;
  return {
    id: options.id ?? crypto.randomUUID(),
    prompt: input.prompt.trim(),
    options: input.options.map((label) => ({ ...createOption(), label: label.trim() })),
    createdAt: options.createdAt ?? new Date().toISOString(),
    status: 'pending',
    chosenOptionId: null,
  };
}

/**
 * 选择服务只接受当前待选择轮次中的选项：
 * 轮次必须仍处 pending，且 optionId 属于本轮选项。
 * 返回锁定后的新轮次（不可变更新）；不满足时返回 null。
 */
export function lockChoice(round: ChoiceRound, optionId: string): ChoiceRound | null {
  if (round.status !== 'pending') return null;
  if (!round.options.some((option) => option.id === optionId)) return null;
  return { ...round, status: 'chosen', chosenOptionId: optionId };
}

/** 取已锁定轮次的选定结果选项；未选定或结果失效时返回 null */
export function chosenOptionOf(round: ChoiceRound): ChoiceOption | null {
  if (round.status !== 'chosen' || round.chosenOptionId === null) return null;
  return round.options.find((option) => option.id === round.chosenOptionId) ?? null;
}

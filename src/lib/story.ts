export const MIN_PAGES = 2;
export const MAX_PAGES = 12;

export interface ThemeColor {
  id: string;
  label: string;
  background: string;
  accent: string;
  text: string;
}

/** 六个内置主题色，页面只能选择其中之一 */
export const THEME_COLORS: readonly ThemeColor[] = [
  { id: 'sky', label: '天空蓝', background: '#E3F2FD', accent: '#1565C0', text: '#0D3C61' },
  { id: 'mint', label: '薄荷绿', background: '#E8F5E9', accent: '#2E7D32', text: '#1B3A1E' },
  { id: 'sunny', label: '暖阳黄', background: '#FFF8E1', accent: '#F9A825', text: '#4D3800' },
  { id: 'coral', label: '珊瑚橙', background: '#FBE9E7', accent: '#D84315', text: '#4A1A0A' },
  { id: 'lavender', label: '薰衣草紫', background: '#F3E5F5', accent: '#6A1B9A', text: '#31123F' },
  { id: 'rose', label: '玫瑰粉', background: '#FCE4EC', accent: '#AD1457', text: '#43081F' },
] as const;

export function isThemeColorId(value: unknown): value is string {
  return typeof value === 'string' && THEME_COLORS.some((c) => c.id === value);
}

export function themeColorById(id: string): ThemeColor {
  return THEME_COLORS.find((c) => c.id === id) ?? THEME_COLORS[0];
}

export interface StoryPage {
  id: string;
  title: string;
  description: string;
  color: string;
}

export function createPage(): StoryPage {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    color: THEME_COLORS[0].id,
  };
}

/** 单页可演示的最低要求：标题与说明均非空，主题色合法 */
export function isPageReady(page: StoryPage): boolean {
  return (
    page.title.trim().length > 0 &&
    page.description.trim().length > 0 &&
    isThemeColorId(page.color)
  );
}

/** 只有 2-12 页且每页都就绪时才允许启动演示 */
export function canStartPresentation(pages: StoryPage[]): boolean {
  return (
    pages.length >= MIN_PAGES &&
    pages.length <= MAX_PAGES &&
    pages.every(isPageReady)
  );
}

export type MoveDirection = 'up' | 'down';

/**
 * 按页面标识与移动方向计算新的不可变数组（与相邻页交换）。
 * 页面不存在或目标位置超出边界时返回 null，调用方不得提交。
 * 不修改、也不返回原数组。
 */
export function movePage(
  pages: readonly StoryPage[],
  id: string,
  direction: MoveDirection,
): StoryPage[] | null {
  const index = pages.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= pages.length) return null;
  const next = [...pages];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

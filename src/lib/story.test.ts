import { describe, expect, it } from 'vitest';
import { movePage, type StoryPage } from './story';

function page(id: string): StoryPage {
  return { id, title: `标题${id}`, description: `说明${id}`, color: 'sky' };
}

function pages(ids: string[]): StoryPage[] {
  return ids.map(page);
}

describe('movePage：以页面标识与方向计算新的不可变数组', () => {
  it('上移：与前一页交换位置', () => {
    const source = pages(['a', 'b', 'c']);
    expect(movePage(source, 'c', 'up')?.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(movePage(source, 'b', 'up')?.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('下移：与后一页交换位置', () => {
    const source = pages(['a', 'b', 'c']);
    expect(movePage(source, 'a', 'down')?.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(movePage(source, 'b', 'down')?.map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('返回全新数组：原数组的内容与引用都不被改写', () => {
    const source = pages(['a', 'b', 'c']);
    const snapshot = JSON.parse(JSON.stringify(source));
    const result = movePage(source, 'b', 'up');
    expect(result).not.toBe(source);
    expect(source).toEqual(snapshot);
    expect(source.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // 页面对象本身保持同一引用，仅顺序改变
    expect(result![0]).toBe(source[1]);
  });

  it('边界拒绝：首项上移、末项下移返回 null', () => {
    const source = pages(['a', 'b', 'c']);
    expect(movePage(source, 'a', 'up')).toBeNull();
    expect(movePage(source, 'c', 'down')).toBeNull();
  });

  it('找不到页面标识时返回 null（含空数组）', () => {
    expect(movePage(pages(['a', 'b']), 'x', 'up')).toBeNull();
    expect(movePage([], 'a', 'up')).toBeNull();
    expect(movePage([], 'a', 'down')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { pageRange } from './profiles';

describe('pageRange', () => {
  it('full page (1-based from)', () => {
    expect(pageRange(100, 10, 0)).toEqual({ from: 1, count: 10 });
    expect(pageRange(100, 10, 2)).toEqual({ from: 21, count: 10 });
  });
  it('last partial page', () => {
    expect(pageRange(25, 10, 2)).toEqual({ from: 21, count: 5 });
  });
  it('exact multiple: last page is full', () => {
    expect(pageRange(20, 10, 1)).toEqual({ from: 11, count: 10 });
  });
  it('page past the end clamps to the last page', () => {
    expect(pageRange(25, 10, 9)).toEqual({ from: 21, count: 5 });
    expect(pageRange(25, 10, -3)).toEqual({ from: 1, count: 10 });
  });
  it('empty profile requests nothing', () => {
    expect(pageRange(0, 10, 0)).toEqual({ from: 1, count: 0 });
    expect(pageRange(0, 10, 5)).toEqual({ from: 1, count: 0 });
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderReadings } from './live';
import type { Reading } from '../profiles/templates';

const r = (o: Partial<Reading>): Reading => ({ key: 'k', obis: '1.0.12.7.0.255', raw: 2301, scaler: -1, unit: 'V', value: 230.1, missing: false, ...o });

describe('renderReadings', () => {
  it('shows value+unit, OBIS and raw', () => {
    const el = document.createElement('div');
    renderReadings(el, [r({})]);
    expect(el.textContent).toContain('230.1');
    expect(el.textContent).toContain('V');
    expect(el.textContent).toContain('1.0.12.7.0.255');
    expect(el.textContent).toContain('2301');
  });
  it('marks missing as — and never 0', () => {
    const el = document.createElement('div');
    renderReadings(el, [r({ missing: true, value: null, raw: null, obis: '1.0.31.7.0.255' })]);
    expect(el.textContent).toContain('—');
    expect(el.textContent).toContain('1.0.31.7.0.255');
    expect(el.textContent).not.toMatch(/\b0\b(?!\.)/);
  });
  it('replaces previous content', () => {
    const el = document.createElement('div');
    renderReadings(el, [r({})]);
    renderReadings(el, [r({ value: 1, raw: 1 })]);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import type { Reading } from '../profiles/templates';
import { renderDashboard } from './dashboard';

const r = (key: string, value: number | null, unit: string, missing = false): Reading =>
  ({ key, obis: '', raw: value, scaler: 0, unit, value, missing });

describe('renderDashboard', () => {
  it('shows active power in kW as the hero and a tile per present register', () => {
    const el = document.createElement('div');
    renderDashboard(el, [r('voltage', 229, 'V'), r('current', 8.73, 'A'), r('powerImport', 1965, 'W'), r('powerFactor', 0.98, ''), r('apparentPower', 2005, 'VA')]);
    expect(el.querySelector('.hero .big')?.textContent).toBe('1.97 kW');
    const tiles = [...el.querySelectorAll('.kpi')].map((t) => t.querySelector('.lb')?.textContent);
    expect(tiles).toEqual(['แรงดัน', 'กระแส', 'เพาเวอร์แฟกเตอร์', 'กำลังปรากฏ']);
    expect(el.querySelector('.kpi .val')?.textContent).toBe('229 V');
    expect([...el.querySelectorAll('.kpi .val')][3]?.textContent).toBe('2.00 kVA'); // VA over 1000 -> kVA
  });

  it('shows an em dash for a missing reading and falls back to export power', () => {
    const el = document.createElement('div');
    renderDashboard(el, [r('powerImport', null, 'W', true), r('powerExport', 500, 'W'), r('voltage', null, 'V', true)]);
    expect(el.querySelector('.hero .big')?.textContent).toBe('0.50 kW');
    expect(el.querySelector('.kpi .val')?.textContent).toBe('— V');
  });

  it('renders the three phase-voltage tiles for a type-3 meter', () => {
    const el = document.createElement('div');
    renderDashboard(el, [r('voltageL1', 228, 'V'), r('voltageL2', 230, 'V'), r('voltageL3', 231, 'V')]);
    const labels = [...el.querySelectorAll('.kpi .lb')].map((x) => x.textContent);
    expect(labels).toEqual(['แรงดัน L1', 'แรงดัน L2', 'แรงดัน L3']);
  });
});

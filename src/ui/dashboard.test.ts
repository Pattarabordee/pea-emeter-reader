/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import type { Reading } from '../profiles/templates';
import { renderDashboard } from './dashboard';

const r = (key: string, value: number | null, unit: string, missing = false): Reading =>
  ({ key, obis: '', raw: value, scaler: 0, unit, value, missing });

describe('renderDashboard', () => {
  it('shows a voltage gauge with status, with power and PF in the centre', () => {
    const el = document.createElement('div');
    renderDashboard(el, [r('voltage', 230, 'V'), r('current', 8.73, 'A'), r('powerImport', 2000, 'W'), r('powerFactor', 0.98, ''), r('apparentPower', 2100, 'VA')]);
    expect(el.querySelector('.gauge-center .big')?.textContent).toBe('230 V');
    expect(el.querySelector('.gauge-center .st')?.textContent).toBe('ปกติ');
    const subs = [...el.querySelectorAll('.gauge-center .sub')].map((s) => s.textContent);
    expect(subs).toEqual(['⚡ 2.00 kW', 'cos φ 0.98']);
    expect([...el.querySelectorAll('.kpi .lb')].map((x) => x.textContent)).toEqual(['กระแส', 'กำลังปรากฏ']);
    expect([...el.querySelectorAll('.kpi .val')][1]?.textContent).toBe('2.10 kVA'); // VA over 1000 -> kVA
  });

  it('flags abnormal voltage, and shows an em dash with export-power fallback when voltage is missing', () => {
    const under = document.createElement('div');
    renderDashboard(under, [r('voltage', 190, 'V')]);
    expect(under.querySelector('.gauge-center .st')?.textContent).toBe('ผิดปกติ');

    const el = document.createElement('div');
    renderDashboard(el, [r('voltage', null, 'V', true), r('powerImport', null, 'W', true), r('powerExport', 500, 'W')]);
    expect(el.querySelector('.gauge-center .big')?.textContent).toBe('— V');
    expect(el.querySelector('.gauge-center .st')).toBeNull();
    expect(el.querySelector('.gauge-center .sub')?.textContent).toBe('⚡ 0.50 kW');
  });

  it('renders the three phase-voltage tiles for a type-3 meter', () => {
    const el = document.createElement('div');
    renderDashboard(el, [r('voltage', 230, 'V'), r('voltageL1', 228, 'V'), r('voltageL2', 230, 'V'), r('voltageL3', 231, 'V')]);
    expect([...el.querySelectorAll('.kpi .lb')].map((x) => x.textContent)).toEqual(['แรงดัน L1', 'แรงดัน L2', 'แรงดัน L3']);
  });
});

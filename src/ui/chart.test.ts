import { describe, it, expect } from 'vitest';
import { chartSeries } from './chart';
import type { Reading } from '../profiles/templates';

const clock = (value: number | null): Reading => ({ key: 'clock', obis: '0.0.1.0.0.255', raw: value, scaler: 0, unit: '', value, missing: value === null });

describe('chartSeries labels', () => {
  it('formats the clock in Asia/Bangkok, not UTC', () => {
    const t = Date.UTC(2026, 9, 28, 17, 30); // 00:30 next day in Bangkok
    const { labels } = chartSeries([[clock(t)]], () => true);
    expect(labels[0]).toContain('2026-10-29');
    expect(labels[0]).toContain('00:30');
    expect(labels[0]).toContain('+07:00');
  });
  it('missing clock is not 1970', () => {
    const { labels } = chartSeries([[clock(null)], [clock(NaN)]], () => true);
    expect(labels.join()).not.toContain('1970');
  });
});

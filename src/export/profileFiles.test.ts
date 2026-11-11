import { describe, it, expect } from 'vitest';
import type { ProfileData } from '../profiles/history';
import { profileCsv, sapText } from './profileFiles';

const at = (iso: string) => Date.parse(iso);
const load = (unit = 'kW'): ProfileData => ({
  kind: 'load', obis: '1.0.99.1.0.255', periodSec: 900, entries: 3,
  columns: [{ key: 'voltageL1Avg', obis: '1.0.12.27.0.255', unit: 'V', scaler: -2 }, { key: 'demandImport', obis: '1.0.1.27.0.255', unit, scaler: 0 }],
  rows: [[at('2026-11-08T17:00:00Z'), 229.5, 0.873], [null, 230, 1], [at('2026-11-08T17:15:00Z'), 228.1, 0.912]],
});

describe('sapText', () => {
  it('writes LP General 0525 in Bangkok time, CRLF, 5 decimals, skipping rows without a clock', () => {
    expect(sapText('6600433732', load())).toBe(
      'kw\t\t\r\nPEA_Number \t\t6600433732\r\n20261109\t00:00\t0.87300\r\n20261109\t00:15\t0.91200\r\n');
  });

  it('converts W to kW', () => {
    expect(sapText('1', { ...load('W'), rows: [[at('2026-11-08T17:00:00Z'), 230, 873]] })).toContain('\t0.87300\r\n');
  });

  it('returns null without an import demand column', () => {
    expect(sapText('1', { ...load(), columns: [load().columns[0]] })).toBeNull();
  });
});

describe('profileCsv', () => {
  it('has a header with units and Bangkok times, empty for a missing clock', () => {
    const lines = profileCsv(load()).replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe('เวลา,voltageL1Avg [1.0.12.27.0.255] (V),demandImport [1.0.1.27.0.255] (kW)');
    expect(lines[1]).toBe('2026-11-09 00:00:00,229.5,0.873');
    expect(lines[2]).toBe(',230,1');
  });
});

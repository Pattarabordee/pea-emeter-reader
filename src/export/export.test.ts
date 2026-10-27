import { describe, expect, it } from 'vitest';
import type { Reading } from '../profiles/templates';
import { toCsv, toJson } from './export';

const ok: Reading = { key: 'kwhImport', obis: '1.0.1.8.0.255', raw: 1000, scaler: 0, unit: 'kWh', value: 1000, missing: false };
const gone: Reading = { key: 'voltageL1Min', obis: '1.0.12.27.0.255', raw: null, scaler: -2, unit: 'V', value: null, missing: true };
const tricky: Reading = { key: 'odd', obis: '0.0.1.0.0.255', raw: 7, scaler: 0, unit: 'k,"W"', value: 7, missing: false };

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, a header row, then one line per reading with the record index', () => {
    const csv = toCsv([[ok, gone]], { meter: 'M1' });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toContain('record,key,obis,raw,scaler,unit,value,missing');
    expect(lines).toContain('0,kwhImport,1.0.1.8.0.255,1000,0,kWh,1000,false');
  });

  it('writes a missing reading with an EMPTY raw and value cell, never 0', () => {
    const csv = toCsv([[gone]], {});
    expect(csv.split('\r\n')).toContain('0,voltageL1Min,1.0.12.27.0.255,,-2,V,,true');
  });

  it('quotes fields containing commas or quotes and doubles internal quotes (RFC 4180)', () => {
    const csv = toCsv([[tricky]], {});
    expect(csv.split('\r\n')).toContain('0,odd,0.0.1.0.0.255,7,0,"k,""W""",7,false');
  });

  it('keeps record indexes distinct across multiple records', () => {
    const lines = toCsv([[ok], [ok]], {}).split('\r\n');
    expect(lines.filter((l) => l.startsWith('0,'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('1,'))).toHaveLength(1);
  });
});

describe('toJson', () => {
  it('round-trips through JSON.parse', () => {
    const payload = { meta: { meter: 'M1', ts: '2026-10-27T00:00:00Z' }, records: [[ok, gone]] };
    expect(JSON.parse(toJson(payload))).toEqual(payload);
  });
});

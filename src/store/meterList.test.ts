import { describe, expect, it } from 'vitest';
import { parseMeterList } from './meterList';

const H = '#Name,Bluetooth Mac,Password,Meter Type(1 or 3),Descriptor';
const A = 'Test Meter 1,AA:BB:CC:DD:EE:FF,00000000,1,Single Phase Group 1';
const B = 'T3,11:22:33:44:55:66,11111111,3,Three Phase';

describe('parseMeterList', () => {
  it('parses rows with numeric type, password, spaced name', () => {
    expect(parseMeterList([H, A, B].join('\n'))).toEqual([
      { name: 'Test Meter 1', mac: 'AA:BB:CC:DD:EE:FF', password: '00000000', type: 1, descriptor: 'Single Phase Group 1' },
      { name: 'T3', mac: '11:22:33:44:55:66', password: '11111111', type: 3, descriptor: 'Three Phase' },
    ]);
  });
  it('skips malformed lines without crashing', () => {
    const t = [H, 'short,line', 'x,AA:BB,pw,2,bad type', 'x,AA:BB,pw,abc,bad type', A].join('\n');
    expect(parseMeterList(t).map((m) => m.name)).toEqual(['Test Meter 1']);
  });
  it('handles CRLF, lone trailing CR, blank and partial last lines', () => {
    expect(parseMeterList([H, A, B].join('\r\n') + '\r\n\r\n')).toHaveLength(2);
    expect(parseMeterList(`${H}\r\n${A}\r`)).toHaveLength(1);
    expect(parseMeterList(`${H}\n${A}\npartial,AA:B`)).toHaveLength(1);
  });
  it('keeps commas after the 4th in the descriptor', () => {
    expect(parseMeterList('n,m,p,3,a, b').at(0)?.descriptor).toBe('a, b');
  });
});

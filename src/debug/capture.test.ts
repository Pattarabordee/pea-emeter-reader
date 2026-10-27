import { beforeEach, describe, expect, it } from 'vitest';
import { clearFrames, exportFrames, recordFrame, setCaptureEnabled } from './capture';

describe('frame capture', () => {
  beforeEach(() => {
    setCaptureEnabled(false);
    clearFrames();
  });

  it('records tx/rx as JSONL with dir, ts, hex when enabled', () => {
    setCaptureEnabled(true);
    recordFrame('tx', Uint8Array.of(0x7e, 0xa0, 0x0a, 0x7e));
    recordFrame('rx', Uint8Array.of(0x00, 0xff, 0x10));
    const lines = exportFrames().split('\n');
    expect(lines).toHaveLength(2);
    const [a, b] = lines.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ dir: 'tx', hex: '7ea00a7e' });
    expect(b).toMatchObject({ dir: 'rx', hex: '00ff10' });
    expect(typeof a.ts).toBe('number');
  });

  it('records nothing when disabled', () => {
    recordFrame('tx', Uint8Array.of(1, 2));
    expect(exportFrames()).toBe('');
  });
});

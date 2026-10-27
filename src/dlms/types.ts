/** Instant is `null` (never epoch / 2000-01-01) when the meter did not supply a real one. */
export type DlmsDateTime = { date: Date | null; missing: boolean };

export type DlmsData =
  | { t: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32'; v: number }
  | { t: 'octet'; v: Uint8Array }
  | { t: 'enum'; v: number }
  | { t: 'array' | 'structure'; v: DlmsData[] }
  | { t: 'datetime'; v: DlmsDateTime }
  | { t: 'null' };

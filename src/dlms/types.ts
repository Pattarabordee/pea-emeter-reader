/** Instant is `null` (never epoch / 2000-01-01) when the meter did not supply a real one. */
/** tzKnown: false when deviation was 0x8000 (date is wall-clock labelled UTC); true when a real deviation was applied; absent when missing. */
export type DlmsDateTime = { date: Date | null; missing: boolean; tzKnown?: boolean };

export type DlmsData =
  | { t: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32'; v: number }
  | { t: 'octet'; v: Uint8Array }
  | { t: 'enum'; v: number }
  | { t: 'array' | 'structure'; v: DlmsData[] }
  | { t: 'datetime'; v: DlmsDateTime }
  | { t: 'null' };

/** One entry of a ProfileGeneric capture_objects (attr 3): which object/attribute fills a column. */
export interface CaptureObject { classId: number; obis: string; attributeIndex: number; dataIndex: number }

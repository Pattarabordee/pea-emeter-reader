// PEA event codes, confirmed from the PEA "Power Quality log" slide (2026-11-09). The raw code is always shown too.
export const EVENT_CODE: Record<number, string> = {
  1: 'ไฟดับ (power down)', 2: 'ไฟกลับมา (power up)', 3: 'เปลี่ยนเวลาออมแสง', 4: 'ตั้งนาฬิกา (เวลาเดิม)', 5: 'ตั้งนาฬิกา (เวลาใหม่)',
  6: 'นาฬิกาผิด', 7: 'ควรเปลี่ยนแบตเตอรี่', 8: 'แบตเตอรี่ต่ำ', 40: 'เปิดฝาครอบขั้ว', 41: 'ปิดฝาครอบขั้ว', 42: 'ตรวจพบสนามแม่เหล็ก DC แรง',
  43: 'สนามแม่เหล็ก DC หายไป', 44: 'เปิดฝาครอบมิเตอร์', 45: 'ปิดฝาครอบมิเตอร์',
  85: 'แรงดัน L1 ปกติ (Voltage L1 normal)', 86: 'แรงดัน L2 ปกติ (Voltage L2 normal)', 87: 'แรงดัน L3 ปกติ (Voltage L3 normal)',
  202: 'แรงดันตก L1 (Under Voltage L1)', 203: 'แรงดันตก L2 (Under Voltage L2)', 204: 'แรงดันตก L3 (Under Voltage L3)',
  209: 'แรงดันเกิน L1 (Over Voltage L1)', 210: 'แรงดันเกิน L2 (Over Voltage L2)', 211: 'แรงดันเกิน L3 (Over Voltage L3)',
  255: 'ล้าง event log (Event log cleared)',
};
export const UNDER_V = new Set([202, 203, 204]);
export const OVER_V = new Set([209, 210, 211]);
export const isEventCodeObis = (obis: string) => obis.startsWith('0.0.96.11.');

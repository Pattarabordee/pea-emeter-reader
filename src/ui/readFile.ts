/** Text of a file picked in an <input type=file>. On iPhone a file still in iCloud (not downloaded to the phone)
 *  fails here with WebKit's "The object can not be found here", so the error says what to do about it. */
export async function readPicked(f: File): Promise<string> {
  try {
    return await f.text();
  } catch (e) {
    throw new Error(`อ่านไฟล์จากเครื่องไม่ได้ (${(e as Error).message}) — บน iPhone เปิดแอป Files ให้ไฟล์ดาวน์โหลดเสร็จก่อน (ไม่มีรูปเมฆ) หรือย้ายไฟล์ไปไว้ "บน iPhone ของฉัน" แล้วเลือกใหม่`);
  }
}

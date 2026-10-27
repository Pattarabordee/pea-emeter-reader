# Web E-Meter Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser PWA that reads PEA e-meters over Web Bluetooth (live instantaneous values + Billing / Load Profile / PQ Event profiles), read-only, exportable to CSV/JSON, running on Windows and Android.

**Architecture:** A pure, dependency-free DLMS/COSEM-over-HDLC codec (framing, ACSE/LLS association, GET, selective-access-by-entry, A-XDR decode) sits behind a `Transport` interface. A Web Bluetooth transport chunks frames over the meter's UART characteristics. Profile/register templates decode raw rows into labelled readings. A vanilla-TS UI + IndexedDB store + Chart.js render and export. All logic is unit-tested against captured/spec byte vectors; the codec never depends on the browser.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Chart.js, `idb`, `vite-plugin-pwa`; GitHub Actions → GitHub Pages (HTTPS).

**Spec:** `docs/design/2026-10-27-web-emeter-reader-design.md`

## Global Constraints

- Read-only: only DLMS **GET** (plus HDLC SNRM/UA/RR and ACSE AARQ/RLRQ). **No SET, no ACTION, no BILLING RESET** — ever.
- No backend; everything runs in the browser. Node **20+** only for build/test.
- TypeScript **strict** mode on.
- Meter passwords **never** appear in committed source; they live only in IndexedDB / user input.
- A value that cannot be read is `missing`, never `0`. Every displayed value shows **OBIS, raw, scaler, unit**.
- Support **both** BLE transports: PEA `b973f2e0-…` and `0000ffe0-…` (FFE). Pick write/notify by GATT property.
- DLMS session fixed params: LN referencing, HDLC, Authentication **LOW (LLS)**, client address **32**, server address **1**, server-address-size **1**, MTU request **251**.
- PWA installable; served over HTTPS via GitHub Pages (Vite `base` = repo name).

## Review Focus

- **Multi-block GET reassembly** (long Load Profile): block loop must request next blocks until `last-block` and concatenate before A-XDR decode, else rows truncate/garble. → Task 6.
- **Outgoing frame segmentation + BLE MTU chunking**: AARQ/large requests split across HDLC I-frames and across MTU writes must arrive byte-exact and in order. → Tasks 3, 10.
- **DLMS date-time edge values**: `FFFF` year or unspecified fields (`0xFF`) → label `missing`, never epoch/2000-01-01 as a real time. → Task 4.
- **Type 1 vs Type 3 column alignment**: wrong phase template shifts every column after voltage; decode must come from the `.txt` Type and be cross-checked against live `capture_objects`. → Tasks 7, 8.
- **Scaler / unsigned handling + missing**: voltage u16 ×10⁻², energy/power u32; a null/absent column is `missing`, not `0`. → Task 8.

---

### Task 1: Project scaffold, CI, and GitHub Pages deploy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `vitest.config.ts`
- Create: `.github/workflows/pages.yml`, `.gitignore`, `README.md`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Produces: a buildable Vite app; `npm test` runs Vitest; a Pages workflow deploying `dist/` with `base: '/<repo>/'`.

- [ ] **Step 1:** `git init`; create the files above. `vite.config.ts` sets `base` from an env/const for Pages; registers `vite-plugin-pwa` (autoUpdate). `package.json` scripts: `dev`, `build`, `preview`, `test`.
- [ ] **Step 2: Write the failing test** `src/smoke.test.ts`: `expect(1+1).toBe(2)` plus `import`-ing a `version` const from `src/main.ts`.
- [ ] **Step 3:** Run `npm install`; run `npm test` → PASS; run `npm run build` → `dist/` produced.
- [ ] **Step 4:** Create GitHub repo (`gh repo create`, private unless the user said public) and push `main`. Enable Pages = GitHub Actions. *(If `gh` is unauthenticated, stop and ask the user to auth / create the repo.)*
- [ ] **Step 5: Commit** `chore: scaffold vite+ts+vitest app with pages deploy`.

---

### Task 2: CRC-16 and HDLC frame codec

**Files:**
- Create: `src/dlms/crc.ts`, `src/dlms/hdlc.ts`
- Test: `src/dlms/crc.test.ts`, `src/dlms/hdlc.test.ts`

**Interfaces:**
- Produces: `crc16X25(bytes: Uint8Array): number` (CRC-CCITT/X.25, init 0xFFFF, reflected, xorout 0xFFFF).
- Produces: `encodeHdlc(f: HdlcFrame): Uint8Array`, `decodeHdlc(bytes: Uint8Array): HdlcFrame`.
  `HdlcFrame = { dest: number; src: number; control: number; info?: Uint8Array; segmented: boolean }` (type-3 format, 1-byte addresses, flag `0x7E`, HCS over header, FCS over whole frame).

- [ ] **Step 1: Write failing tests.** `crc.test.ts`: known vector — `crc16X25(bytes_of("123456789"))` → `0x906E`. `hdlc.test.ts`: `decodeHdlc(encodeHdlc(f))` round-trips a sample I-frame; a frame with a corrupted FCS throws; HCS/FCS match a hand-computed SNRM byte string.
- [ ] **Step 2:** Run → FAIL (not defined).
- [ ] **Step 3:** Implement `crc16X25`, then `encodeHdlc`/`decodeHdlc` (format type 3: frame length in the 2-byte format field, HCS after header when info present, FCS before closing flag).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dlms): hdlc frame codec + crc16`.

---

### Task 3: HDLC session (SNRM/UA, I/RR, sequence & segmentation)

**Files:** Create `src/dlms/hdlc-session.ts`; Test `src/dlms/hdlc-session.test.ts`
**Interfaces:**
- Consumes: Task 2 codec.
- Produces: `class HdlcSession { constructor(clientAddr:number, serverAddr:number); snrm(): Uint8Array; onReceive(frame: Uint8Array): HdlcEvent; sendInfo(llc: Uint8Array): Uint8Array[]; disconnect(): Uint8Array }`
  `HdlcEvent = { kind:'ua' } | { kind:'info'; apdu: Uint8Array } | { kind:'needMore' }` — tracks Ns/Nr, reassembles segmented info frames, emits RR when more segments are expected.

- [ ] **Step 1: Write failing tests.** SNRM bytes well-formed; feeding a UA frame → `{kind:'ua'}`; two segmented info frames reassemble into one `apdu`; `sendInfo` of a payload larger than max info splits into ordered I-frames with incrementing Ns.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dlms): hdlc session state machine`.

---

### Task 4: A-XDR data decoder

**Files:** Create `src/dlms/axdr.ts`, `src/dlms/types.ts`; Test `src/dlms/axdr.test.ts`
**Interfaces:**
- Produces: `class ByteReader(buf: Uint8Array)`; `decodeData(r: ByteReader): DlmsData`.
  `DlmsData` tagged union: `{t:'u8'|'u16'|'u32'|'i8'|'i16'|'i32', v:number}` | `{t:'octet', v:Uint8Array}` | `{t:'enum',v:number}` | `{t:'array'|'structure', v:DlmsData[]}` | `{t:'datetime', v: DlmsDateTime}` | `{t:'null'}`.
  `DlmsDateTime = { date: Date|null; missing: boolean }` (12-byte COSEM date-time; `year==0xFFFF` or unspecified → `missing:true, date:null`).

- [ ] **Step 1: Write failing tests.** Decode tagged bytes for u16 `0x12 59DA` → 23002; a `structure` of `[u32, u16]`; a `datetime` of a real timestamp → correct `Date`; a `datetime` with year `FFFF` → `{missing:true,date:null}`; `octet-string`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement reader + `decodeData` (COSEM data tags). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(dlms): a-xdr decoder with cosem date-time`.

---

### Task 5: ACSE association (AARQ with LLS, parse AARE)

**Files:** Create `src/dlms/acse.ts`; Test `src/dlms/acse.test.ts`
**Interfaces:**
- Produces: `buildAarq(password: Uint8Array): Uint8Array` (LN context, mechanism-name LLS, calling-authentication-value = password); `parseAare(apdu: Uint8Array): { accepted: boolean; diagnostic: string }`.

- [ ] **Step 1: Write failing tests.** `buildAarq` matches a known-good AARQ byte string for a sample password (LN + LLS); `parseAare` of an accepted AARE → `{accepted:true}`, of a rejected one → `{accepted:false, diagnostic}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(dlms): acse aarq/aare with lls`.

---

### Task 6: GET service + DlmsClient (assemble HDLC+ACSE+GET, block loop)

**Files:** Create `src/dlms/get.ts`, `src/dlms/obis.ts`, `src/dlms/client.ts`; Test `src/dlms/get.test.ts`, `src/dlms/client.test.ts`
**Interfaces:**
- Consumes: Tasks 3–5; `interface Transport { write(b:Uint8Array):Promise<void>; onData(cb:(b:Uint8Array)=>void):void }`.
- Produces: `obisToBytes(code:string):Uint8Array`; `buildGetNormal(classId:number,obis:Uint8Array,attr:number,access?:SelectiveAccess):Uint8Array`; `buildGetNext(blockNumber:number):Uint8Array`; `parseGetResponse(apdu:Uint8Array): {data?:Uint8Array} | {block:{last:boolean;blockNumber:number;raw:Uint8Array}}`.
- Produces: `class DlmsClient { constructor(t:Transport, o:{clientAddr:number;serverAddr:number;password:Uint8Array}); associate():Promise<void>; get(classId:number,obis:string,attr:number,access?:SelectiveAccess):Promise<DlmsData>; release():Promise<void> }` — `get` runs the multi-block loop (request-next until `last`), concatenates, then `decodeData`.

- [ ] **Step 1: Write failing tests.** `obisToBytes("1.0.12.7.0.255")` → `[1,0,12,7,0,255]`. `get.test`: a two-block get-response reassembles to the full data. `client.test`: with a **fake Transport** scripted to reply SNRM→UA, AARQ→AARE, GET→get-response, `associate()` then `get(3,"1.0.12.7.0.255",2)` resolves to the expected `DlmsData`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(dlms): get service and DlmsClient with block transfer`.

---

### Task 7: ProfileGeneric — entries-in-use + selective access by entry

**Files:** Create `src/dlms/profile.ts`; Test `src/dlms/profile.test.ts`
**Interfaces:**
- Consumes: Task 6.
- Produces (on `DlmsClient` or a helper): `getEntriesInUse(obis:string):Promise<number>` (GET attr 7); `readRowsByEntry(obis:string, fromEntry:number, count:number):Promise<DlmsData[]>` (GET attr 2 with selective-access-by-entry, `fromEntry` 1-based); `getCaptureObjects(obis:string):Promise<CaptureObject[]>` (GET attr 3).

- [ ] **Step 1: Write failing tests.** Selective-access-by-entry request bytes for `(from=1,count=3)` match a known descriptor; a get-response array of 2 rows → `DlmsData[2]`, each a `structure`; `getEntriesInUse` reads the u32 count.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(dlms): profile-generic entry read`.

---

### Task 8: Capture templates + row decoder (Billing/Load/PQ, Type 1/3)

**Files:** Create `src/profiles/templates.ts`, `src/profiles/decode.ts`; Test `src/profiles/decode.test.ts`
**Interfaces:**
- Produces: `type ColumnSpec = { key:string; obis:string; kind:'datetime'|'u8'|'u16'|'u32'; scaler:number; unit:string }`.
- Produces: `billingTemplate(type:1|3):ColumnSpec[]`, `loadTemplate(type:1|3):ColumnSpec[]`, `eventTemplate(type:1|3):ColumnSpec[]` (exact columns per spec §6.3).
- Produces: `decodeRow(row:DlmsData[], cols:ColumnSpec[]):Reading[]` where `Reading = { key:string; obis:string; raw:number|null; scaler:number; unit:string; value:number|null; missing:boolean }` (apply scaler as ×10^scaler; a null/absent cell → `missing:true, value:null`; never `0`). `verifyCapture(cols:ColumnSpec[], live:CaptureObject[]):{ok:boolean; usedLive:boolean; columns:ColumnSpec[]}`.

- [ ] **Step 1: Write failing tests.** `billingTemplate(1)` has the 12-item single-phase column list; `decodeRow` of a sample single-phase billing structure → voltage 23002→230.02 V, kWh columns present with unit; a structure missing a trailing cell → that Reading `missing:true` (not 0); `billingTemplate(3)` adds L2/L3; `verifyCapture` flags a mismatch and returns the live layout.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(profiles): capture templates and row decoder`.

---

### Task 9: Instantaneous (live) register read

**Files:** Create `src/profiles/live.ts`; Test `src/profiles/live.test.ts`
**Interfaces:**
- Consumes: Task 6.
- Produces: `LIVE_REGISTERS(type:1|3):ColumnSpec[]` (V `1.0.12.7`, I `1.0.31.7`, P-imp `1.0.1.7`, P-exp `1.0.2.7`, VA `1.0.9.7`, PF `1.0.13.7`; type 3 adds per-phase V `1.0.32/52/72.7`, I `1.0.31/51/71.7`). `readLive(client:DlmsClient, type:1|3):Promise<Reading[]>` — GET class 3 attr 2 per register, reading each register's own scaler/unit (attr 3) once and caching.

- [ ] **Step 1: Write failing test.** With a fake client scripted to return register value + scaler_unit, `readLive` → voltage Reading with correct scaled value and unit; an errored register → that Reading `missing:true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(profiles): live instantaneous registers`.

---

### Task 10: Web Bluetooth transport

**Files:** Create `src/ble/transport.ts`, `src/ble/uuids.ts`; Test `src/ble/chunk.test.ts`
**Interfaces:**
- Produces: `SERVICE_UUIDS = ['b973f2e0-…','0000ffe0-…']`; `connectMeter():Promise<BleTransport>` (requestDevice filtered by both services + `optionalServices`, connect, discover, pick write char by `write/writeWithoutResponse` property and notify char by `notify` property, enable CCCD, request MTU 251). `class BleTransport implements Transport` — `write` splits into `mtu`-sized chunks with a small delay; `onData` reassembles notifications. Produces pure helpers `chunk(bytes:Uint8Array, mtu:number):Uint8Array[]` and a `FrameReassembler` (HDLC flag-delimited) that are the unit-tested core.

- [ ] **Step 1: Write failing tests** (`chunk.test.ts`, no real BLE): `chunk` splits/≤mtu/orders correctly incl. a non-multiple tail; `FrameReassembler` emits one frame from notifications split mid-frame and handles two frames in one notification.
- [ ] **Step 2:** FAIL. **Step 3:** Implement helpers + the `BleTransport`/`connectMeter` glue (glue verified later in the field test). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ble): web bluetooth transport with chunking/reassembly`.

---

### Task 11: Meter store (.txt import + IndexedDB)

**Files:** Create `src/store/meterList.ts`, `src/store/db.ts`; Test `src/store/meterList.test.ts`
**Interfaces:**
- Produces: `parseMeterList(text:string):MeterEntry[]` — header `#Name,Bluetooth Mac,Password,Meter Type(1 or 3),Descriptor`; `MeterEntry = { name:string; mac:string; password:string; type:1|3; descriptor:string }`. `db` (idb): `saveMeters`, `listMeters`, `setPassword(mac,pw)`, `getPassword(mac)`.
- Consumes: the real sample file (`scratchpad/dl/Name.txt`) as a parser fixture.

- [ ] **Step 1: Write failing tests.** `parseMeterList` of the sample yields the right rows with `type` numeric and password captured; a malformed/short line is skipped (not crashing); CRLF and the trailing partial line handled.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(store): meter list import and indexeddb`.

---

### Task 12: Export CSV + JSON

**Files:** Create `src/export/export.ts`; Test `src/export/export.test.ts`
**Interfaces:**
- Produces: `toCsv(rows:Reading[][], meta):string` (UTF-8 BOM, columns incl. OBIS/raw/scaler/unit/value, `missing` → empty cell); `toJson(payload):string`; `download(filename, text, mime)`.

- [ ] **Step 1: Write failing tests.** `toCsv` header + a row with a `missing` cell empty (not 0); `toJson` round-trips through `JSON.parse`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(export): csv and json`.

---

### Task 13: UI — Live screen

**Files:** Create `src/ui/app.ts`, `src/ui/live.ts`, `src/styles.css`; Modify `src/main.ts`; Test `src/ui/live.test.ts`
**Interfaces:**
- Consumes: Tasks 6, 9, 10, 11. Produces: a Connect button (user gesture → `connectMeter`), meter picker from the store, a live readout table (value + unit + OBIS + raw), auto-refresh interval with stop/disconnect. Render helper `renderReadings(el, readings:Reading[])` is unit-tested.

- [ ] **Step 1: Write failing test.** `renderReadings` into a jsdom element shows the value+unit and marks a `missing` reading as “—/missing”, not 0.
- [ ] **Step 2:** FAIL. **Step 3:** Implement screen + wiring. **Step 4:** PASS. Manual: `npm run dev`, load, confirm layout (no real meter yet).
- [ ] **Step 5: Commit** `feat(ui): live readout screen`.

---

### Task 14: UI — stored-data screens (Billing/Load/PQ) + pager + chart

**Files:** Create `src/ui/profiles.ts`, `src/ui/chart.ts`; Test `src/ui/profiles.test.ts`
**Interfaces:**
- Consumes: Tasks 7, 8, 12. Produces: three tabs; a record pager (first/prev/next/last driven by entries-in-use + `readRowsByEntry`); a Chart.js line chart for Load Profile voltage/demand; Export buttons. Pure helper `pageRange(total, pageSize, page)` unit-tested.

- [ ] **Step 1: Write failing test.** `pageRange` returns correct `{from,count}` incl. last partial page and empty profile (0 entries).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Manual dev check of layout.
- [ ] **Step 5: Commit** `feat(ui): billing/load/pq screens with pager and chart`.

---

### Task 15: Raw-frame capture / debug mode

**Files:** Create `src/debug/capture.ts`; Modify `src/ble/transport.ts`, `src/ui/app.ts`; Test `src/debug/capture.test.ts`
**Interfaces:**
- Produces: a toggle that tees every raw TX/RX frame to an in-memory log with timestamps and a “download frames (.jsonl)” action, for building golden vectors. `recordFrame(dir:'tx'|'rx', bytes:Uint8Array)` + `exportFrames():string`.

- [ ] **Step 1: Write failing test.** `recordFrame` then `exportFrames` yields JSONL with hex + dir + ts; disabled mode records nothing.
- [ ] **Step 2:** FAIL. **Step 3:** Implement + tee in transport. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(debug): raw frame capture mode`.

---

### Task 16: PWA polish + end-to-end integration

**Files:** Modify `vite.config.ts` (pwa manifest: name, icons, theme), Create `public/manifest.webmanifest`, icons; Modify `src/main.ts`; Test `src/ui/integration.test.ts`
**Interfaces:**
- Produces: installable PWA (offline app shell), wired navigation across Live/Billing/Load/PQ, graceful “Web Bluetooth not supported” message. An integration test drives the whole flow against a **fake Transport** scripted end-to-end (associate → live read → one profile row → export).

- [ ] **Step 1: Write failing test.** Full fake-transport flow yields a live Reading, one decoded billing row, and a non-empty CSV string.
- [ ] **Step 2:** FAIL. **Step 3:** Implement manifest/SW + nav + capability guard. **Step 4:** Run `npm test` (all) → PASS; `npm run build` → PASS; push → Pages deploys.
- [ ] **Step 5: Commit** `feat: pwa shell and end-to-end integration`.

---

## Field verification (after Task 16, needs a real meter — not a code task)
Open the Pages URL on Android Chrome next to a meter, capture raw frames (Task 15), confirm association + a real GET with OBIS/scaler/unit/timestamp, then add the captured frames as golden vectors to Tasks 2–8 tests and calibrate kWh/kW display divisors. Only after this is "reads a real meter" claimed.

## Self-review notes
- Spec coverage: live (§6.5)→T9; three profiles (§6.3)→T7/T8; transports b973+FFE (§6.1)→T10; .txt+Type (§6.6)→T11; template verify (§6.7)→T8; export (§2)→T12; PWA/HTTPS (§7)→T1/T16; no-write (§4)→enforced by API surface (only GET built). All five Review Focus items have owning-task tests.

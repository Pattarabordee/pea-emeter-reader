# Web E-Meter Reader — Design Document

**Date:** 2026-10-27
**Status:** Revised after reviewer check — awaiting approval (nothing is built yet)
**Author:** prepared with Claude Code from reverse-engineering the PEA BLE-iMeter Android app v1.90, read-only

---

## 1. Intent & why

The user needs to read PEA electronic meters while standing in front of them, holding a
phone or laptop, and see **every electrical value the meter can report** — not just voltage
and current. Today this requires the PEA **BLE-iMeter** Android app (v1.90). The goal is a
**web app** that does the same reading job but:

- runs on **Windows and Android first** (Chrome / Edge), iPhone later;
- needs **no installation** (open a URL);
- is **read-only** — it never writes to the meter.

The web app replaces the Android app's reading workflow using the **same BLE/DLMS protocol**,
re-implemented in TypeScript because no DLMS library exists for the browser.

## 2. Goals

- Connect to a PEA meter over **Web Bluetooth** and read:
  - **Live instantaneous values** (V, I, power import/export, apparent power, power factor) read
    *now* while standing at the meter — the headline use case — refreshing periodically.
  - The three stored data sets the PEA app reads: **Billing Profile**, **Load Profile**, **PQ Event Profile**.
- Support **both BLE transports**: the PEA app's `b973…` service and the `FFE0/FFE1/FFE2` family
  (the meter fleet mix is unknown, so the app must handle either).
- Show all captured values per record, with OBIS code, raw value, applied scaler, unit, and timestamp.
- Import the existing PEA **meter list `.txt`** (same format) so the user keeps their meter database.
- **Export** readings to **CSV and JSON** on the device.
- Single phase (Type 1) and three phase (Type 3) meters.
- Installable as a **PWA** (works from the home screen, offline shell) — still just a web app.

## 3. Non-goals (v1)

- iPhone / iPad support (Web Bluetooth is unavailable in Safari/Chrome on iOS; handled later).
- Any **write** operation to the meter — see anti-goals.
- Cloud sync, multi-user accounts, a backend server. Everything runs in the browser.
- Reading meter brands/profiles that differ from the PEA capture templates below.
- Replacing the macOS Swift CLI / existing `pea_meter_read.py` (separate tools, untouched).

## 4. Anti-goals (would make this a failure even if it "works")

- **Any BLE write that changes meter state.** In particular the PEA app's **BILLING RESET**
  button issues a write that closes/resets the billing period. It is **excluded**. The web app
  issues only DLMS GET (and the mandatory HDLC/AARQ link-setup frames). No SET, no ACTION, no reset.
- **Fabricated or zero-filled values.** A value that could not be read is labelled `missing`,
  never shown as 0. A reading is only called "successful" when authentication was accepted and a
  GET returned a real value with its OBIS, scaler, unit and timestamp.
- **Hardcoded meter passwords in shipped source.** Passwords live only in the user's local store.
- **Claiming production-readiness without a real-meter test.** Verification requires a live meter.

## 5. Constraints

- **Web Bluetooth** needs a **secure context** (HTTPS, or `localhost`) and a **user gesture** to
  open the device chooser. On Android this means the app must be served over HTTPS.
- Web Bluetooth **cannot connect by MAC address** — the browser shows its own device chooser and
  the user picks the meter. The meter-list MAC is used only to *label/suggest* which device to pick,
  not to connect directly. (Filtering the chooser by the meter's service UUID narrows the list.)
- BLE link is a **proprietary transparent-UART**: all DLMS bytes are chunked over one write
  characteristic and reassembled from notifications on one notify characteristic.
- Windows Chrome/Edge support Web Bluetooth; the test laptop needs a working Bluetooth adapter.

## 6. Protocol specification (extracted read-only from APK v1.90 via JADX)

APK `BLE app V1_9.apk`, pkg `com.example.imeter_00`, uses the **Gurux DLMS (Java)** library.
The web app re-implements only the subset below, from the DLMS/COSEM spec — **Gurux code is not
copied** (Gurux is GPLv2 / commercial; we write clean TypeScript to the public spec).

### 6.1 BLE transport (two families supported)
Both are a transparent-UART: one write characteristic carries DLMS bytes out, one notify
characteristic carries them back. **Pick characteristics by GATT property (writeable → TX,
notifiable → RX), not by fixed UUID order.** The chooser filter offers **both** service UUIDs; the
app detects which service the chosen device exposes and uses its characteristics.

- **PEA family (from APK v1.90):** Service `b973f2e0-b19e-11e2-9e96-0800200c9a66`; write UUID starts
  `d9…` (`d973f2e1-…`), notify UUID starts `e9…` (`e973f2e1-…`/`e973f2e2-…`).
- **FFE family (from the Swift CLI `--transport-ffe`):** Service `0000ffe0-…`; characteristics in the
  `ffe1`/`ffe2` range. **Exact write-vs-notify assignment to confirm** from the Swift CLI source or a
  live GATT scan (property detection handles it either way).
- CCCD `00002902-…` to enable notifications. Request **MTU 251**; split outgoing frames into
  MTU-sized chunks with a small inter-chunk delay; reassemble incoming notifications until a full
  HDLC frame is present.

### 6.2 DLMS/COSEM session (as configured by the app)
- Referencing: **Logical Name (LN)**
- Interface: **HDLC**
- Authentication: **LOW (LLS)** — password-based. Password is the meter's (sample `00454712`; one sample meter `00000001`).
- **Client address: 32** (0x20, management client). **Server address: 1**, server address size 1.
- Sequence: **SNRM → parse UA → AARQ → parse AARE → GET(s) → DISCONNECT (release)**.
- Block transfer: when a GET response spans multiple blocks, loop requesting next blocks (receiver-ready) and concatenate before parsing. (Standard DLMS; required for the profiles.)

### 6.3 The three data sets (ProfileGeneric, read by entry)
Each profile is read by: GET **attribute 7 (entries-in-use)** to learn the record count, then
**selective access by entry** (`readRowsByEntry(profile, fromEntry, count)`) to pull rows.
Rows are decoded against the fixed capture template (below) — the meter returns raw integers;
the template supplies column type, scaler and unit.

**Billing Profile** — OBIS `1.0.98.1.0.255`
| # | Column | OBIS | Type | Scaler | Unit |
|--|--|--|--|--|--|
|0|Clock (timestamp)|clock attr 2|date-time (12 B)|—|—|
|1|Total kWh import|1.0.1.8.0.255|u32|0|active energy|
|2|Total kWh export|1.0.2.8.0.255|u32|0|active energy|
|3|Total kWh absolute|1.0.15.8.0.255|u32|0|active energy|
|4|Total kWh net|1.0.16.8.0.255|u32|0|active energy|
|5|Max kW demand import|1.0.1.6.0.255|u32 (ext. reg.)|0|active power|
|6|Max kW demand export|1.0.2.6.0.255|u32 (ext. reg.)|0|active power|
|7|Voltage (min) L1|1.0.12.27 / 1.0.32.27.0.255|u16|−2|volt|
|(8,9 — Type 3 only)|Voltage L2, L3|1.0.52.27 / 1.0.72.27.0.255|u16|−2|volt|
|next|Alarm descriptor 1|0.0.97.98.20.255|u32|—|—|
|next|Alarm descriptor 2|0.0.97.98.21.255|u32|—|—|

(Type 1 uses the single `1.0.12.27.0.255` voltage column; Type 3 uses L1/L2/L3.)

**Load Profile** — OBIS `1.0.99.1.0.255`
| # | Column | OBIS | Type | Scaler | Unit |
|--|--|--|--|--|--|
|0|Clock|clock attr 2|date-time|—|—|
|1|Status|0.0.96.10.1.255|u8|—|—|
|2|Voltage (avg) L1|1.0.12.27 / 1.0.32.27.0.255|u16|−2|volt|
|(Type 3: + L2 1.0.52.27, L3 1.0.72.27)|u16|−2|volt|
|next|Demand import|1.0.1.27.0.255|u32|0|active power|
|next|Demand export|1.0.2.27.0.255|u32|0|active power|

**PQ Event Profile** — OBIS `0.0.99.98.0.255`
| # | Column | OBIS | Type | Scaler | Unit |
|--|--|--|--|--|--|
|0|Clock|clock attr 2|date-time|—|—|
|1|Event status/code|0.0.96.11.0.255|u8|—|—|
|2|Voltage L1|1.0.12.27 / 1.0.32.27.0.255|u16|−2|volt|
|(Type 3: + L2, L3)|u16|−2|volt|

### 6.4 Value scaling & timestamp
- Apply the template scaler: scaler −2 → value × 10⁻² (e.g. voltage raw 23002 → 230.02 V).
  Energy/power columns have scaler 0 in the template; the PEA UI divides some by 1000 for kWh/kW
  display. **Exact display divisors must be confirmed against the first real-meter read** and shown
  alongside raw value + unit, never silently assumed.
- Clock is a 12-byte DLMS date-time: year = bytes[0..1] big-endian, month=[2], day=[3], hour=[5],
  min=[6], sec=[7]; `FFFF` year ⇒ undated/invalid → label `missing`.

### 6.5 Live instantaneous values (added per user: "เอาค่าสดด้วย")
After the same SNRM→AARQ association, read instantaneous registers with plain **GET (attribute 2)**
— no profile, no selective access — then repeat on an interval for a live view. OBIS set (single
phase, from the PEA knowledge prompt; **confirm scaler/unit live, show raw+scaled+unit**):
| Value | OBIS | Unit |
|--|--|--|
|Voltage|`1.0.12.7.0.255`|V|
|Current|`1.0.31.7.0.255`|A|
|Active power import|`1.0.1.7.0.255`|W|
|Active power export|`1.0.2.7.0.255`|W|
|Apparent power|`1.0.9.7.0.255`|VA|
|Power factor|`1.0.13.7.0.255`|—|

For **three phase**, add per-phase registers (V: `1.0.32/52/72.7.0.255`, I: `1.0.31/51/71.7.0.255`,
power per phase likewise) — **exact three-phase register list to confirm** against a real 3-phase
meter. Note `.7` = instantaneous (live) vs `.27` = the averaged register used inside the profiles.

### 6.6 Meter list `.txt` format & Type selection (resolved)
Confirmed from the PEA sample file: one header line then CSV rows:
`#Name,Bluetooth Mac,Password,Meter Type(1 or 3),Descriptor`
e.g. `jaa 6600078102,90:3D:BD:4D:3C:14,00454712,1,Single Phase Group 1`.
- The file **carries the password** → import is enough; the UI still lets the user edit/override a
  per-meter password (stored in IndexedDB), and never ships any password in source.
- **Type (1 or 3) comes from this column** → it selects the single- vs three-phase decode template.
  The MAC labels/suggests which device to pick in the chooser (cannot pre-connect by MAC).

### 6.7 Template trust & runtime verification
The capture templates in §6.3 are **taken directly from the app's source** (the `Generate…ProfileData`
methods), not inferred — high trust. As a safety net the client will still **GET each profile's
`capture_objects` (attribute 3) once at connect** and check the live column layout against the
template before decoding rows; on mismatch it decodes from the live layout and flags it, rather than
silently misaligning columns.

## 7. Architecture (the "how", as decided)

- **Language/tooling:** TypeScript + **Vite**. No UI framework (vanilla + small modules) to keep the
  bundle lean; one charting lib (**Chart.js**) for the Load Profile graph. *(My call.)*
- **Layers:**
  - `ble/` — Web Bluetooth transport: chooser, connect, MTU, chunked write, notification reassembly.
  - `dlms/` — minimal DLMS/COSEM-over-HDLC client: HDLC framing (SNRM/UA/I-frames/RR),
    AARQ/AARE with LLS, GET, selective-access-by-entry, block reassembly, AXDR decode, scaler/unit.
  - `profiles/` — the three capture templates + row decoders (Type 1 / Type 3).
  - `ui/` — meter list; **Live screen** (instantaneous V/I/P/VA/PF, auto-refreshing); stored-data
    screens (Billing / Load Profile / PQ) with record pager and charts.
  - `store/` — meter list (import `.txt`), per-meter credentials in **IndexedDB** (local only).
  - `export/` — CSV + JSON Blob download.
- **PWA:** manifest + service worker caching the app shell (not meter data).
- **Hosting for real-meter testing:** served over **HTTPS**. Simplest path: a **git repo +
  GitHub Pages** (HTTPS, openable on the Android phone at the meter). *(Decision for the user — §10.)*
- **Raw-frame capture mode (phase 1 deliverable):** no raw HDLC/AARE/GET byte vectors exist yet
  (only the Swift CLI's already-decoded `@METER` JSON). So the app ships a debug mode that logs every
  raw frame on the first real read; those frames become the **golden vectors** for decoder unit tests.
- **Verification:** unit tests for the DLMS/AXDR decoders and scaler/clock logic against those
  captured byte frames. Field test on **Android Chrome next to a real meter** confirms end-to-end and
  calibrates display divisors. Per the PEA rule, "success" is only claimed after a real GET with
  OBIS/scaler/unit/timestamp verified — never from device name, connect, or cached data.

## 8. Risks

- **DLMS re-implementation is the hard part.** Mitigated by: read-only + only 3 profiles + LLS (no
  ciphering), and by testing decoders against recorded real frames before trusting live output.
- **Exact kWh/kW divisors** are set in the PEA UI, not the capture template — confirmed on first real read.
- **Web Bluetooth quirks** (chooser can't pre-select by MAC; Windows adapter variance). Mitigated by
  UUID-filtered chooser and clear on-screen matching to the meter-list entry.
- **HTTPS requirement** for on-phone testing → needs a hosted URL (GitHub Pages or similar).

## 9. What's left to the builder

- Exact HDLC frame bytes (FCS, control fields, segmentation) per DLMS Green Book — standard, written to spec.
- AARQ/AARE LLS calling-authentication encoding details.
- Chart styling, screen layout polish, Thai/English labels (OBIS labels can reuse the bundled
  `OBISCodes.txt` dictionary).
- Service-worker cache strategy specifics.

## 9a. Reviewer check — how each point was resolved
- **Live vs stored (biggest one):** user chose **live instantaneous *and* the 3 profiles** → §6.5, Live screen.
- **BLE transport (b973 vs FFE):** user **unsure** → **support both** families → §6.1.
- **`.txt` format / passwords:** resolved from the real sample file → §6.6 (file carries the password).
- **Type 1 vs 3 selection:** resolved → from the `.txt` Type column → §6.6.
- **Templates confirmed vs inferred:** from app source, **confirmed**; plus runtime `capture_objects` check → §6.7. *(my call)*
- **Golden capture frames:** none exist → phase-1 raw-frame capture mode produces them → §7. *(my call)*

## 10. Open decisions for the user
1. **Hosting for testing:** create a **git repo + GitHub Pages** (HTTPS) so the app opens on the
   phone at the meter? (Recommended — Web Bluetooth needs HTTPS on Android.)
2. **Repo location/visibility:** where the project lives and public vs private.

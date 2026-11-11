// Meter positions from the GIS join file (docs/data/emeter-ble-gis-*.csv). PEA-internal: it is loaded from a file on
// the device and kept in IndexedDB only, never bundled into the public site.
export type Place = { mac: string; serial: string; maker: string; phase: string; office: string; lat: number; lon: number };

export const normMac = (s: string) => s.toUpperCase().replace(/[^0-9A-F]/g, '');

/** Parse the GIS CSV by header name. Rows without a 12-hex-digit MAC or with a position outside Thailand are skipped. */
export function parsePlaces(text: string): Place[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim());
  const head = (lines[0] ?? '').split(',').map((s) => s.trim().toLowerCase());
  const [im, is, ik, ip, io, ila, ilo] = ['mac', 'serial', 'maker', 'phase', 'office', 'lat', 'lon'].map((n) => head.indexOf(n));
  if (im < 0 || ila < 0 || ilo < 0) throw new Error('ไม่ใช่ไฟล์พิกัดมิเตอร์ (ต้องมีคอลัมน์ mac, lat, lon)');
  const out: Place[] = [];
  for (const l of lines.slice(1)) {
    const f = l.split(','); // shortcut: this export has no quoted commas; use a CSV parser if a field ever gets one
    const get = (i: number) => (i < 0 ? '' : (f[i] ?? '').trim());
    const lat = Number(get(ila)), lon = Number(get(ilo));
    if (normMac(get(im)).length !== 12 || !(lat > 5 && lat < 21 && lon > 97 && lon < 106)) continue;
    out.push({ mac: get(im).toUpperCase(), serial: get(is), maker: get(ik), phase: get(ip), office: get(io), lat, lon });
  }
  return out;
}

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

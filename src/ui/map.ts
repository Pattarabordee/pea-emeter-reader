import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { distanceM, parsePlaces, type Place } from '../store/places';
import { listPlaces, savePlaces } from '../store/db';

const NEAR_LIST = 10; // nearest meters listed under the map
const NEAR_M = 300; // drawn bigger/green when this close
const BAD_GPS_M = 100; // accuracy worse than this is flagged
const REDRAW_M = 20; // re-colour markers after moving this far

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
const metres = (m: number) => (m < 1000 ? `${Math.round(m)} ม.` : `${(m / 1000).toFixed(1)} กม.`);

/** Glue (Leaflet + Geolocation + IndexedDB): meters around the phone's GPS position, from a GIS file kept on the device.
 *  `onPick` selects a meter for Connect and returns a message to show ('' = done). Returns the call to run when the
 *  tab is shown: the map starts then (Leaflet needs a visible box, and GPS permission is asked on first use). */
export function mountMap(root: HTMLElement, onPick: (p: Place) => string): () => void {
  const file = h('input'); file.type = 'file'; file.accept = '.csv';
  const status = h('p'); status.className = 'status';
  const box = h('div'); box.className = 'mapbox';
  const near = h('div');
  root.append(h('h2', 'แผนที่มิเตอร์'),
    h('p', 'โหลดไฟล์พิกัด (emeter-ble-gis-….csv) ครั้งเดียว ไฟล์เก็บในเครื่องนี้เท่านั้น ไม่ขึ้นเว็บ'), file, status, box,
    h('h3', 'ใกล้ฉัน'), near);

  // Leaflet is loaded when the tab is first opened: it needs `window` at import, and most visits never open the map.
  let L: typeof Leaflet | undefined, map: Leaflet.Map | undefined, layer: Leaflet.LayerGroup | undefined;
  let places: Place[] = [];
  let pos: [number, number] | undefined;
  let acc = 0;
  let me: Leaflet.CircleMarker | undefined, accCircle: Leaflet.Circle | undefined, drawnAt: [number, number] | undefined;

  const pick = (p: Place) => { const msg = onPick(p); if (msg) status.textContent = msg; };
  const popup = (p: Place) => {
    const d = h('div');
    d.append(h('b', p.serial || p.mac), h('div', `${p.maker} · เฟส ${p.phase || '?'} · ${p.mac}`));
    if (pos) d.append(h('div', `ห่าง ${metres(distanceM(pos[0], pos[1], p.lat, p.lon))}`));
    d.append(Object.assign(h('button', 'เลือกมิเตอร์นี้'), { onclick: () => pick(p) }));
    return d;
  };
  const draw = () => {
    if (!L || !layer) return;
    layer.clearLayers();
    for (const p of places) {
      const close = pos != null && distanceM(pos[0], pos[1], p.lat, p.lon) <= NEAR_M;
      L.circleMarker([p.lat, p.lon], { radius: close ? 8 : 5, color: '#fff', weight: 1, fillColor: close ? '#2e7d32' : '#1565c0', fillOpacity: 0.9 })
        .bindPopup(() => popup(p)).addTo(layer);
    }
  };
  const listNear = () => {
    if (!places.length) { near.textContent = 'ยังไม่มีไฟล์พิกัด'; return; }
    if (!pos) { near.textContent = 'รอตำแหน่ง GPS…'; return; }
    const here = pos;
    const rows = places.map((p) => ({ p, d: distanceM(here[0], here[1], p.lat, p.lon) })).sort((a, b) => a.d - b.d).slice(0, NEAR_LIST);
    near.replaceChildren(...rows.map(({ p, d }) => {
      const r = h('div'); r.className = 'row';
      r.append(
        Object.assign(h('button', `${metres(d)} · ${p.serial || p.mac} · ${p.maker}`), { onclick: () => map?.setView([p.lat, p.lon], 19) }),
        Object.assign(h('button', 'เลือก'), { onclick: () => pick(p) }));
      return r;
    }));
  };
  const show = (list: Place[]) => {
    places = list;
    draw(); listNear();
    if (L && map && !pos && list.length) map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lon] as [number, number])));
  };

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const list = parsePlaces(await f.text());
      await savePlaces(list);
      status.textContent = `โหลดพิกัด ${list.length} มิเตอร์แล้ว`;
      show(list);
    } catch (e) { status.textContent = `โหลดไฟล์ไม่ได้: ${(e as Error).message}`; }
  };

  const start = async () => {
    const lf = (await import('leaflet')).default;
    L = lf;
    const m = map = lf.map(box, { preferCanvas: true }).setView([15, 101], 6);
    lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    layer = lf.layerGroup().addTo(m);
    listPlaces().then(show).catch((e) => { status.textContent = `เปิดพิกัดที่บันทึกไว้ไม่ได้ (${(e as Error).message})`; });
    if (!('geolocation' in navigator)) { status.textContent = 'เบราว์เซอร์นี้หาตำแหน่ง GPS ไม่ได้'; return; }
    let first = true;
    navigator.geolocation.watchPosition((g) => {
      pos = [g.coords.latitude, g.coords.longitude];
      acc = g.coords.accuracy;
      if (!me || !accCircle) {
        accCircle = lf.circle(pos, { radius: acc, color: '#ef6c00', weight: 1, fillOpacity: 0.08 }).addTo(m);
        me = lf.circleMarker(pos, { radius: 8, color: '#fff', weight: 2, fillColor: '#ef6c00', fillOpacity: 1 }).bindTooltip('ฉัน').addTo(m);
      } else { me.setLatLng(pos); accCircle.setLatLng(pos).setRadius(acc); }
      if (first) { m.setView(pos, 17); first = false; }
      if (acc > BAD_GPS_M) status.textContent = `GPS ยังไม่แม่น (±${Math.round(acc)} ม.) ระยะที่แสดงอาจคลาดเคลื่อน`;
      else if (status.textContent?.startsWith('GPS')) status.textContent = '';
      if (!drawnAt || distanceM(drawnAt[0], drawnAt[1], pos[0], pos[1]) > REDRAW_M) { draw(); drawnAt = pos; } // thousands of markers: not every tick
      listNear();
    }, (e) => { status.textContent = `หาตำแหน่งไม่ได้: เปิด GPS และกดอนุญาตตำแหน่ง (${e.message})`; },
    { enableHighAccuracy: true, maximumAge: 5000 });
  };

  let started: Promise<void> | undefined;
  return () => {
    started ??= start().catch((e) => { status.textContent = `เปิดแผนที่ไม่ได้ (${(e as Error).message})`; });
    void started.then(() => map?.invalidateSize());
  };
}

import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip } from 'chart.js';
import type { Reading } from '../profiles/templates';
import { bangkokIso } from '../export/format';
import type { ProfileColumn, ProfileData } from '../profiles/history';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip);

/** Pure: one series per wanted key; labels from the clock column. Missing values become null (gap), never 0. */
export function chartSeries(rows: Reading[][], keys: (k: string) => boolean): { labels: string[]; series: { key: string; data: (number | null)[] }[] } {
  const labels = rows.map((r) => {
    const c = r.find((x) => x.key === 'clock');
    return c && !c.missing && Number.isFinite(c.value) ? bangkokIso(c.value as number).slice(0, 16).replace('T', ' ') + '+07:00' : '—';
  });
  const names = [...new Set(rows.flatMap((r) => r.map((x) => x.key)).filter(keys))];
  return { labels, series: names.map((key) => ({ key, data: rows.map((r) => { const x = r.find((y) => y.key === key); return x && !x.missing ? x.value : null; }) })) };
}

const LINE_COLORS = ['#c62828', '#2e7d32', '#1565c0', '#ef6c00'];

/** Glue (Chart.js): one line per column of a history read that `pick` selects, against Bangkok time. */
export function drawProfileChart(canvas: HTMLCanvasElement, p: ProfileData, pick: (c: ProfileColumn) => boolean, yTitle: string): void {
  Chart.getChart(canvas)?.destroy();
  const cols = p.columns.flatMap((c, i) => (pick(c) ? [{ c, i }] : []));
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: p.rows.map((r) => (r[0] == null ? '—' : bangkokIso(r[0]).slice(5, 16).replace('T', ' '))),
      datasets: cols.map(({ c, i }, n) => ({
        label: `${c.key} (${c.unit})`, data: p.rows.map((r) => r[i + 1]), spanGaps: false, pointRadius: 0, borderWidth: 1.5,
        borderColor: LINE_COLORS[n % LINE_COLORS.length], backgroundColor: LINE_COLORS[n % LINE_COLORS.length],
      })),
    },
    options: { animation: false, maintainAspectRatio: false, scales: { y: { title: { display: true, text: yTitle } } } },
  });
}

let chart: Chart | undefined;

/** Glue (Chart.js): voltage (left axis) + demand (right axis) for the loaded Load Profile rows. */
export function drawLoadChart(canvas: HTMLCanvasElement, rows: Reading[][]): void {
  chart?.destroy();
  const { labels, series } = chartSeries(rows, (k) => k.startsWith('voltage') || k.startsWith('demand'));
  chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: series.map((s) => ({ label: s.key, data: s.data, spanGaps: false, yAxisID: s.key.startsWith('voltage') ? 'y' : 'y1' })) },
    options: { animation: false, scales: { y: { position: 'left', title: { display: true, text: 'V' } }, y1: { position: 'right', title: { display: true, text: 'kW' }, grid: { drawOnChartArea: false } } } },
  });
}

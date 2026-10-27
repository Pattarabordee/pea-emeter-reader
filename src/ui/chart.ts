import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip } from 'chart.js';
import type { Reading } from '../profiles/templates';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip);

/** Pure: one series per wanted key; labels from the clock column. Missing values become null (gap), never 0. */
export function chartSeries(rows: Reading[][], keys: (k: string) => boolean): { labels: string[]; series: { key: string; data: (number | null)[] }[] } {
  const labels = rows.map((r) => {
    const c = r.find((x) => x.key === 'clock');
    return c && !c.missing && Number.isFinite(c.value) ? new Date(c.value as number).toISOString().slice(0, 16).replace('T', ' ') : '—';
  });
  const names = [...new Set(rows.flatMap((r) => r.map((x) => x.key)).filter(keys))];
  return { labels, series: names.map((key) => ({ key, data: rows.map((r) => { const x = r.find((y) => y.key === key); return x && !x.missing ? x.value : null; }) })) };
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

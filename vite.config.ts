import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Repo name on GitHub Pages; dev server stays at '/'.
const BASE = '/pea-emeter-reader/';
export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'PEA E-Meter Reader',
        short_name: 'E-Meter',
        description: 'Read PEA e-meters over Web Bluetooth (read-only)',
        theme_color: '#5b2a86',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        // shortcut: SVG only; add PNG 192/512 (maskable) if Android install requires them
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
}));

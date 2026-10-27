import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Repo name on GitHub Pages; dev server stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pea-emeter-reader/' : '/',
  plugins: [VitePWA({ registerType: 'autoUpdate' })],
}));

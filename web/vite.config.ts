import { defineConfig, type Plugin } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

declare const process: { env: Record<string, string | undefined> };

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self' wss:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

// Dev needs inline scripts for HMR, so the policy is added to the built page only.
const csp: Plugin = {
  name: 'asp-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig(({ command, isPreview }) => ({
  // preview serves the built page, whose URLs carry the Pages base path
  base: command === 'build' || isPreview ? (process.env.PAGES_BASE ?? '/ar-surgical-planning/') : '/',
  plugins: [csp, ...(process.env.VITE_HTTPS ? [basicSsl()] : [])],
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1000 },
  server: { host: true },
  preview: { host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));

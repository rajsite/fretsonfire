import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import fofAssets from './tools/fof-assets.ts';

const pages = fs.existsSync('pages')
  ? fs
      .readdirSync('pages')
      .filter((f) => f.endsWith('.html'))
      .map((f) => path.resolve('pages', f))
  : [];

export default defineConfig({
  root: '.',
  publicDir: false,
  plugins: [fofAssets()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/pyodide/**'] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: [path.resolve('index.html'), ...pages],
    },
  },
});

import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname,
  server: { port: 4731, proxy: { '/api': 'http://127.0.0.1:4730', '/img': 'http://127.0.0.1:4730', '/shot': 'http://127.0.0.1:4730' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});

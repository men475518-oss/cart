import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスで出力する。GitHub Pages のようなサブパス配信（/cart/）でも
  // 自前サーバーのルート配信（/）でも同じビルドがそのまま動く。
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});

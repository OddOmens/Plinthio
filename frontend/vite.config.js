import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    // Only this computer by default: the dev server has no sign-in of its own and serves the
    // source tree. To try a build from a phone on your network: VITE_HOST=0.0.0.0 npm run dev
    host: process.env.VITE_HOST || '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // During development the hub runs separately: npm run hub
    proxy: { '/api': 'http://localhost:8080' },
  },
});

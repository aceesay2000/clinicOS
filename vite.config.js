import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // During development the API runs separately:
    proxy: { '/api': 'http://localhost:8080' }, // npm run serve
  },
});

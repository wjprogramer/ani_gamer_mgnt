import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEFAULT_SERVER_URL } from '@agm/shared';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': DEFAULT_SERVER_URL,
      '/covers': DEFAULT_SERVER_URL,
    },
  },
});

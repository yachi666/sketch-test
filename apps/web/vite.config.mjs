import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    include: ['react', 'react-dom/client'],
  },
  server: {
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
  plugins: [react()],
});

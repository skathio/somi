import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served as a GitHub Pages project site at https://skathio.github.io/somi/, hence the base path.
export default defineConfig({
  base: '/somi/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});

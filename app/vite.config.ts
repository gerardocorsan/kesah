import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    // The Rust API runs on its own port; the browser sees one origin.
    proxy: { '/api': 'http://localhost:8080' },
  },
});

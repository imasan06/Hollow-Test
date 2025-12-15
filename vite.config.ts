import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Proxy for API requests to avoid CORS issues in development
    proxy: {
      '/api': {
        target: 'https://hollow-backend.fly.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: [
        // Capacitor plugins are native and should not be bundled
        // They are resolved at runtime in Capacitor's native context
        '@capacitor/preferences',
        '@capacitor/core',
        '@capacitor-community/bluetooth-le',
        '@capacitor-community/http',
      ],
    },
  },
}));

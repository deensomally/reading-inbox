import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:" + (process.env.READING_BOX_PORT || "4318"),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "script",
      manifest: {
        name: "Reading Box",
        short_name: "Reading Box",
        description: "A local library with four reading depths.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#9b4024",
        theme_color: "#9b4024",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { license: true },
});

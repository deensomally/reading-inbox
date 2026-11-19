import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "script",
      manifest: {
        name: "Reading Inbox",
        short_name: "Reading Inbox",
        description: "A local library with four reading depths.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f7f5f0",
        theme_color: "#faf9f6",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { license: true },
});

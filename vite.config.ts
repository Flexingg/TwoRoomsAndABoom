import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const serverPort = Number(process.env.TWOROOMS_DEV_SERVER_PORT ?? 8791);

export default defineConfig({
  root: ".",
  publicDir: "client/public",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: { "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true } },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Two Rooms and a Boom",
        short_name: "Two Rooms",
        description: "Phones replace the cards, leader cards and timer for Two Rooms and a Boom.",
        start_url: "/play",
        scope: "/",
        display: "standalone",
        background_color: "#111117",
        theme_color: "#111117",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only. Game state is never cached: it is only valid live, over the WebSocket.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/ws/, /^\/healthz/],
      },
    }),
  ],
});

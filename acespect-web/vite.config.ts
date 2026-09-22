import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allows access through the Cloudflare quick tunnel used for live
    // testing off this machine -- its hostname changes every restart, so
    // rather than pin one, this disables Vite's dev-server Host header
    // check entirely. Dev-only, matches how the tunnel is already used.
    allowedHosts: true,
  },
  preview: {
    // Same reasoning as server.allowedHosts above, for the production
    // "start" script (vite preview) -- Railway's public domain proxies
    // requests through with its own Host header, which vite preview
    // would otherwise reject.
    allowedHosts: true,
  },
});

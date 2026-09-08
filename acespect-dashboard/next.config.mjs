/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allows access through the Cloudflare quick tunnel used for live testing
  // off this machine -- its hostname changes every restart, so a wildcard
  // rather than pinning one. Dev-only; Next's own cross-origin dev-request
  // guard would otherwise reject requests carrying the tunnel's hostname,
  // the same class of issue acespect-web's Vite dev server had.
  allowedDevOrigins: ['*.trycloudflare.com'],
};
export default nextConfig;

import type { NextConfig } from "next";

// NEXT_DIST_DIR lets a check build run next to a live dev server without overwriting its .next folder.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Deals were at /orders: older links (notifications, bookmarks) still open.
  async redirects() {
    return [{ source: "/orders/:path*", destination: "/deals/:path*", permanent: false }];
  },
};

export default nextConfig;

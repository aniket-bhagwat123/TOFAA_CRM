import type { NextConfig } from "next";

// NEXT_DIST_DIR lets a check build run next to a live dev server without overwriting its .next folder.
const nextConfig: NextConfig = { reactStrictMode: true, distDir: process.env.NEXT_DIST_DIR || ".next" };

export default nextConfig;

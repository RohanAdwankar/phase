import type { NextConfig } from "next";

// a static site: `npm run build` writes ./out, which github pages serves under /phase (NEXT_PUBLIC_BASE=/phase)
const base = process.env.NEXT_PUBLIC_BASE ?? ""
const nextConfig: NextConfig = {
  output: "export",
  basePath: base,
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;

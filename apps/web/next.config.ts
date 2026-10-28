import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const api = process.env.API_URL || (isProd ? "" : "http://localhost:8787");
if (!api) {
  throw new Error("API_URL is not set. Set it to the API base URL (no trailing slash) to build.");
}

const config: NextConfig = {
  // The build type-checks app code only; test/ runs under Bun with its own types (bun run typecheck).
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Lets `next dev` serve through an https tunnel (PayPal login needs an https return URL).
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Bun's isolated install gives the Bryntum React wrapper no path to the aliased core package,
  // so its bare `@bryntum/scheduler` import is pointed at the one this app installs.
  turbopack: {
    resolveAlias: { "@bryntum/scheduler": "./node_modules/@bryntum/scheduler/scheduler.module.js" },
  },
  // Production builds use webpack (Turbopack's build outgrows the 8 GB build machine), so it gets the same alias.
  webpack: (cfg) => {
    cfg.resolve.alias["@bryntum/scheduler$"] = path.resolve(
      "node_modules/@bryntum/scheduler/scheduler.module.js",
    );
    return cfg;
  },
  // Sized for the 2-core build machine; a custom webpack hook turns the build worker off unless asked.
  experimental: { cpus: 2, webpackBuildWorker: true, webpackMemoryOptimizations: true },
  // The landing art is high-resolution WebP; each visitor gets a copy resized for their screen.
  // Resized copies stay cached for 31 days; rename a file in public/ to replace it.
  images: { qualities: [90], minimumCacheTTL: 2678400 },
  // Old `/m/:id` links and PayPal returns already in flight still land.
  async redirects() {
    return [{ source: "/m/:id", destination: "/mandates/:id", permanent: true }];
  },
  // No page is meant to be framed; this blocks clickjacking on every route.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default config;

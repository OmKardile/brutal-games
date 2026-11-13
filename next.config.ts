import type { NextConfig } from "next";

// Two build modes share this config:
//  - dynamic (default): standalone server output — SQLite leaderboard, auth,
//    rewards APIs. Used by `bun run build` and any Node/Bun host.
//  - static export (STATIC_EXPORT=1): `next build` with output: 'export' for
//    GitHub Pages. The API routes are excluded from that build (see
//    .github/workflows/deploy-pages.yml) and the client falls back to a
//    per-browser localStorage leaderboard (src/lib/scores-client.ts).
const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        trailingSlash: true,
        images: { unoptimized: true },
        ...(basePath ? { basePath, assetPrefix: basePath } : {}),
      }
    : {
        output: "standalone" as const,
        // legacy game routes -> portal pages (query strings preserved for
        // deep links like /play?wave=5). The static export skips these —
        // there the old routes exist as meta-refresh redirect stub pages.
        async redirects() {
          return [
            { source: "/play", destination: "/games/arena", permanent: true },
            { source: "/stack", destination: "/games/stack", permanent: true },
            { source: "/reflex", destination: "/games/reflex", permanent: true },
            { source: "/dodge", destination: "/games/dodge", permanent: true },
            { source: "/merge", destination: "/games/merge", permanent: true },
          ];
        },
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
};

export default nextConfig;

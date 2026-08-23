import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Avoid stale HTML/JS after deploys (trade-partners and other static routes were cached).
        source:
          "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/receiving",
        destination: "/payments",
        permanent: true,
      },
      {
        source: "/personal-funds",
        destination: "/debt-tracking",
        permanent: true,
      },
      {
        source: "/biz-debt",
        destination: "/debt-tracking",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

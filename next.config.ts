import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/receiving",
        destination: "/payments",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*"],
  experimental: {
    proxyClientMaxBodySize: "1000mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8007"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

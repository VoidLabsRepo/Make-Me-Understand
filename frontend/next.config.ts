import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*"],
  experimental: {
    proxyClientMaxBodySize: "1000mb",
  },
};

export default nextConfig;

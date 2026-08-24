import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@creator-outdoor/config"],
  poweredByHeader: false,
};

export default nextConfig;

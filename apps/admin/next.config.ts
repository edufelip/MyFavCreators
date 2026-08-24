import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@creator-outdoor/config",
    "@creator-outdoor/contracts",
    "@creator-outdoor/domain",
  ],
  poweredByHeader: false,
};

export default nextConfig;

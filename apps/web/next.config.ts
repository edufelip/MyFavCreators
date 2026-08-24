import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artifact.
  transpilePackages: [
    "@creator-outdoor/config",
    "@creator-outdoor/contracts",
    "@creator-outdoor/domain",
  ],
  poweredByHeader: false,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace package shipped as TypeScript source.
  transpilePackages: ["@hubmine/shared"],
  poweredByHeader: false,
};

export default nextConfig;

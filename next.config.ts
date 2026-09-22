import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/search": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/chromium/**/*"
    ]
  }
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments ?? {}),
      asyncWebAssembly: true,
    };
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      module: false,
    };
    return config;
  },
};

export default nextConfig;

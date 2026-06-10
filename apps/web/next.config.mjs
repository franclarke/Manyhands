import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const realReactPath = require.resolve("react");

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  reactStrictMode: true,
  transpilePackages: ["@assistant-ui/react", "@assistant-ui/react-markdown", "@assistant-ui/tap"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-original$": realReactPath,
      "react$": path.resolve(__dirname, "react-shim.js")
    };
    return config;
  }
};

export default nextConfig;

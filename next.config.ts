import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the Node agent SDKs natively; bundling their optional sandbox imports
  // makes Turbopack require unused dependencies such as `ws`.
  serverExternalPackages: [
    "postgres",
    "deepagents",
    "@langchain/core",
    "@langchain/anthropic",
  ],
};

export default nextConfig;

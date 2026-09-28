import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the scaffold free of generated agent-rule files.
  agentRules: false,
};

export default nextConfig;

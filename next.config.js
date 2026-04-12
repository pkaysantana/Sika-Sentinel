import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@hashgraph/sdk"],
  },
  webpack(config) {
    // Alias @splinetool/react-spline to its dist file directly, bypassing
    // the strict exports map which webpack can't resolve under Next.js 14.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@splinetool/react-spline": path.resolve(
        __dirname,
        "node_modules/@splinetool/react-spline/dist/react-spline.js"
      ),
    };
    return config;
  },
};

export default nextConfig;

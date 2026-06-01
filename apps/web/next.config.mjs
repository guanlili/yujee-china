/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@yujee/contracts'],
  // subset-font ships a harfbuzz .wasm; let Node require it at runtime instead
  // of webpack trying (and failing) to bundle the binary. nft still traces it.
  serverExternalPackages: ['subset-font'],
  // Server-only full TTFs (apps/web/fonts/) the /fonts/subset route reads at
  // runtime; without this the file trace misses them and the lambda 500s.
  outputFileTracingIncludes: {
    '/api/v1/fonts/subset': ['./fonts/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

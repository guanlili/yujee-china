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
  async redirects() {
    return [
      // www and the apex both served byte-identical 200s with no canonical, so
      // Google saw two complete copies of the site competing with each other.
      // 308 keeps the method and tells crawlers the apex is the real one.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.yujeeai.com" }],
        destination: "https://yujeeai.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

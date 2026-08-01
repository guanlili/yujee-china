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
      // /about is a grouping segment, not a page. Without this it 404s, which
      // is what a crawler (and anyone who truncates the URL) hits first. 307,
      // not 308: if a real About page is written later this must stop
      // redirecting, and a permanent redirect stays cached in browsers.
      {
        source: "/:locale(en|zh)/about",
        destination: "/:locale/about/story",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

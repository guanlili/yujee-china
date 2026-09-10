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
  // Isolated static chapters; existing account, album and API routes are unchanged.
  async rewrites() {
    return {beforeFiles: [
      {source: '/:locale(en|zh|es|ja|fr)/:chapter(pet|travel|palace)', destination: '/chapters/:locale/:chapter/index.html'},
      {source: '/:chapter(pet|travel|palace)/:asset*', destination: '/chapters/:chapter/:asset*'},
    ], afterFiles: [], fallback: []};
  },
  // 三个篇章暂不进索引。同一份 HTML 目前至少四条路径可达（/zh/pet、/chapters/zh/pet/
  // index.html、/chapters/pet/index.html、/pet/index.html），五种语言又共用同一份中文
  // title/description，而 UI 文案只翻了一部分。在补齐翻译和 canonical/hreflang 之前
  // 让它们被收录，等于把 www/apex 那次重复内容的坑照原样再挖一遍（见下方 redirects 注释）。
  // 翻译和 SEO 补完后删掉这一段即可。
  async headers() {
    const noindex = [{key: 'X-Robots-Tag', value: 'noindex'}];
    return [
      {source: '/chapters/:path*', headers: noindex},
      {source: '/:locale(en|zh|es|ja|fr)/:chapter(pet|travel|palace)', headers: noindex},
      {source: '/:chapter(pet|travel|palace)/:asset*', headers: noindex},
    ];
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

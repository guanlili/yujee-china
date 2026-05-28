/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@yujee/contracts'],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

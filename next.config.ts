import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      // External product catalog images
      { protocol: 'https', hostname: 'catalogospromocionales.com' },
      { protocol: 'https', hostname: '*.catalogospromocionales.com' },
      { protocol: 'https', hostname: 'zoom-publicidad.com' },
      { protocol: 'https', hostname: '*.zoom-publicidad.com' },
      // Allow any HTTPS source (for flexibility with product images)
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;

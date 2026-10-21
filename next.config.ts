import type { NextConfig } from "next";

const slugs = ["dark-chocolate", "carrot", "hazelnut", "peanut-butter"];

const nextConfig: NextConfig = {
  // Short links for Instagram stories and bios, e.g. /hazelnut -> /products/hazelnut.
  // Query strings pass through, so /hazelnut?ref=story still records the source.
  async redirects() {
    return slugs.map((slug) => ({
      source: `/${slug}`,
      destination: `/products/${slug}`,
      permanent: false,
    }));
  },
};

export default nextConfig;

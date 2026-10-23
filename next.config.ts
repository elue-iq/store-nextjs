import type { NextConfig } from "next";

const slugs = ["dark-chocolate", "carrot", "hazelnut", "peanut-butter"];

// Browser security headers on every page.
const securityHeaders = [
  // Only over HTTPS, for a year (also for subdomains).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // No other site may show ÉLUE inside a frame (stops click-jacking of checkout and admin).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Which copy this is, from the Amplify branch: "amplify" = the live site.
  env: { NEXT_PUBLIC_STAGE: process.env.AWS_BRANCH ?? "local" },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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

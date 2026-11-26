import type { MetadataRoute } from "next";
import { products } from "@/lib/products";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/reviews`, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/nutrition`, changeFrequency: "monthly", priority: 0.6 },
    ...products
      .filter((p) => p.nutrition)
      .map((p) => ({ url: `${base}/nutrition/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...products.map((p) => ({
      url: `${base}/products/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      images: p.image ? [`${base}${p.image}`] : undefined,
    })),
  ];
}

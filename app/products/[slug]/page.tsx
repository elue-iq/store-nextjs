import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, products, sharedPoints } from "@/lib/products";
import { formatIQD, siteUrl } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { ProductBuyBox } from "@/components/AddToCart";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) return {};
  const title = `${product.nameEn} Truffles`;
  const description = `${product.nameAr}: ${product.kcalPerPiece} سعرة معدل القطعة، بدون سكر مضاف. ${formatIQD(product.price)} للعلبة.`;
  const images = product.image ? [{ url: product.image, width: 1400, height: 1400, alt: `ÉLUE ${product.nameEn}` }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: { title: `ÉLUE ${title}`, description, type: "website", locale: "ar_IQ", images },
    twitter: { card: "summary_large_image", images: product.image ? [product.image] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  const others = products.filter((p) => p.slug !== product.slug);

  // Product details for Google (price, availability, photo).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `ÉLUE ${product.nameEn} Chocolate Truffles`,
    alternateName: product.nameAr,
    image: product.image ? `${siteUrl()}${product.image}` : undefined,
    description: `${product.taste}. ${product.kcalPerPiece} kcal average piece, no added sugar.`,
    brand: { "@type": "Brand", name: "ÉLUE" },
    offers: {
      "@type": "Offer",
      url: `${siteUrl()}/products/${product.slug}`,
      price: product.price,
      priceCurrency: "IQD",
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <section className="product">
        <div className="product__visual">
          <JarLabel product={product} size="large" preload />
        </div>
        <div className="product__info">
          <Link href="/#flavors" className="back-link">
            كل النكهات
          </Link>
          <h1>{product.nameAr}</h1>
          <p className="product__en" dir="ltr">
            {product.nameEn}
          </p>
          <p className="product__kcal">
            <strong dir="ltr">{product.kcalPerPiece} kcal</strong>
            <span>معدل سعرات القطعة</span>
          </p>
          <p className="product__price">{formatIQD(product.price)} للعلبة</p>
          <ProductBuyBox slug={product.slug} />

          <h2 className="product__subhead">شنو يميّزها؟</h2>
          <ul className="product__points">
            <li>{product.taste}</li>
            {sharedPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
            {product.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          <h2 className="product__subhead">طازجة، ومكانها الثلاجة</h2>
          <p>ما نحفظها بالسكر ولا بالمواد الحافظة، نحفظها بالبرودة.</p>
        </div>
      </section>

      <section className="section others">
        <h2>نكهات ثانية</h2>
        <div className="others__grid">
          {others.map((p) => (
            <Link key={p.slug} href={`/products/${p.slug}`} className="others__item">
              <JarLabel product={p} />
              <span>{p.nameAr}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

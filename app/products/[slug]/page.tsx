import type { Metadata } from "next";
import { Listed, ProductPrice } from "@/components/ProductPrice";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, kcalText, kcalUnitAr, kcalUnitEn, mixParts, products, sharedPoints } from "@/lib/products";
import { formatIQD, siteUrl } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { ProductBuyBox } from "@/components/AddToCart";
import { PixelViewContent } from "@/components/MetaPixel";

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
  const description = product.nutrition
    ? `${product.nameAr}: ${kcalText(product)} سعرة حرارية في المتوسط لكل قطعة، بلا سكر مضاف. ${formatIQD(product.price)} للعلبة.`
    : `${product.nameAr}: ${product.taste}، ${kcalText(product)} سعرة حرارية للقطعة حسب النكهة، بلا سكر مضاف. ${formatIQD(product.price)} للعلبة.`;
  const images = product.image ? [{ url: product.image, width: 1400, height: 1400, alt: `ÉLUE ${product.nameEn}` }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: { title: `ÉLUE ${title}`, description, url: `/products/${product.slug}`, siteName: "ÉLUE", type: "website", locale: "ar_IQ", images },
    twitter: { card: "summary_large_image", images: product.image ? [product.image] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  const others = products.filter((p) => p.slug !== product.slug);
  const parts = mixParts(product); // the flavors inside a mixed jar
  const n = product.nutrition;

  // Product details for Google (price, availability, photo).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `ÉLUE ${product.nameEn} Chocolate Truffles`,
    alternateName: product.nameAr,
    image: product.image ? `${siteUrl()}${product.image}` : undefined,
    description: `${product.taste}. ${kcalText(product)} kcal ${kcalUnitEn(product)}, no added sugar.`,
    brand: { "@type": "Brand", name: "ÉLUE" },
    // Only a single flavor has one label to quote; a mixed jar sends none.
    nutrition: n
      ? {
          "@type": "NutritionInformation",
          servingSize: `3 pieces (${n.servingG} g)`,
          calories: `${n.kcalServing} kcal`,
          fatContent: `${n.fatG} g`,
          saturatedFatContent: `${n.satFatG} g`,
          sodiumContent: `${n.sodiumMg} mg`,
          carbohydrateContent: `${n.carbG} g`,
          fiberContent: `${n.fibreG} g`,
          sugarContent: `${n.sugarsG} g`,
          proteinContent: `${n.proteinG} g`,
        }
      : undefined,
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
            <strong dir="ltr">{kcalText(product)} kcal</strong>
            <span>{kcalUnitAr(product)}</span>
          </p>
          <ProductPrice slug={product.slug} suffix=" للعلبة" className="product__price" />
          <PixelViewContent slug={product.slug} />
          <ProductBuyBox slug={product.slug} />

          <h2 className="product__subhead">ما الذي يميّزها؟</h2>
          <ul className="product__points">
            <li>{product.taste}</li>
            {sharedPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
            {product.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          {n ? (
            <>
              <h2 className="product__subhead">المكونات</h2>
              <p>{n.ingredientsAr}</p>
              <p className="product__allergy">
                <strong>يحتوي على:</strong> {n.containsAr}
              </p>

              <h2 className="product__subhead">القيم الغذائية</h2>
              <figure className="product__label">
                <Image
                  src={n.image}
                  alt={`القيم الغذائية والمكونات: ${product.nameAr}. ${n.kcalServing} سعرة حرارية للحصة (3 حبات)، ${n.kcalPiece} للحبة.`}
                  width={1000}
                  height={1556}
                  sizes="(max-width: 700px) 100vw, 480px"
                />
                <figcaption>
                  الحصة 3 حبات ({n.servingG} غ)، والحبة الواحدة {n.pieceG} غ. القيم تقديرية من مكونات الوصفة.
                </figcaption>
              </figure>
            </>
          ) : (
            <>
              {/* A mixed jar: each piece is one of these flavors, with that flavor's own label. */}
              <h2 className="product__subhead">النكهات داخل العلبة</h2>
              <ul className="product__points">
                {parts.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/products/${p.slug}`}>{p.nameAr}</Link>: <span dir="ltr">{kcalText(p)} kcal</span> متوسط القطعة
                  </li>
                ))}
              </ul>
              <p className="product__allergy">
                <strong>يحتوي على:</strong>{" "}
                {parts.map((p) => `${p.nameAr}: ${p.nutrition?.containsAr ?? ""}`).join(" ")}
              </p>
              <p>المكونات والقيم الغذائية الكاملة لكل نكهة في صفحتها.</p>
            </>
          )}

          <h2 className="product__subhead">طازجة، ومكانها الثلاجة</h2>
          <p>لا تحتوي على سكر مضاف ولا على مواد حافظة، لذلك نحفظها بالتبريد.</p>
        </div>
      </section>

      <section className="section others">
        <h2>نكهات أخرى</h2>
        <div className="others__grid">
          {others.map((p) => (
            <Listed key={p.slug} slug={p.slug}>
              <Link href={`/products/${p.slug}`} className="others__item">
                <JarLabel product={p} />
                <span>{p.nameAr}</span>
              </Link>
            </Listed>
          ))}
        </div>
      </section>
    </>
  );
}

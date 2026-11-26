import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getProduct, products, type Nutrition } from "@/lib/products";
import { NutritionTop } from "@/components/NutritionTop";
import { NutritionBar } from "@/components/NutritionBar";
import { IconInfo } from "@/components/LinkIcons";

// One flavor's calories, nutrition facts (same numbers as its printed label) and ingredients.
export function generateStaticParams() {
  return products.filter((p) => p.nutrition).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = getProduct(slug);
  if (!p?.nutrition) return {};
  return {
    title: `${p.nameAr}: السعرات والمكونات`,
    description: `${p.nutrition.kcalPiece} سعرة معدل الحبة، ${p.nutrition.kcalServing} للحصة (3 حبات). القيم الغذائية والمكونات.`,
    alternates: { canonical: `/nutrition/${p.slug}` },
  };
}

// Label rows per serving; a sub-row belongs to the row above it.
function rows(n: Nutrition) {
  const g = (v: number) => (v === 0 || !Number.isInteger(v) ? String(v) : v.toFixed(1));
  return [
    { label: "الدهون", value: g(n.fatG), unit: "غ" },
    { label: "منها مشبعة", value: g(n.satFatG), unit: "غ", sub: true },
    { label: "الكربوهيدرات", value: g(n.carbG), unit: "غ" },
    { label: "الألياف", value: g(n.fibreG), unit: "غ", sub: true },
    { label: "السكريات", value: g(n.sugarsG), unit: "غ", sub: true },
    { label: "سكر مضاف", value: g(n.addedSugarsG), unit: "غ", sub: true },
    { label: "مالتيتول", value: g(n.maltitolG), unit: "غ", sub: true },
    { label: "البروتين", value: g(n.proteinG), unit: "غ" },
    { label: "الصوديوم", value: String(n.sodiumMg), unit: "ملغ" },
  ];
}

export default async function FlavorNutritionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = getProduct(slug);
  if (!p?.nutrition) notFound();
  const n = p.nutrition;
  const ingredients = n.ingredientsAr.replace(/[.،\s]+$/, "").split(/،\s*/);

  return (
    <div className="lk">
      <NutritionTop back />
      {p.image && (
        <Image className="nf-hero" src={p.image} alt={p.nameAr} width={800} height={800} sizes="(max-width: 560px) 100vw, 520px" priority />
      )}
      <div className="nf-name">
        <h1>{p.nameAr}</h1>
        <span className="nf-card__en" dir="ltr">
          {p.nameEn}
        </span>
        <p>{p.taste}</p>
      </div>

      <div className="nf-kcal">
        <div style={{ background: p.band }} className="nf-kcal__piece">
          <strong dir="ltr">{n.kcalPiece}</strong>
          <span>سعرة · معدل الحبة</span>
        </div>
        <div className="nf-kcal__serving">
          <strong dir="ltr">{n.kcalServing}</strong>
          <span>سعرة · الحصة (3 حبات)</span>
        </div>
      </div>

      <section className="nf-facts" aria-labelledby="facts-title">
        <h2 id="facts-title">القيم الغذائية</h2>
        <p>
          للحصة: 3 حبات (<span dir="ltr">{n.servingG}</span> غ)
        </p>
        <dl>
          <div className="nf-facts__row nf-facts__row--total">
            <dt>السعرات الحرارية</dt>
            <dd>
              <span dir="ltr">{n.kcalServing}</span> سعرة
            </dd>
          </div>
          {rows(n).map((r) => (
            <div key={r.label} className={`nf-facts__row${r.sub ? " nf-facts__row--sub" : ""}`}>
              <dt>{r.label}</dt>
              <dd>
                <span dir="ltr">{r.value}</span> {r.unit}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="nf-ingredients" aria-labelledby="ing-title">
        <h2 id="ing-title">المكونات</h2>
        <ul className="nf-tags nf-tags--plain">
          {ingredients.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="nf-allergy">
          <IconInfo />
          <span>
            <strong>يحتوي على:</strong> {n.containsAr}
          </span>
        </p>
        <p className="nf-note">
          القيم تقديرية من مكونات الوصفة، ووزن الحبات يختلف شوية.{" "}
          <a href={n.image} target="_blank" rel="noopener">
            شوفوا الملصق المطبوع على العلبة
          </a>
        </p>
      </section>

      <NutritionBar slug={p.slug} />
    </div>
  );
}

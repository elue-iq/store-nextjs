import type { Metadata } from "next";
import Image from "next/image";
import { products } from "@/lib/products";
import { FlavorCardLink, NutritionTop } from "@/components/NutritionTop";
import { NutritionBar } from "@/components/NutritionBar";
import { IconForward } from "@/components/LinkIcons";

// Every flavor's calories, nutrition facts and ingredients: the list. Reached from the links
// page (the jar's QR) and from the shop. Each flavor stays here even when it is not on sale,
// since someone may be holding its jar.
export const metadata: Metadata = {
  title: "السعرات والمكونات",
  description: "سعرات كل نكهة من ترافل ÉLUE، والقيم الغذائية والمكونات كما على الملصق.",
  alternates: { canonical: "/nutrition" },
};

const TAGS = ["بلا سكر مضاف", "خضار 60% وأكثر", "بلا مواد حافظة", "مكانها الثلاجة"];

export default function NutritionPage() {
  const flavors = products.filter((p) => p.nutrition);
  return (
    <div className="lk">
      <NutritionTop />
      <div className="nf-intro">
        <h1>شنو داخل علبتكم؟</h1>
        <p>اختاروا النكهة اللي بإيدكم، وتشوفون سعراتها ومكوناتها.</p>
      </div>
      <ul className="nf-list">
        {flavors.map((p, i) => (
          <li key={p.slug}>
            <FlavorCardLink href={`/nutrition/${p.slug}`} className="nf-card">
              {p.image && <Image src={p.image} alt="" width={168} height={168} sizes="84px" priority={i < 4} />}
              <span className="nf-card__text">
                <strong>{p.nameAr}</strong>
                <span className="nf-card__en" dir="ltr">
                  {p.nameEn}
                </span>
                <span className="nf-card__kcal">
                  <span className="nf-chip" style={{ background: p.band }}>
                    <span dir="ltr">{p.kcalPerPiece}</span> سعرة
                  </span>
                  معدل الحبة
                </span>
              </span>
              <IconForward />
            </FlavorCardLink>
          </li>
        ))}
      </ul>
      <p className="nf-mix">علبتكم ميكس؟ كل حبة بيها من وحدة من هالنكهات الأربع.</p>
      <ul className="nf-tags">
        {TAGS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <NutritionBar />
    </div>
  );
}

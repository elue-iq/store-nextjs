import Image from "next/image";
import Link from "next/link";
import { nutNote, products, sharedPoints } from "@/lib/products";
import { formatIQD, site, siteUrl } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { AddToCartButton } from "@/components/AddToCart";
import { DeliverySteps } from "@/components/DeliverySteps";

const ingredients = [
  {
    title: "خضار بنسبة لا تقل عن 60%",
    text: "نحضّرها ونطهوها ونجففها بأيدينا مدة لا تقل عن 12 ساعة، قبل أن تصبح ترافل.",
  },
  { title: "شوكولاتة بلجيكية", text: "شوكولاتة بلجيكية داكنة بلا سكر مضاف." },
  { title: "كاكاو هولندي خام", text: "لطعم غني وعميق." },
  { title: "بدائل سكر إسبانية المنشأ", text: "للتحلية بدلًا من السكر." },
];

// Tells Google who ÉLUE is (name, logo, Instagram, WhatsApp, where it delivers).
const organizationJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ÉLUE",
  alternateName: "إيلو",
  url: siteUrl(),
  logo: `${siteUrl()}/icon.svg`,
  description: "ترافل شوكولاتة قليل السعرات ومحسوبها، بلا سكر مضاف. التوصيل لكل المحافظات.",
  sameAs: [site.instagramUrl],
  contactPoint: [
    { "@type": "ContactPoint", contactType: "customer service", telephone: `+${site.whatsappNumber}`, availableLanguage: ["ar", "en"] },
  ],
  areaServed: { "@type": "City", name: "Baghdad" },
});

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()).replace(/</g, "\\u003c") }}
      />
      <section className="hero">
        <div className="hero__media">
          <Image
            src="/hero/truffle-fork.jpg"
            alt="ترافل ÉLUE بالشوكولاتة الداكنة على شوكة، والشوكولاتة تقطر منه"
            fill
            priority
            sizes="(max-width: 900px) 100vw, 50vw"
            className="hero__img"
          />
        </div>

        <div className="hero__content">
          <h1>سعرات قليلة ومتعة أكبر</h1>
          <p className="hero__lede">
            أول براند عراقي جوكلت ترافلز بدون سكر مضاف.
          </p>
          <div className="hero__actions">
            <a className="btn btn--light" href="#flavors">
              اطلب الان
            </a>
          </div>

          <ul className="hero__flavors" aria-label="النكهات وسعرات القطعة">
            {products.map((p) => (
              <li key={p.slug}>
                <Link href={`/products/${p.slug}`} dir="ltr">
                  <span>{p.nameEn}</span>
                  <strong>{p.kcalPerPiece} kcal</strong>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="flavors" className="section flavors">
        <div className="section__head">
          <h2>النكهات</h2>
        </div>
        <div className="flavors__grid">
          {products.map((p, i) => (
            <article key={p.slug} className="flavor">
              <Link href={`/products/${p.slug}`} className="flavor__visual" aria-label={`${p.nameAr}: التفاصيل`}>
                <JarLabel product={p} preload={i < 2} />
              </Link>
              <div className="flavor__meta">
                <h3>
                  <Link href={`/products/${p.slug}`}>{p.nameAr}</Link>
                </h3>
                <p className="flavor__price">{formatIQD(p.price)}</p>
              </div>
              <AddToCartButton slug={p.slug} />
            </article>
          ))}
        </div>
      </section>

      <section className="section story">
        <div className="story__copy">
          <p>بدأت قصة الترافل بفرنسا قبل أكثر من 100 سنة، وانتشرت بسبب قوامها اللي يذوب بالفم.</p>
          <p>
            وبـ<span dir="ltr">ÉLUE</span> عدنا تعريف هاي اللذّة على طريقتنا، فجمعنا الطعم الغني والقوام الكريمي مع
            السعرات المحسوبة.
          </p>
        </div>
        <ul className="story__points">
          {sharedPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="section ingredients" aria-labelledby="ingredients-title">
        <div className="section__head">
          <h2 id="ingredients-title">
            ماذا يوجد في <span dir="ltr">ÉLUE</span>؟
          </h2>
          <p>مكونات قليلة، ولكلٍّ منها سبب.</p>
        </div>
        <div className="ingredients__grid">
          {ingredients.map((item) => (
            <div key={item.title} className="ingredient">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
        <div className="ingredients__flavors">
          <p className="ingredients__allergy">
            <strong>تنبيه للحساسية:</strong> {nutNote}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="fridge-title">
        <div className="fridge">
          <div className="fridge__head">
            <h2 id="fridge-title">بكل فخر!</h2>
            <p className="fridge__lede">الترافل يتلف برّا الثلاجة… بس ليش؟</p>
          </div>
          <div className="fridge__body">
            <p className="fridge__close">
              لأن ما بيه سكر مضاف، ولا دهون، ولا مواد حافظة، وهي نفسها الأشياء اللي تخلّي الأكل يصمد برّا الثلاجة.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="kids-title">
        <div className="kids">
          <h2 id="kids-title">لأطفالك: بدون حيرة</h2>
          <div className="kids__body">
            <p>كل أهل يعرفون هالحيرة: تنطي طفلك حلو ويبقى بالك بشنو بيه، ما تنطيه ويزعل.</p>
            <p>
              ترافل <span dir="ltr">ÉLUE</span> يخلّص هالحيرة: بدون سكر مضاف، بدون مواد حافظة، وبيه خضار بنسبة ما تقل عن
              60% نحضّرها بإيدينا. قطعة يفرح بيها طفلك، وإنت مرتاح من كل شي بيها.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="delivery-title">
        <div className="section__head">
          <h2 id="delivery-title">كيف يوصلك طلبك؟</h2>
          <p>
            من الطلب إلى البراد بأربع خطوات. الدفع نقداً عند الاستلام، وأجور التوصيل {formatIQD(site.deliveryFee)}.
          </p>
        </div>
        <DeliverySteps />
      </section>

      <section className="section cta">
        <a className="btn" href="#flavors">
          اطلب الان
        </a>
      </section>
    </>
  );
}

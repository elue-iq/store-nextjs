import Image from "next/image";
import Link from "next/link";
import { products, sharedPoints } from "@/lib/products";
import { formatIQD, site } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { AddToCartButton } from "@/components/AddToCart";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero__media">
          <Image
            src="/hero/truffle-fork.jpg"
            alt="ترافل ÉLUE دارك چوكليت على شوكة والشوكولاتة تقطر منه"
            fill
            preload
            sizes="(max-width: 900px) 100vw, 50vw"
            className="hero__img"
          />
        </div>

        <div className="hero__content">
          <p className="hero__brand" dir="ltr">
            ÉLUE Chocolate Truffles
          </p>
          <h1>متعة الشوكولاتة، بحسابات أذكى</h1>
          <p className="hero__lede">
            أول براند ترافلز شوكولاتة قليل ومحسوب السعرات بالعراق. بدون سكر مضاف، وسعرات كل قطعة مكتوبة على العلبة.
          </p>
          <div className="hero__actions">
            <a className="btn btn--light" href="#flavors">
              اختاروا نكهتكم
            </a>
            <a className="btn btn--outline-light" href="#how">
              طريقة الطلب
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
          <p>كل النكهات بنفس السعر: {formatIQD(products[0].price)} للعلبة.</p>
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
          <h2>حكاية الترافلز، بطريقتنا</h2>
          <p>
            من فرنسا، وتحديداً من أواخر القرن التاسع عشر، بدأت حكاية الترافلز: حلوى الشوكولاتة الفاخرة اللي تخطف القلب من
            أول قطعة.
          </p>
          <p>
            بـ<span dir="ltr">ÉLUE</span> أعدنا تعريف هاللذّة بطريقتنا. جمعنا الطعم الغني والقوام الكريمي مع السعرات
            المحسوبة، حتى تستمتعون بكل قطعة وإنتو تعرفون شنو تختارون، وبدون ما تتنازلون عن اختياراتكم الغذائية.
          </p>
        </div>
        <ul className="story__points">
          {sharedPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="section calc">
        <h2>ليش مكتوب «معدل القطعة»؟</h2>
        <p>
          نحسب سعرات الوصفة كاملة، مكوّن مكوّن، ونقسمها على عدد القطع. أوزان القطع متقاربة بس مو متطابقة، لهذا نكتب
          المعدّل بدل رقم ثابت لكل قطعة.
        </p>
      </section>

      <section className="section notes">
        <div className="note">
          <h3>12 ساعة على الأقل، بكل حب</h3>
          <p>نحضّر الخضار ونطبخها ونجففها بأيدينا قبل ما تصير ترافلز.</p>
        </div>
        <div className="note">
          <h3>طازجة، ومكانها الثلاجة</h3>
          <p>ما نحفظها بالسكر ولا بالمواد الحافظة، نحفظها بالبرودة.</p>
        </div>
        <div className="note">
          <h3>خيار تطمّنون بيه لعائلتكم</h3>
          <p>اهتمينا بكل تفصيلة فيها، من المكونات إلى السعرات، حتى تقدمونها لعائلتكم وإنتو مرتاحين.</p>
        </div>
      </section>

      <section id="how" className="section how">
        <h2>طريقة الطلب</h2>
        <ol className="how__steps">
          <li>اختاروا النكهات وضيفوها للسلة.</li>
          <li>اكتبوا اسمكم ورقم الواتساب والعنوان.</li>
          <li>أكدوا الطلب بالرمز اللي يوصلكم على الواتساب، ونتواصل وياكم للتوصيل.</li>
        </ol>
        <p className="how__note">{site.paymentNote}.</p>
        <Link className="btn" href="/order">
          افتح السلة
        </Link>
      </section>

      <section className="closing">
        <p className="closing__lead">مو مجرد ترافلز شوكولاتة…</p>
        <p className="closing__line">هي لحظة إلكم، وقطعة تشاركونها ويا أحبابكم.</p>
      </section>
    </>
  );
}

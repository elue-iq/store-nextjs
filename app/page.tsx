import Image from "next/image";
import Link from "next/link";
import { nutNote, products, sharedPoints } from "@/lib/products";
import { formatIQD, site } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { AddToCartButton } from "@/components/AddToCart";

const ingredients = [
  {
    title: "خضار، ما لا يقل عن 60%",
    text: "نحضّرها ونطبخها ونجففها بأيدينا، 12 ساعة على الأقل، قبل ما تصير ترافلز.",
  },
  { title: "شوكولاتة بلجيكية", text: "دارك شوكولاتة بلجيكية بدون سكر مضاف." },
  { title: "كاكاو هولندي خام", text: "للطعم الغني والعميق." },
  { title: "بدائل سكر إسبانية المنشأ", text: "للحلاوة، بدل السكر." },
];

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
          <h1>متعة الشوكولاتة، بحسابات أذكى</h1>
          <p className="hero__lede">
            أول براند ترافلز شوكولاتة قليل ومحسوب السعرات بالعراق. بدون سكر مضاف، بدون دهون أو زبدة مضافة، وبدون مواد
            حافظة.
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

      <section className="section ingredients" aria-labelledby="ingredients-title">
        <div className="section__head">
          <h2 id="ingredients-title">
            شنو بداخل <span dir="ltr">ÉLUE</span>
          </h2>
          <p>مكونات قليلة، وكل وحدة إلها سبب.</p>
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
          <h3>مكونات كل نكهة</h3>
          <dl>
            {products.map((p) => (
              <div key={p.slug}>
                <dt>
                  <Link href={`/products/${p.slug}`}>{p.nameAr}</Link>
                </dt>
                <dd>{p.ingredients.join("، ")}</dd>
              </div>
            ))}
          </dl>
          <p className="ingredients__allergy">
            <strong>للحساسية:</strong> {nutNote}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="fridge-title">
        <div className="fridge">
          <div className="fridge__head">
            <h2 id="fridge-title">
              يخرب برّا البراد،
              <br />
              ونقولها بفخر
            </h2>
            <p className="fridge__lede">لأن الشي اللي يخلي الحلو يعيش أسابيع على الرف، إحنا ما نحطه.</p>
          </div>
          <div className="fridge__body">
            <p>
              كل أكل بيه ماي، والماي «الحر» بالأكل هو اللي تعيش عليه البكتيريا والعفن. العلماء يقيسونه بشي اسمه{" "}
              <strong>النشاط المائي</strong>: كل ما قل الماي الحر، عاش الأكل أطول برّا البراد.
            </p>
            <ul className="fridge__list">
              <li>
                <strong>السكر</strong>
                <span>يمسك جزيئات الماي ويربطها، فما يبقى ماي حر للبكتيريا. لهذا المربى يعيش شهور.</span>
              </li>
              <li>
                <strong>الزبدة والدهون</strong>
                <span>تاخذ مكان الماي بالوصفة، فيقل الماي من الأساس.</span>
              </li>
              <li>
                <strong>المواد الحافظة</strong>
                <span>توقف البكتيريا اللي تحاول تعيش على الماي الباقي.</span>
              </li>
            </ul>
            <p className="fridge__close">
              ترافلز <span dir="ltr">ÉLUE</span> ما بيها سكر مضاف، ولا دهون أو زبدة مضافة، ولا مواد حافظة، وما لا يقل
              عن 60% منها خضار. ما عدنا شي يحفظها غير البرودة، لهذا مكانها الثلاجة.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="kids-title">
        <div className="kids">
          <h2 id="kids-title">لأطفالكم: حلو بدون حيرة</h2>
          <div className="kids__body">
            <p>الأطفال مظلومين ويا الحلو: تنطوهم ويبقى بالكم باللي بيه، ما تنطوهم ويزعلون. حيرة يعرفها كل أهل.</p>
            <p>
              ترافلز <span dir="ltr">ÉLUE</span> تخلّص هالحيرة: بدون سكر مضاف، وبدون مواد حافظة، وما لا يقل عن 60% منها
              خضار نحضّرها بأيدينا. قطعة يفرح بيها طفلكم، وإنتو مطمّنين على كل شي بيها.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="section how">
        <h2>طريقة الطلب</h2>
        <ol className="how__steps">
          <li>اختاروا النكهات وضيفوها للسلة.</li>
          <li>اكتبوا اسمكم الكامل ورقم الواتساب والعنوان.</li>
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

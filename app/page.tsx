import Image from "next/image";
import Link from "next/link";
import { nutNote, products, sharedPoints } from "@/lib/products";
import { formatIQD, site } from "@/lib/site";
import { JarLabel } from "@/components/JarLabel";
import { AddToCartButton } from "@/components/AddToCart";

const ingredients = [
  {
    title: "خضار بنسبة لا تقل عن 60%",
    text: "نحضّرها ونطهوها ونجففها بأيدينا مدة لا تقل عن 12 ساعة، قبل أن تصبح ترافل.",
  },
  { title: "شوكولاتة بلجيكية", text: "شوكولاتة بلجيكية داكنة بلا سكر مضاف." },
  { title: "كاكاو هولندي خام", text: "لطعم غني وعميق." },
  { title: "بدائل سكر إسبانية المنشأ", text: "للتحلية بدلًا من السكر." },
];

export default function Home() {
  return (
    <>
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
          <h1>متعة الشوكولاتة، بحسابات أذكى</h1>
          <p className="hero__lede">
            أول علامة عراقية لترافل الشوكولاتة قليل السعرات ومحسوبها. بلا سكر مضاف، ولا دهون أو زبدة مضافة، ولا مواد
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
          <p>جميع النكهات بالسعر نفسه: {formatIQD(products[0].price)} للعلبة.</p>
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
          <h2>حكاية الترافل، على طريقتنا</h2>
          <p>
            بدأت حكاية الترافل في فرنسا أواخر القرن التاسع عشر: حلوى شوكولاتة فاخرة تأسر القلب من القطعة الأولى.
          </p>
          <p>
            وفي <span dir="ltr">ÉLUE</span> أعدنا تعريف هذه اللذّة على طريقتنا، فجمعنا الطعم الغني والقوام الكريمي مع
            السعرات المحسوبة، لتستمتعوا بكل قطعة وأنتم تعرفون ما تختارون، دون التنازل عن خياراتكم الغذائية.
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
            <strong>تنبيه للحساسية:</strong> {nutNote}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="fridge-title">
        <div className="fridge">
          <div className="fridge__head">
            <h2 id="fridge-title">
              يفسد خارج الثلاجة،
              <br />
              ونقولها بفخر
            </h2>
            <p className="fridge__lede">لأن ما يُبقي الحلوى أسابيع على الرف، لا نضعه فيها.</p>
          </div>
          <div className="fridge__body">
            <p>
              يحتوي كل طعام على الماء، والماء «الحر» فيه هو ما تعيش عليه البكتيريا والعفن. ويقيسه العلماء بما يُسمّى{" "}
              <strong>النشاط المائي</strong>: كلما قلّ الماء الحر، بقي الطعام صالحًا مدة أطول خارج الثلاجة.
            </p>
            <ul className="fridge__list">
              <li>
                <strong>السكر</strong>
                <span>يرتبط بجزيئات الماء فلا يبقى ماء حر للبكتيريا، ولهذا يدوم المربى شهورًا.</span>
              </li>
              <li>
                <strong>الزبدة والدهون</strong>
                <span>تحلّ محل الماء في الوصفة، فتقلّ كميته من الأساس.</span>
              </li>
              <li>
                <strong>المواد الحافظة</strong>
                <span>تمنع البكتيريا من العيش على ما تبقّى من الماء.</span>
              </li>
            </ul>
            <p className="fridge__close">
              ترافل <span dir="ltr">ÉLUE</span> خالٍ من السكر المضاف والدهون والزبدة المضافة والمواد الحافظة، ولا تقل نسبة
              الخضار فيه عن 60%. لا شيء يحفظه سوى البرودة، ولهذا مكانه الثلاجة.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="kids-title">
        <div className="kids">
          <h2 id="kids-title">لأطفالكم: حلوى بلا حيرة</h2>
          <div className="kids__body">
            <p>يعيش الأهل حيرة مع الحلوى: إن قدّموها لأطفالهم انشغل بالهم بما فيها، وإن منعوها حزن الأطفال. حيرة يعرفها كل بيت.</p>
            <p>
              ترافل <span dir="ltr">ÉLUE</span> يُنهي هذه الحيرة: بلا سكر مضاف، وبلا مواد حافظة، وخضار نحضّرها بأيدينا بنسبة
              لا تقل عن 60%. قطعة يفرح بها طفلكم، وأنتم مطمئنون إلى كل ما فيها.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="section how">
        <h2>طريقة الطلب</h2>
        <ol className="how__steps">
          <li>اختاروا النكهات وأضيفوها إلى السلة.</li>
          <li>سجّلوا الدخول برقم الواتساب، برمز يصلكم مرة واحدة فقط.</li>
          <li>أكّدوا عنوان التوصيل وأرسلوا الطلب، وسنتواصل معكم لترتيب التوصيل.</li>
        </ol>
        <p className="how__note">{site.paymentNote}.</p>
        <Link className="btn" href="/order">
          افتحوا السلة
        </Link>
      </section>

      <section className="closing">
        <p className="closing__lead">ليست مجرد ترافل شوكولاتة…</p>
        <p className="closing__line">إنها لحظة لكم، وقطعة تتشاركونها مع أحبّائكم.</p>
      </section>
    </>
  );
}

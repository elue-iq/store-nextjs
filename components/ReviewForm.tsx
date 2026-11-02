"use client";

import { useState } from "react";
import { dataClient, errorCode } from "@/lib/data";
import { RATING_FACES, RATING_WORDS, REVIEW_MAX_COMMENT, REVIEW_TEXT, type ReviewKind } from "@/lib/reviews";

// One truffle (taste) or one parcel (delivery): filled when chosen.
function Icon({ kind, filled }: { kind: ReviewKind; filled: boolean }) {
  return kind === "taste" ? (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="rating__icon">
      <circle cx="24" cy="26" r="15" className={filled ? "is-fill" : undefined} />
      <path d="M17 20c2-3 5-4 8-4" className="rating__shine" />
      <circle cx="31" cy="31" r="1.4" className="rating__dust" />
      <circle cx="25" cy="34" r="1.2" className="rating__dust" />
      <circle cx="33" cy="25" r="1.1" className="rating__dust" />
      <path d="M24 10v-3" className="rating__stem" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="rating__icon">
      <path d="M8 17l16-8 16 8v18l-16 8-16-8z" className={filled ? "is-fill" : undefined} />
      <path d="M8 17l16 8 16-8M24 25v18" className="rating__shine" />
    </svg>
  );
}

// Five tappable icons with a word that changes as you choose (a small, playful touch).
function Rating({
  kind,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  kind: ReviewKind;
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  error?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  function onKey(e: React.KeyboardEvent) {
    // The row reads right to left (1 on the right), so the left arrow goes up.
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(Math.min(5, (value || 0) + 1));
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(Math.max(1, (value || 2) - 1));
    else return;
    e.preventDefault();
  }
  return (
    <fieldset className={`rating${error ? " has-error" : ""}`}>
      <legend>
        <strong>{label}</strong>
        <small>{hint}</small>
      </legend>
      <div className="rating__row" role="radiogroup" aria-label={label} onKeyDown={onKey} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} من 5: ${RATING_WORDS[kind][n - 1]}`}
            tabIndex={value === n || (!value && n === 1) ? 0 : -1}
            className={`rating__btn${n <= shown ? " is-on" : ""}${value === n ? " is-picked" : ""}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
          >
            <Icon kind={kind} filled={n <= shown} />
            <span className="rating__num" aria-hidden="true">
              {n}
            </span>
          </button>
        ))}
      </div>
      {/* Which end is which: 1 (right) is the worst, 5 (left) is the best. */}
      <div className="rating__ends" aria-hidden="true">
        <span>الأسوأ</span>
        <span>الأفضل</span>
      </div>
      <p className="rating__word" aria-live="polite" data-set={shown ? "1" : "0"}>
        {shown ? (
          <span key={shown}>
            {RATING_FACES[shown - 1]} {RATING_WORDS[kind][shown - 1]}
          </span>
        ) : (
          <span className="rating__word--empty">اضغط لتقييمك</span>
        )}
      </p>
      {error && <p className="field-error">اختر تقييمك من 1 إلى 5.</p>}
    </fieldset>
  );
}

// The review form: delivery, taste, an optional note, and the transparency promise.
// Used on /review and, when a delivered order is waiting for its review, at checkout.
export function ReviewForm({
  orderNumber,
  intro,
  onDone,
}: {
  orderNumber: string;
  intro?: string;
  onDone: (result: { delivery: number; taste: number }) => void;
}) {
  const [delivery, setDelivery] = useState(0);
  const [taste, setTaste] = useState(0);
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!delivery || !taste || busy) return;
    setBusy(true);
    setError("");
    try {
      const { errors } = await dataClient.mutations.submitReview({ orderNumber, delivery, taste, comment: comment.trim() || undefined });
      const code = errorCode(errors);
      if (!errors?.length || code === "already_reviewed") return onDone({ delivery, taste });
      setError(
        code === "not_delivered"
          ? "هذا الطلب لسا ما وصل. تقدر تقيّمه بعد التوصيل."
          : code === "not_signed_in"
            ? "انتهت جلسة الدخول. سجّل الدخول مجددًا ثم أرسل تقييمك."
            : "تعذّر إرسال التقييم. حاول مرة ثانية.",
      );
    } catch (err) {
      console.error("review failed", err);
      setError("تعذّر إرسال التقييم. تأكد من الاتصال وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="review" onSubmit={submit} noValidate>
      <header className="review__head">
        <p className="review__order" dir="ltr">
          {orderNumber}
        </p>
        <h2>{REVIEW_TEXT.title}</h2>
        <p>{intro ?? REVIEW_TEXT.intro}</p>
      </header>

      <Rating
        kind="delivery"
        label={REVIEW_TEXT.delivery}
        hint={REVIEW_TEXT.deliveryHint}
        value={delivery}
        onChange={setDelivery}
        error={tried && !delivery}
      />
      <Rating kind="taste" label={REVIEW_TEXT.taste} hint={REVIEW_TEXT.tasteHint} value={taste} onChange={setTaste} error={tried && !taste} />

      <label className="review__note">
        <span>{REVIEW_TEXT.noteLabel}</span>
        <textarea
          value={comment}
          maxLength={REVIEW_MAX_COMMENT}
          rows={3}
          placeholder={REVIEW_TEXT.notePlaceholder}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>

      <aside className="review__promise">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.500-7-10V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <div>
          <strong>{REVIEW_TEXT.transparencyTitle}</strong>
          <p>{REVIEW_TEXT.transparency}</p>
        </div>
      </aside>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--full" disabled={busy}>
        {busy ? "جارٍ الإرسال…" : REVIEW_TEXT.submit}
      </button>
    </form>
  );
}

// After sending: a warm thank-you that answers the ratings.
export function ReviewThanks({ delivery, taste, children }: { delivery?: number; taste?: number; children?: React.ReactNode }) {
  const low = (delivery ?? 5) <= 2 || (taste ?? 5) <= 2;
  return (
    <div className="review review--thanks">
      <div className="review__burst" aria-hidden="true">
        {["🤎", "🍫", "🤎", "✨", "🍫"].map((e, i) => (
          <span key={i} style={{ animationDelay: `${i * 90}ms` }}>
            {e}
          </span>
        ))}
      </div>
      <h2>{REVIEW_TEXT.thanks}</h2>
      <p>
        {low
          ? "آسفين إن التجربة ما كانت بالمستوى. قرأنا ملاحظتك ونشتغل عليها، وتنعرض بالشفافية نفسها."
          : "رأيك يوصل لفريقنا كل يوم، وينعرض بالشفافية الكاملة بين تقييمات الزبائن."}
      </p>
      {children}
    </div>
  );
}

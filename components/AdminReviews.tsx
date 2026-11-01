"use client";

import { useEffect, useMemo, useState } from "react";
import { ReviewSummary, Stars, type ReviewRow } from "./ReviewStats";
import { dataClient } from "@/lib/data";
import { average, fmtAvg } from "@/lib/reviews";
import { getProduct } from "@/lib/products";
import { chatUrl } from "@/lib/share";

const dateOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short" }).format(new Date(iso));

// The team's view of the reviews: the same text customers see (nothing is editable or
// removable), plus who delivered each order, to compare the delivery companies.
export function AdminReviews({ onOpenOrder }: { onOpenOrder: (orderNumber: string) => void }) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [low, setLow] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all: ReviewRow[] = [];
        let nextToken: string | null | undefined;
        do {
          const res = await dataClient.models.Review.list({ limit: 500, nextToken });
          if (res.errors?.length) throw new Error(res.errors[0].message);
          all.push(...(res.data as unknown as ReviewRow[]));
          nextToken = res.nextToken;
        } while (nextToken);
        if (alive) setRows(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (err) {
        console.error("reviews failed", err);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byCourier = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of rows ?? []) m.set(r.deliveredBy || "غير محدد", [...(m.get(r.deliveredBy || "غير محدد") ?? []), r.delivery]);
    return [...m.entries()].map(([name, v]) => ({ name, n: v.length, avg: average(v) })).sort((a, b) => b.n - a.n);
  }, [rows]);

  if (failed) return <p className="panel-note">تعذّر تحميل التقييمات.</p>;
  if (rows === null) return <p className="panel-loading">جارٍ التحميل…</p>;
  if (rows.length === 0) return <p className="reviews__empty">لسا ما وصلت تقييمات. بعد التوصيل، أرسل للعميل «اطلب من العميل تقييم الطلب» من شاشة الطلب.</p>;

  const shown = low ? rows.filter((r) => r.taste <= 2 || r.delivery <= 2) : rows;
  const lowCount = rows.filter((r) => r.taste <= 2 || r.delivery <= 2).length;

  return (
    <div className="reviews reviews--admin">
      <p className="hint">التقييمات تظهر للزبائن في /reviews كما هي. لا يمكن تعديلها أو حذفها من التطبيق، هذا جزء من وعد الشفافية.</p>
      <ReviewSummary rows={rows} />

      <section className="rv-couriers">
        <h3>التوصيل حسب الشركة</h3>
        <ul>
          {byCourier.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <small>{c.n} تقييم</small>
              <strong dir="ltr">{fmtAvg(c.avg)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <div className="rv-filter" role="group" aria-label="فلتر">
        <button type="button" aria-pressed={!low} onClick={() => setLow(false)}>
          الكل ({rows.length})
        </button>
        <button type="button" aria-pressed={low} onClick={() => setLow(true)}>
          تقييم منخفض ({lowCount})
        </button>
      </div>

      <ul className="reviews__list">
        {shown.map((r) => (
          <li key={r.orderNumber} className="reviews__item">
            <div className="reviews__top">
              <strong>{r.firstName}</strong>
              <button type="button" className="link-button" dir="ltr" onClick={() => onOpenOrder(r.orderNumber)}>
                {r.orderNumber}
              </button>
              <span dir="ltr">{dateOf(r.createdAt)}</span>
            </div>
            <div className="reviews__stars">
              <Stars n={r.taste} label="الطعم" />
              <Stars n={r.delivery} label="التوصيل" />
            </div>
            {r.comment && <p className="reviews__comment">{r.comment}</p>}
            <p className="reviews__flavors">
              {[
                r.deliveredBy,
                (r.flavors ?? [])
                  .map((f) => getProduct(f ?? "")?.nameAr)
                  .filter(Boolean)
                  .join("، "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {(r.taste <= 2 || r.delivery <= 2) && r.phone && (
              <a
                className="btn btn--quiet"
                href={chatUrl(r.phone, `مرحباً ${r.firstName}، قرأنا تقييمك لطلبك ${r.orderNumber} وحابين نسمع منك أكثر ونصلّح الموضوع. 🤎`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                راسل العميل على واتساب
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

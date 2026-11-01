"use client";

import { useEffect, useState } from "react";
import { ReviewSummary, Stars, type ReviewRow } from "./ReviewStats";
import { dataClient } from "@/lib/data";
import { getProduct } from "@/lib/products";

const PUBLIC_FIELDS = ["orderNumber", "delivery", "taste", "comment", "firstName", "flavors", "jars", "createdAt"] as const;

const dateOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short" }).format(new Date(iso));

// /reviews: every review, exactly as customers wrote it. No editing, no deleting.
export function ReviewsView() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all: ReviewRow[] = [];
        let nextToken: string | null | undefined;
        do {
          const res = await dataClient.models.Review.list({ authMode: "apiKey", limit: 500, nextToken, selectionSet: PUBLIC_FIELDS });
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

  return (
    <div className="reviews">
      <header className="reviews__head">
        <h1>تقييمات الزبائن</h1>
        <p className="reviews__promise">
          <strong>شفافية 100%.</strong> ننشر كل تقييم كما وصلنا، بلا تعديل ولا حذف، الحلو والمو حلو. الأسماء الأولى فقط.
        </p>
      </header>

      {failed && <p className="panel-note">تعذّر تحميل التقييمات الآن. حدّث الصفحة وحاول مجددًا.</p>}
      {!failed && rows === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {rows && rows.length === 0 && (
        <p className="reviews__empty">لسا ما وصلتنا تقييمات. أول تقييم راح ينعرض هنا بالضبط كما يوصل.</p>
      )}

      {rows && rows.length > 0 && (
        <>
          <ReviewSummary rows={rows} />
          <ul className="reviews__list">
            {rows.map((r) => (
              <li key={r.orderNumber} className="reviews__item">
                <div className="reviews__top">
                  <strong>{r.firstName}</strong>
                  <span dir="ltr">{dateOf(r.createdAt)}</span>
                </div>
                <div className="reviews__stars">
                  <Stars n={r.taste} label="الطعم" />
                  <Stars n={r.delivery} label="التوصيل" />
                </div>
                {r.comment && <p className="reviews__comment">{r.comment}</p>}
                {r.flavors && r.flavors.length > 0 && (
                  <p className="reviews__flavors">
                    {r.flavors
                      .map((f) => getProduct(f ?? "")?.nameAr)
                      .filter(Boolean)
                      .join("، ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

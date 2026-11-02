"use client";

import { average, fmtAvg } from "@/lib/reviews";

export type ReviewRow = {
  orderNumber: string;
  delivery: number;
  taste: number;
  comment?: string | null;
  firstName: string;
  flavors?: (string | null)[] | null;
  jars?: number | null;
  createdAt: string;
  deliveredBy?: string | null;
  phone?: string | null;
};

// How many ratings of each size (5 down to 1), as bars.
function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => values.filter((v) => v === n).length));
  return (
    <ul className="rv-bars" aria-hidden="true">
      {[5, 4, 3, 2, 1].map((n) => {
        const count = values.filter((v) => v === n).length;
        return (
          <li key={n}>
            <span>{n}</span>
            <i>
              <b style={{ width: `${(count / max) * 100}%` }} />
            </i>
            <em>{count}</em>
          </li>
        );
      })}
    </ul>
  );
}

// The two averages with their distribution (shown on the public page and to the team).
export function ReviewSummary({ rows }: { rows: ReviewRow[] }) {
  const taste = rows.map((r) => r.taste);
  const delivery = rows.map((r) => r.delivery);
  return (
    <div className="rv-summary">
      <p className="rv-summary__count">
        <strong>{rows.length}</strong> {rows.length === 1 ? "تقييم" : "تقييمات"}
      </p>
      <div className="rv-summary__cols">
        <section>
          <h3>الطعم</h3>
          <p className="rv-summary__avg">
            <strong dir="ltr">{fmtAvg(average(taste))}</strong> <small>/ 5</small>
          </p>
          <Bars values={taste} />
        </section>
        <section>
          <h3>التوصيل</h3>
          <p className="rv-summary__avg">
            <strong dir="ltr">{fmtAvg(average(delivery))}</strong> <small>/ 5</small>
          </p>
          <Bars values={delivery} />
        </section>
      </div>
    </div>
  );
}

export function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span className="rv-stars" role="img" aria-label={`${label}: ${n} من 5`}>
      <small>{label}</small>
      <span aria-hidden="true">
        {"●".repeat(n)}
        <i>{"●".repeat(5 - n)}</i> <b dir="ltr">{n}/5</b>
      </span>
    </span>
  );
}

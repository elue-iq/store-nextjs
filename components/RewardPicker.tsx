"use client";

// «نقاطكم»: in the checkout, a signed-in customer's points and the rewards they can use on
// this cart (the server says which work and why the others don't). One reward per order;
// it replaces a discount code.

import Link from "next/link";
import { formatPoints } from "@/lib/loyalty";
import type { Quote } from "./CouponBox";

export function RewardPicker({ quote, selected, onPick }: { quote: Quote | null; selected: string; onPick: (id: string) => void }) {
  const points = quote?.points;
  const rewards = quote?.rewards ?? [];
  if (!points || !rewards.length) return null;
  const picked = quote?.reward;
  const next = rewards.filter((r) => !r.ok && r.points > points.balance).sort((a, b) => a.points - b.points)[0];
  return (
    <section className="reward-pick" aria-label="مكافآت النقاط">
      <div className="reward-pick__head">
        <h3>نقاطكم</h3>
        <strong>
          {formatPoints(points.balance)} <small>نقطة</small>
        </strong>
      </div>
      {next && (
        <div className="reward-pick__next">
          <p>
            باقي <strong>{formatPoints(next.points - points.balance)}</strong> نقطة على «{next.title}»
          </p>
          <span className="points-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.round((points.balance / next.points) * 100))}%` }} />
          </span>
        </div>
      )}
      <ul className="reward-pick__list">
        {rewards.map((r) => {
          const on = selected === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                className={`reward-option${on ? " is-on" : ""}`}
                aria-pressed={on}
                disabled={!r.ok && !on}
                onClick={() => onPick(on ? "" : r.id)}
              >
                <span className="reward-option__title">{r.title}</span>
                <span className="reward-option__cost">{formatPoints(r.points)} نقطة</span>
                {on ? <span className="reward-option__state">مستخدمة · إلغاء</span> : r.ok ? <span className="reward-option__state">استخدموها</span> : null}
              </button>
              {!r.ok && r.reason && r.points <= points.balance && <small className="reward-option__why">{r.reason}</small>}
            </li>
          );
        })}
      </ul>
      {picked && !picked.ok && picked.error && <p className="field-error">{picked.error}</p>}
      {selected && <p className="reward-pick__note">المكافأة تغني عن كود الخصم: وحدة منهم بكل طلب.</p>}
      <Link href="/account#points" className="reward-pick__more">
        كيف تجمعون النقاط
      </Link>
    </section>
  );
}

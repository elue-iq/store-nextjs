"use client";

// «نقاطي» on the account page: the balance (from the server: delivered orders, points the team
// gave, minus rewards used), how far the next reward is, and every reward with a button to use
// it on the next order. lib/loyalty.ts, lib/rewards.ts

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dataClient, type Order } from "@/lib/data";
import { parseJsonResult } from "@/lib/json-result";
import { formatPoints, pointsSummary, type PointsSummary } from "@/lib/loyalty";
import { liveReward, rewardTitle, sortRewards, type Reward } from "@/lib/rewards";
import { getProduct } from "@/lib/products";
import { useCart } from "./CartProvider";

const nameOf = (slug: string) => getProduct(slug)?.nameAr;

export function PointsCard({ orders }: { orders: Order[] | null }) {
  const cart = useCart();
  const router = useRouter();
  const [server, setServer] = useState<PointsSummary | null>(null);
  const [rewards, setRewards] = useState<Reward[] | null>(null);

  useEffect(() => {
    dataClient.queries
      .myPoints({}, { authMode: "userPool" })
      .then(({ data }) => {
        const p = parseJsonResult<PointsSummary>(data);
        if (p && typeof p.balance === "number") setServer(p);
      })
      .catch((err) => console.warn("points could not be loaded", err));
    dataClient.models.Reward.list({ authMode: "userPool", limit: 200 })
      .then(({ data }) => setRewards(sortRewards((data ?? []).filter((r) => liveReward(r)))))
      .catch(() => setRewards([]));
  }, [orders?.length]);

  // The server's numbers (they include points the team gave); the orders' own until then.
  const p = server ?? (orders ? pointsSummary(orders) : null);
  const balance = p?.balance ?? 0;
  const next = (rewards ?? []).filter((r) => r.points > balance).sort((a, b) => a.points - b.points)[0];

  return (
    <section className="points-card" id="points" aria-label="نقاطي">
      <div>
        <span className="points-card__label">نقاطي</span>
        <strong className="points-card__value">
          {p ? formatPoints(balance) : "…"} <small>نقطة</small>
        </strong>
      </div>
      {next && p && (
        <div className="points-card__next">
          <p>
            باقي <strong>{formatPoints(next.points - balance)}</strong> نقطة على «{rewardTitle(next, nameOf)}»
          </p>
          <span className="points-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.round((balance / next.points) * 100))}%` }} />
          </span>
        </div>
      )}
      {rewards && rewards.length > 0 && (
        <ul className="points-rewards">
          {rewards.map((r) => {
            const ok = balance >= r.points;
            const using = cart.rewardId === r.id;
            return (
              <li key={r.id} className={ok ? "is-ok" : undefined}>
                <span className="points-rewards__title">{rewardTitle(r, nameOf)}</span>
                <span className="points-rewards__cost">{formatPoints(r.points)} نقطة</span>
                {ok ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      cart.setRewardId(r.id);
                      router.push("/order");
                    }}
                  >
                    {using ? "بسلتكم ←" : "استخدموها بطلبكم"}
                  </button>
                ) : (
                  <small>باقي {formatPoints(r.points - balance)}</small>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="points-card__note">
        {p && p.pending > 0 && <>{formatPoints(p.pending)} نقطة تنضاف بعد توصيل طلباتكم الحالية. </>}
        تحصلون على 10 نقاط عن كل 1,000 د.ع، وتنضاف بعد توصيل الطلب. النقاط المستخدمة ترجع إذا انلغى الطلب.
      </p>
    </section>
  );
}

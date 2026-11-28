"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { dataClient, type Courier, type Order } from "@/lib/data";
import { collectAmount } from "@/lib/dispatch";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";
import { formatIQD } from "@/lib/site";
import { baghdadDay } from "./AdminOrderRow";
import { orderTime } from "@/lib/order-time";
import { courierFee, feesOf, netFromCourier } from "@/lib/delivery-money";
import { toLatinDigits } from "@/lib/phone";

// «تسوية المندوب»: when a courier comes back, pick him and see everything he took in one
// list: tick what was delivered (or came back) and confirm all at once, then settle the cash.
// Settling: the company hands over what it collected minus its fee for each order
// (lib/delivery-money); a far order's fee can be changed right in the list. The amount is
// recorded on each order (courierSettledAmount), so the accounts add up to what was received.
// Boxy and Modon are settled the same way when they pay out.
const FEE_CHOICES = [3000, 4000, 5000, 6000, 7000];
const MODON = "MODON";
const BOXY = "BOXY";

const inGroup = (o: Order, key: string) =>
  o.status !== "CANCELLED" &&
  (key === MODON
    ? o.courierKind === "MODON" || Boolean(o.modonQr)
    : key === BOXY
      ? o.courierKind === "BOXY" || Boolean(o.boxyUid)
      : o.courierKind === "LOCAL" && o.courierId === key);

export function AdminSettle({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (orderNumber: string) => void }) {
  const toast = useToast();
  const auth = useAuth();
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [key, setKey] = useState<string>("");
  const [out, setOut] = useState<Set<string>>(new Set()); // ticked: with the courier now
  const [cash, setCash] = useState<Set<string>>(new Set()); // ticked: delivered, cash received
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"delivered" | "returned" | "settled" | null>(null);

  useEffect(() => {
    let alive = true;
    dataClient.models.Courier.list({ limit: 100 })
      .then(({ data }) => alive && setCouriers([...data].sort((a, b) => a.name.localeCompare(b.name, "ar"))))
      .catch(() => alive && setCouriers([]));
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const list = [...(couriers ?? []).filter((c) => c.active !== false).map((c) => ({ key: c.id, name: c.name })), { key: MODON, name: "مدن Express" }, { key: BOXY, name: "بوكسي" }];
    return list.map((g) => ({ ...g, withHim: (orders ?? []).filter((o) => inGroup(o, g.key) && o.status !== "DELIVERED").length }));
  }, [couriers, orders]);

  const mine = useMemo(() => (key ? (orders ?? []).filter((o) => inGroup(o, key)) : []), [orders, key]);
  const withHim = mine.filter((o) => o.status !== "DELIVERED").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const isLocal = key !== "" && key !== MODON && key !== BOXY;
  const toSettle = mine.filter((o) => o.status === "DELIVERED" && !o.courierSettledAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const fees = feesOf(couriers);
  const feeOf = (o: Order) => courierFee(o, fees).fee;
  const netOf = (o: Order) => netFromCourier(o, fees);
  const unknownFee = (list: Order[]) => list.filter((o) => feeOf(o) === null).length;
  // Earlier receipts from this company: one line per time the team pressed «استلمنا».
  const history = useMemo(() => {
    const byTime = new Map<string, { at: string; count: number; amount: number }>();
    for (const o of mine) {
      if (!o.courierSettledAt) continue;
      const h = byTime.get(o.courierSettledAt) ?? { at: o.courierSettledAt, count: 0, amount: 0 };
      h.count += 1;
      h.amount += typeof o.courierSettledAmount === "number" ? o.courierSettledAmount : (netFromCourier(o, fees) ?? collectAmount(o));
      byTime.set(o.courierSettledAt, h);
    }
    return [...byTime.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [mine, fees]);

  const sum = (list: Order[]) => list.reduce((n, o) => n + collectAmount(o), 0);
  const sumFees = (list: Order[]) => list.reduce((n, o) => n + (feeOf(o) ?? 0), 0);
  const sumNet = (list: Order[]) => list.reduce((n, o) => n + (netOf(o) ?? collectAmount(o)), 0);
  const pick = (list: Order[], set: Set<string>) => list.filter((o) => set.has(o.id));
  const outPicked = pick(withHim, out);
  const cashPicked = pick(toSettle, cash);

  function toggle(set: Set<string>, id: string, put: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    put(next);
    setConfirm(null);
  }
  function toggleAll(list: Order[], set: Set<string>, put: (s: Set<string>) => void) {
    put(list.length > 0 && list.every((o) => set.has(o.id)) ? new Set() : new Set(list.map((o) => o.id)));
    setConfirm(null);
  }

  async function run(list: Order[], what: "delivered" | "returned" | "settled") {
    setBusy(true);
    const now = new Date().toISOString();
    let failed = 0;
    for (const o of list) {
      const { errors } = await dataClient.models.Order.update(
        what === "delivered"
          ? { id: o.id, status: "DELIVERED", trackStatus: "تم التوصيل", editedBy: auth.phone, editedAt: now }
          : what === "settled"
            ? // The fee is frozen on the order with the amount, so a later change to the
              // company's default fee doesn't rewrite what was received.
              { id: o.id, courierSettledAt: now, courierSettledAmount: netOf(o) ?? collectAmount(o), deliveryCost: feeOf(o) }
            : {
                id: o.id,
                status: "CONFIRMED",
                courierKind: null,
                courierId: null,
                courierName: null,
                courierStatus: null,
                courierSentAt: null,
                editedBy: auth.phone,
                editedAt: now,
              },
      );
      if (errors?.length) failed += 1;
    }
    requestOrdersRefresh();
    setBusy(false);
    setConfirm(null);
    setOut(new Set());
    setCash(new Set());
    const done = list.length - failed;
    toast({
      id: "settle",
      tone: failed ? "attention" : undefined,
      message: failed
        ? `تم ${done} وفشل ${failed}. أعد المحاولة للباقي.`
        : what === "delivered"
          ? `سُجّل تسليم ${done} طلب.`
          : what === "settled"
            ? `سُجّل استلام ${formatIQD(sumNet(list))} عن ${done} طلب.`
            : `رجع ${done} طلب إلى المخزن بدون تسليم.`,
    });
  }

  const today = baghdadDay(new Date().toISOString());
  const age = (o: Order) => (baghdadDay(orderTime(o)) === today ? "اليوم" : baghdadDay(orderTime(o)).slice(5));

  const row = (o: Order, set: Set<string>, put: (s: Set<string>) => void) => (
    <li key={o.id} className={set.has(o.id) ? "settle__row is-on" : "settle__row"}>
      <label>
        <input type="checkbox" checked={set.has(o.id)} onChange={() => toggle(set, o.id, put)} />
        <span className="settle__main">
          <strong dir="ltr">{o.orderNumber}</strong> · {o.name}
          <small>{[o.area, age(o)].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="settle__amount">{collectAmount(o) > 0 ? formatIQD(collectAmount(o)) : "مدفوع"}</span>
      </label>
      <button type="button" className="link-button" onClick={() => onOpenOrder(o.orderNumber)}>
        فتح
      </button>
    </li>
  );

  async function setFee(o: Order, value: number | null) {
    const { errors } = await dataClient.models.Order.update({ id: o.id, deliveryCost: value, editedBy: auth.phone, editedAt: new Date().toISOString() });
    if (errors?.length) return toast({ id: "fee", tone: "attention", message: "ما انحفظت الأجرة. جرّبوا مرة ثانية." });
    requestOrdersRefresh();
  }

  const settleRow = (o: Order) => {
    const fee = feeOf(o);
    const net = netOf(o);
    const own = typeof o.deliveryCost === "number";
    const base = courierFee({ ...o, deliveryCost: null }, fees).fee; // the company's usual fee
    return (
      <li key={o.id} className={cash.has(o.id) ? "settle__row is-on" : "settle__row"}>
        <label>
          <input type="checkbox" checked={cash.has(o.id)} onChange={() => toggle(cash, o.id, setCash)} />
          <span className="settle__main">
            <strong dir="ltr">{o.orderNumber}</strong> · {o.name}
            <small>
              {[o.area, age(o)].filter(Boolean).join(" · ")} · يجمع {formatIQD(collectAmount(o))}
            </small>
          </span>
          <span className="settle__amount">{net === null ? "—" : net < 0 ? `ندفع ${formatIQD(-net)}` : formatIQD(net)}</span>
        </label>
        <span className="settle__fee">
          الأجرة
          <select
            aria-label={`أجرة التوصيل للطلب ${o.orderNumber}`}
            value={own ? String(fee) : base === null ? "" : "default"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "default") void setFee(o, null);
              else if (v === "other") {
                const typed = Number(toLatinDigits(window.prompt("أجرة هذا الطلب بالدينار") ?? "").replace(/[^\d]/g, ""));
                if (typed > 0 && typed <= 100000) void setFee(o, typed);
              } else if (v) void setFee(o, Number(v));
            }}
          >
            {base === null ? <option value="">غير محددة</option> : <option value="default">{formatIQD(base)} (الأساسية)</option>}
            {[...FEE_CHOICES, ...(own && !FEE_CHOICES.includes(fee as number) ? [fee as number] : [])].map((v) => (
              <option key={v} value={String(v)}>
                {formatIQD(v)}
              </option>
            ))}
            <option value="other">مبلغ آخر…</option>
          </select>
        </span>
        <button type="button" className="link-button" onClick={() => onOpenOrder(o.orderNumber)}>
          فتح
        </button>
      </li>
    );
  };

  return (
    <section className="settle" aria-label="تسوية المندوب">
      <h2>تسوية المندوب</h2>
      <p className="hint">اختر المندوب عند رجوعه: تظهر كل الطلبات اللي أخذها. حدد المسلَّم ثم أكّد مرة وحدة.</p>
      <div className="settle__chips" role="tablist">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={key === g.key}
            className={key === g.key ? "settle__chip is-on" : "settle__chip"}
            onClick={() => {
              setKey(g.key);
              setOut(new Set());
              setCash(new Set());
              setConfirm(null);
            }}
          >
            {g.name}
            {g.withHim > 0 && <b>{g.withHim}</b>}
          </button>
        ))}
      </div>

      {orders === null && key && <p className="hint">جارٍ التحميل…</p>}

      {key && orders !== null && (
        <>
          <div className="settle__block">
            <div className="settle__head">
              <h3>عنده الآن ({withHim.length})</h3>
              {withHim.length > 0 && (
                <button type="button" className="link-button" onClick={() => toggleAll(withHim, out, setOut)}>
                  {withHim.every((o) => out.has(o.id)) ? "إلغاء التحديد" : "حدد الكل"}
                </button>
              )}
            </div>
            {withHim.length === 0 ? <p className="hint">لا طلبات عنده حالياً.</p> : <ul>{withHim.map((o) => row(o, out, setOut))}</ul>}
            {withHim.length > 0 && (
              <p className="settle__sum">
                عنده بالمجموع {formatIQD(sum(withHim))}
                {outPicked.length > 0 && <> · المحدد {outPicked.length} طلب = {formatIQD(sum(outPicked))}</>}
              </p>
            )}
            {outPicked.length > 0 &&
              (confirm === "delivered" || confirm === "returned" ? (
                <div className="settle__confirm">
                  <p>
                    {confirm === "delivered"
                      ? `تأكيد: ${outPicked.length} طلب «تم التسليم» والمبلغ ${formatIQD(sum(outPicked))} عند المندوب.`
                      : `تأكيد: ${outPicked.length} طلب رجع بدون تسليم، ويُسحب من المندوب ويرجع «مؤكد».`}
                  </p>
                  <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run(outPicked, confirm)}>
                    {busy ? "جارٍ الحفظ…" : "تأكيد"}
                  </button>
                  <button type="button" className="link-button" onClick={() => setConfirm(null)}>
                    تراجع
                  </button>
                </div>
              ) : (
                <div className="settle__actions">
                  <button type="button" className="btn" onClick={() => setConfirm("delivered")}>
                    تم تسليم المحدد ({outPicked.length})
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirm("returned")}>
                    رجع بدون تسليم
                  </button>
                </div>
              ))}
          </div>

          <div className="settle__block">
            <div className="settle__head">
              <h3>مسلَّم وبانتظار استلام المبلغ ({toSettle.length})</h3>
              {toSettle.length > 0 && (
                <button type="button" className="link-button" onClick={() => toggleAll(toSettle, cash, setCash)}>
                  {toSettle.every((o) => cash.has(o.id)) ? "إلغاء التحديد" : "حدد الكل"}
                </button>
              )}
            </div>
            {!isLocal && <p className="hint">لما تحوّل الشركة المبلغ: حددوا الطلبات اللي بالكشف واضغطوا «استلمنا».</p>}
            {toSettle.length === 0 ? <p className="hint">لا مبالغ بانتظار الاستلام.</p> : <ul>{toSettle.map(settleRow)}</ul>}
            {toSettle.length > 0 && (
              <p className="settle__sum">
                عليهم لـ ÉLUE {formatIQD(sumNet(toSettle))}
                {unknownFee(toSettle) > 0 && <> · {unknownFee(toSettle)} طلب بدون أجرة محددة</>}
              </p>
            )}
            {cashPicked.length > 0 && (
              <p className="settle__calc">
                المحدد {cashPicked.length} طلب: جمعوا {formatIQD(sum(cashPicked))} − أجورهم {formatIQD(sumFees(cashPicked))} = <strong>{formatIQD(sumNet(cashPicked))}</strong>
              </p>
            )}
            {cashPicked.length > 0 &&
              (unknownFee(cashPicked) > 0 ? (
                <p className="order-card__warn">حددوا أجرة التوصيل للطلبات المحددة أولاً (أو الأجرة الافتراضية للشركة من «شركات التوصيل»).</p>
              ) : confirm === "settled" ? (
                <div className="settle__confirm">
                  <p>تأكيد: استلمنا {formatIQD(sumNet(cashPicked))} عن {cashPicked.length} طلب.</p>
                  <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run(cashPicked, "settled")}>
                    {busy ? "جارٍ الحفظ…" : "تأكيد استلام المبلغ"}
                  </button>
                  <button type="button" className="link-button" onClick={() => setConfirm(null)}>
                    تراجع
                  </button>
                </div>
              ) : (
                <div className="settle__actions">
                  <button type="button" className="btn" onClick={() => setConfirm("settled")}>
                    استلمنا {formatIQD(sumNet(cashPicked))}
                  </button>
                </div>
              ))}
          </div>

          {history.length > 0 && (
            <div className="settle__block">
              <h3>آخر الاستلامات</h3>
              <ul className="settle__history">
                {history.map((h) => (
                  <li key={h.at}>
                    <span>{baghdadDay(h.at)} · {h.count} طلب</span>
                    <strong>{formatIQD(h.amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

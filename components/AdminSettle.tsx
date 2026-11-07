"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { dataClient, type Courier, type Order } from "@/lib/data";
import { collectAmount } from "@/lib/dispatch";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";
import { formatIQD } from "@/lib/site";
import { baghdadDay } from "./AdminOrderRow";

// «تسوية المندوب»: when a courier comes back, pick him and see everything he took in one
// list: tick what was delivered (or came back) and confirm all at once, then settle the cash.
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
  const toSettle = isLocal ? mine.filter((o) => o.status === "DELIVERED" && !o.courierSettledAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];

  const sum = (list: Order[]) => list.reduce((n, o) => n + collectAmount(o), 0);
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
            ? { id: o.id, courierSettledAt: now }
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
            ? `سُجّل استلام المبلغ لـ ${done} طلب.`
            : `رجع ${done} طلب إلى المخزن بدون تسليم.`,
    });
  }

  const today = baghdadDay(new Date().toISOString());
  const age = (o: Order) => (baghdadDay(o.createdAt) === today ? "اليوم" : baghdadDay(o.createdAt).slice(5));

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

          {isLocal ? (
            <div className="settle__block">
              <div className="settle__head">
                <h3>مسلَّم وبانتظار استلام المبلغ ({toSettle.length})</h3>
                {toSettle.length > 0 && (
                  <button type="button" className="link-button" onClick={() => toggleAll(toSettle, cash, setCash)}>
                    {toSettle.every((o) => cash.has(o.id)) ? "إلغاء التحديد" : "حدد الكل"}
                  </button>
                )}
              </div>
              {toSettle.length === 0 ? <p className="hint">لا مبالغ بانتظار الاستلام منه.</p> : <ul>{toSettle.map((o) => row(o, cash, setCash))}</ul>}
              {toSettle.length > 0 && (
                <p className="settle__sum">
                  عليه لـ ÉLUE {formatIQD(sum(toSettle))}
                  {cashPicked.length > 0 && <> · المحدد {cashPicked.length} طلب = {formatIQD(sum(cashPicked))}</>}
                </p>
              )}
              {cashPicked.length > 0 &&
                (confirm === "settled" ? (
                  <div className="settle__confirm">
                    <p>تأكيد: استلمت {formatIQD(sum(cashPicked))} من المندوب عن {cashPicked.length} طلب.</p>
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
                      استلمت المبلغ ({cashPicked.length})
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="hint">التحصيل يكون عبر الشركة نفسها، والحالات تتحدّث تلقائياً.</p>
          )}
        </>
      )}
    </section>
  );
}

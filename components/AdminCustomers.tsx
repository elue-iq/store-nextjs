"use client";

import { useMemo, useState } from "react";
import { StatusChip } from "./OrderBits";
import { formatPoints, pointsSummary } from "@/lib/loyalty";
import { baghdadTime, type Order } from "@/lib/data";
import { fullAddress } from "@/lib/iraq";
import { getProduct } from "@/lib/products";
import { formatIraqiMobile, toLatinDigits } from "@/lib/phone";
import { formatIQD } from "@/lib/site";

// A customer is every order with the same WhatsApp number. Built from the
// orders the admin already loads, so there is nothing new to store.
export type Customer = {
  phone: string;
  name: string; // from the latest order
  orders: Order[]; // newest first
  counted: Order[]; // orders that count (not cancelled)
  spent: number;
  delivered: number;
  cancelled: number;
  lastAt: string;
  firstAt: string;
};

export function buildCustomers(orders: Order[]): Customer[] {
  const byPhone = new Map<string, Order[]>();
  for (const o of orders) {
    const list = byPhone.get(o.phone);
    if (list) list.push(o);
    else byPhone.set(o.phone, [o]);
  }
  return [...byPhone.entries()].map(([phone, list]) => {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counted = sorted.filter((o) => o.status !== "CANCELLED");
    return {
      phone,
      name: sorted[0].name,
      orders: sorted,
      counted,
      spent: counted.reduce((n, o) => n + o.total, 0),
      delivered: sorted.filter((o) => o.status === "DELIVERED").length,
      cancelled: sorted.length - counted.length,
      lastAt: sorted[0].createdAt,
      firstAt: sorted[sorted.length - 1].createdAt,
    };
  });
}

const day = (iso: string) => baghdadTime(iso).slice(0, 10);

type Sort = "recent" | "spent" | "orders";

export function CustomersSummary({ customers }: { customers: Customer[] }) {
  const repeat = customers.filter((c) => c.counted.length >= 2).length;
  const rate = customers.length ? Math.round((repeat / customers.length) * 100) : 0;
  return (
    <dl className="admin-stats">
      <div>
        <dt>العملاء</dt>
        <dd>{customers.length}</dd>
      </div>
      <div>
        <dt>عملاء متكررون</dt>
        <dd>{repeat}</dd>
      </div>
      <div>
        <dt>نسبة التكرار</dt>
        <dd>{rate}%</dd>
      </div>
      <div>
        <dt>إجمالي الإنفاق</dt>
        <dd>{formatIQD(customers.reduce((n, c) => n + c.spent, 0))}</dd>
      </div>
    </dl>
  );
}

export function CustomerList({ customers, onOpen }: { customers: Customer[]; onOpen: (phone: string) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const shown = useMemo(() => {
    const q = toLatinDigits(query).trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
    const list = customers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && c.phone.includes(qDigits)) ||
        c.orders.some((o) => fullAddress(o).toLowerCase().includes(q))
      );
    });
    const by: Record<Sort, (a: Customer, b: Customer) => number> = {
      recent: (a, b) => b.lastAt.localeCompare(a.lastAt),
      spent: (a, b) => b.spent - a.spent,
      orders: (a, b) => b.counted.length - a.counted.length || b.lastAt.localeCompare(a.lastAt),
    };
    return [...list].sort(by[sort]);
  }, [customers, query, sort]);

  return (
    <>
      <div className="admin-tools">
        <input
          className="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو العنوان"
          aria-label="بحث في العملاء"
        />
        <div className="admin-tools__row">
          <span className="admin-tools__count">{shown.length} عميل</span>
          <select className="admin-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="الترتيب">
            <option value="recent">آخر طلب</option>
            <option value="spent">الأعلى إنفاقًا</option>
            <option value="orders">الأكثر طلبات</option>
          </select>
        </div>
      </div>
      {shown.length === 0 && <p className="hint">لا يوجد عملاء هنا.</p>}
      <ul className="order-rows">
        {shown.map((c) => (
          <li key={c.phone}>
            <button type="button" className="order-row" onClick={() => onOpen(c.phone)}>
              <span className="order-row__main">
                <span className="order-row__top">
                  <strong>{c.name}</strong>
                  {c.counted.length >= 2 && <span className="order-row__paid">متكرر</span>}
                </span>
                <span className="order-row__name" dir="ltr">
                  {formatIraqiMobile(c.phone)}
                </span>
                <span className="order-row__sub">
                  {c.counted.length} طلب · آخر طلب {day(c.lastAt)}
                </span>
              </span>
              <span className="order-row__side">
                <strong>{formatIQD(c.spent)}</strong>
                <span>{c.delivered} مُسلَّم</span>
              </span>
              <svg className="order-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CustomerDetail({
  customer: c,
  onOpenOrder,
  onNewOrder,
}: {
  customer: Customer;
  onOpenOrder: (orderNumber: string) => void;
  onNewOrder: () => void;
}) {
  const latest = c.orders[0];
  const points = pointsSummary(c.orders);
  const addresses = useMemo(() => [...new Set(c.orders.map((o) => fullAddress(o)))], [c.orders]);
  const flavors = useMemo(() => {
    const n = new Map<string, number>();
    for (const o of c.counted) for (const i of o.items) if (i) n.set(i.slug, (n.get(i.slug) ?? 0) + i.qty);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [c.counted]);
  const avg = c.counted.length ? Math.round(c.spent / c.counted.length) : 0;

  return (
    <div className="customer">
      <section className="order-detail__block">
        <h2>{c.name}</h2>
        <p dir="ltr" className="customer__phone">
          {formatIraqiMobile(c.phone)}
        </p>
        <div className="modon__actions">
          <a className="btn btn--small" href={`https://wa.me/${c.phone}`} target="_blank" rel="noopener noreferrer">
            واتساب
          </a>
          <a className="btn btn--quiet btn--small" href={`tel:+${c.phone}`}>
            اتصال
          </a>
          <button type="button" className="btn btn--quiet btn--small" onClick={onNewOrder}>
            + طلب جديد له
          </button>
        </div>
      </section>

      <dl className="admin-stats">
        <div>
          <dt>الطلبات</dt>
          <dd>{c.counted.length}</dd>
        </div>
        <div>
          <dt>إجمالي الإنفاق</dt>
          <dd>{formatIQD(c.spent)}</dd>
        </div>
        <div>
          <dt>متوسط الطلب</dt>
          <dd>{formatIQD(avg)}</dd>
        </div>
        <div>
          <dt>النقاط</dt>
          <dd>
            {formatPoints(points.earned)}

          </dd>
        </div>
      </dl>

      <section className="order-detail__block">
        <h2>نبذة</h2>
        <dl className="modon__facts">
          <div>
            <dt>أول طلب</dt>
            <dd>{day(c.firstAt)}</dd>
          </div>
          <div>
            <dt>آخر طلب</dt>
            <dd>{day(c.lastAt)}</dd>
          </div>
          {points.pending > 0 && (
            <div>
              <dt>نقاط قيد الانتظار</dt>
              <dd>{formatPoints(points.pending)}</dd>
            </div>
          )}
          <div>
            <dt>مُسلَّمة</dt>
            <dd>{c.delivered}</dd>
          </div>
          {c.cancelled > 0 && (
            <div>
              <dt>ملغاة</dt>
              <dd>{c.cancelled}</dd>
            </div>
          )}
          {flavors.length > 0 && (
            <div>
              <dt>النكهات</dt>
              <dd>{flavors.map(([slug, n]) => `${getProduct(slug)?.nameAr ?? slug} × ${n}`).join("، ")}</dd>
            </div>
          )}
          <div>
            <dt>{addresses.length > 1 ? "العناوين" : "العنوان"}</dt>
            <dd>{addresses.join(" | ") || fullAddress(latest)}</dd>
          </div>
        </dl>
      </section>

      <section className="order-detail__block">
        <h2>كل الطلبات ({c.orders.length})</h2>
        <ul className="order-rows">
          {c.orders.map((o) => (
            <li key={o.id}>
              <button type="button" className={`order-row order-row--${o.status.toLowerCase()}`} onClick={() => onOpenOrder(o.orderNumber)}>
                <span className="order-row__main">
                  <span className="order-row__top">
                    <strong dir="ltr">{o.orderNumber}</strong>
                    <StatusChip status={o.status} />
                    {o.paid && <span className="order-row__paid">مدفوع</span>}
                    {o.freeDelivery && <span className="order-row__paid order-row__free">توصيل مجاني</span>}
                  </span>
                  <span className="order-row__sub">
                    {o.items
                      .filter((i): i is NonNullable<typeof i> => Boolean(i))
                      .map((i) => `${getProduct(i.slug)?.nameAr ?? i.nameAr} × ${i.qty}`)
                      .join("، ")}
                  </span>
                </span>
                <span className="order-row__side">
                  <strong>{formatIQD(o.total)}</strong>
                  <span dir="ltr">{day(o.createdAt)}</span>
                </span>
                <svg className="order-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

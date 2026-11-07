"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { CourierScanner } from "./CourierScanner";
import { LoginPanel } from "./LoginPanel";
import { useToast } from "./Toast";
import { usePullToRefresh } from "./usePullToRefresh";
import { SendOnWhatsApp } from "./SendOrderToCustomer";
import { callCourier, ERROR_TEXT, orderNumberFrom, type CourierOrder } from "@/lib/courier";
import { collectAmount } from "@/lib/dispatch";
import { fullAddress } from "@/lib/iraq";
import { formatIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { slotText } from "@/lib/delivery-slot";
import { courierComingMessage } from "@/lib/share";

const STATUS_AR: Record<string, string> = { NEW: "جديد", CONFIRMED: "جديد", OUT_FOR_DELIVERY: "في الطريق", DELIVERED: "تم التسليم" };

function OrderCard({ o, busy, onStatus, courierName }: { o: CourierOrder; busy: boolean; onStatus: (o: CourierOrder, s: "OUT_FOR_DELIVERY" | "DELIVERED") => void; courierName: string }) {
  const [confirm, setConfirm] = useState(false);
  const collect = collectAmount(o);
  const done = o.status === "DELIVERED";
  const items = (o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => `${i.nameAr} × ${i.qty}`).join("، ");
  const phone = formatIraqiMobile(o.phone);
  return (
    <article className={`courier-card${done ? " is-done" : ""}`}>
      <header>
        <strong dir="ltr">{o.orderNumber}</strong>
        <span className={`courier-card__status is-${o.status.toLowerCase()}`}>{STATUS_AR[o.status] ?? o.status}</span>
      </header>
      <p className="courier-card__name">{o.name}</p>
      <p>{fullAddress(o)}</p>
      {o.note && <p className="courier-card__note">ملاحظة: {o.note}</p>}
      {slotText(o) && <p className="courier-card__note"><strong>موعد التوصيل: {slotText(o)}</strong></p>}
      <p className="courier-card__items">
        {items} {items && "·"} {o.jars} علبة
      </p>
      <p className="courier-card__collect">{collect > 0 ? <>المطلوب من الزبون: <strong>{formatIQD(collect)}</strong></> : <strong>مدفوع: لا يُطلب شيء</strong>}</p>
      <div className="courier-card__contact">
        <a className="btn btn--quiet" href={`tel:+${o.phone}`} aria-label={`اتصال ${phone}`}>
          اتصال
        </a>
        <a className="btn btn--quiet" href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer">
          واتساب
        </a>
      </div>
      {!done && (
        <SendOnWhatsApp
          order={{ ...o, items: o.items ?? [] }}
          phone={o.phone}
          text={courierComingMessage({ ...o, items: (o.items ?? []).map((i) => (i ? { ...i, slug: i.slug ?? "" } : null)) }, courierName)}
          label="أبلغ الزبون: أنا بالطريق"
          primary={false}
          shareHint="اختر واتساب ثم محادثة الزبون: تُرسل صورة الطلب ومعها النص."
          chatHint="تُفتح محادثة الزبون والنص جاهز، وتُنسخ صورة الطلب: الصقها في المحادثة."
        />
      )}
      {!done && (
        <div className="courier-card__actions">
          {o.status !== "OUT_FOR_DELIVERY" && (
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => onStatus(o, "OUT_FOR_DELIVERY")}>
              في الطريق إلى الزبون
            </button>
          )}
          {confirm ? (
            <button type="button" className="btn btn--full is-confirm" disabled={busy} onClick={() => onStatus(o, "DELIVERED")}>
              تأكيد: تم التسليم
            </button>
          ) : (
            <button type="button" className="btn btn--full" disabled={busy} onClick={() => setConfirm(true)}>
              تم التسليم
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// /courier: a local courier logs in with their WhatsApp number, sees only the orders given
// to them, scans the label's QR code, and marks an order in delivery or delivered.
export function CourierView() {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [orders, setOrders] = useState<CourierOrder[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<CourierOrder | null>(null); // the scanned order, shown full screen

  const load = useCallback(async () => {
    const res = await callCourier({ action: "mine" });
    if (!res.ok) return setError(ERROR_TEXT[res.code] ?? "تعذّر تحميل الطلبات. حدّث الصفحة.");
    setError("");
    setName(res.courier ?? "");
    setLoginPhone(res.phone ?? "");
    setOrders(res.orders ?? []);
  }, []);

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    void load();
    // New orders arrive while the page is open: re-read every 30 s and whenever the page is shown again.
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [auth.status, load]);

  const ptr = usePullToRefresh(auth.status === "signedIn", load);


  async function lookup(text: string) {
    const number = orderNumberFrom(text);
    setScanning(false);
    if (!number) return toast({ id: "courier", tone: "attention", message: "هذا الرمز ليس طلب ÉLUE." });
    // The admin assigns orders. Scanning only opens an order that is already his, full screen.
    const res = await callCourier({ action: "get", orderNumber: number });
    if (!res.ok || !res.order) return toast({ id: "courier", tone: "attention", message: ERROR_TEXT[res.ok ? "not_found" : res.code] ?? "تعذّر فتح الطلب." });
    setTyped("");
    setFound(res.order);
  }

  async function setStatus(o: CourierOrder, status: "OUT_FOR_DELIVERY" | "DELIVERED") {
    setBusy(true);
    const res = await callCourier({ action: "status", orderNumber: o.orderNumber, status });
    setBusy(false);
    if (!res.ok) return toast({ id: "courier", tone: "attention", message: ERROR_TEXT[res.code] ?? "تعذّر تحديث الحالة. حاول مجدداً." });
    toast({ id: "courier", message: status === "DELIVERED" ? `✓ ${o.orderNumber}: تم التسليم` : `${o.orderNumber}: في الطريق` });
    // Delivered: back to the list. In delivery: stay on the order, now showing its new state.
    if (status === "DELIVERED") setFound(null);
    else if (res.order) setFound(res.order);
    await load();
  }

  if (auth.status === "loading") return <p className="panel-loading">لحظة من فضلك…</p>;
  if (auth.status === "signedOut") {
    return <LoginPanel title="تطبيق المندوب" intro="سجّل الدخول برقم الواتساب المسجّل لدى ÉLUE. يصلك رمز التحقق عبر واتساب." />;
  }
  if (error) {
    return (
      <div className="panel-note" role="alert">
        {error}{" "}
        <button type="button" className="link-button" onClick={() => void load()}>
          حاول مجدداً
        </button>
      </div>
    );
  }
  if (orders === null) return <p className="panel-loading">جارٍ التحميل…</p>;

  const open = orders.filter((o) => o.status !== "DELIVERED");
  const delivered = orders.filter((o) => o.status === "DELIVERED");

  return (
    <div className="courier">
      <header className="courier__head">
        <h1>{name}</h1>
        {loginPhone && <small dir="ltr">{formatIraqiMobile(loginPhone)}</small>}
        <p>
          {open.length ? `${open.length} طلب بانتظار التوصيل` : "لا طلبات بانتظار التوصيل"}{" "}
          <button type="button" className="link-button" onClick={() => void load()}>
            {ptr.refreshing ? "…" : "تحديث"}
          </button>
        </p>
      </header>

      <div className="courier__scan">
        <button type="button" className="btn btn--full" onClick={() => setScanning(true)}>
          مسح QR الملصق
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(typed);
          }}
        >
          <input dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="أو اكتب رقم الطلب EL-0012" aria-label="رقم الطلب" />
          <button type="submit" className="btn btn--quiet" disabled={!typed.trim()}>
            فتح
          </button>
        </form>
      </div>

      {scanning && <CourierScanner onCode={(t) => void lookup(t)} onClose={() => setScanning(false)} />}

      {found && (
        <div className="courier-sheet" role="dialog" aria-modal="true" aria-label={`الطلب ${found.orderNumber}`}>
          <div className="courier-sheet__bar">
            <strong dir="ltr">{found.orderNumber}</strong>
            <button type="button" className="link-button" onClick={() => setFound(null)}>
              إغلاق
            </button>
          </div>
          <OrderCard key={found.orderNumber} o={found} busy={busy} onStatus={(o, s) => void setStatus(o, s)} courierName={name} />
        </div>
      )}

      <section>
        <h2>طلباتي</h2>
        {open.length === 0 && <p className="hint">ما عندك طلبات حالياً. الطلبات الجديدة تصلك على تيليغرام وتظهر هنا.</p>}
        {open.map((o) => (
          <OrderCard key={o.orderNumber} o={o} busy={busy} onStatus={(x, s) => void setStatus(x, s)} courierName={name} />
        ))}
      </section>

      {delivered.length > 0 && (
        <section>
          <h2>سُلّمت مؤخراً</h2>
          {delivered.map((o) => (
            <OrderCard key={o.orderNumber} o={o} busy={busy} onStatus={() => {}} courierName={name} />
          ))}
        </section>
      )}
      <p className="hint">للاستفسار: <span dir="ltr">{site.whatsappDisplay}</span></p>
    </div>
  );
}

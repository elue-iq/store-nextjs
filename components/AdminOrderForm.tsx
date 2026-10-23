"use client";

import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { DeliveryFields, type DeliveryFieldsHandle } from "./DeliveryFields";
import { callModon } from "./AdminModon";
import { dataClient, errorCode, errorFields, type Order } from "@/lib/data";
import { products } from "@/lib/products";
import { MAX_QTY_PER_LINE } from "@/lib/order-text";
import { collectBreakdown, modonCollect } from "@/lib/modon";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { checkDelivery, cleanDelivery, phoneError, type DeliveryInfo, type FieldErrors } from "@/lib/validate";

// Team form for one order:
// - "create": a new order for a customer (e.g. taken by phone). Goes through
//   placeOrder, so it gets the next EL- number and is sent to Telegram.
// - "edit": change any detail of an existing order. Only the team can do this;
//   customers ask on WhatsApp.
export function AdminOrderForm({
  order,
  onDone,
  onCancel,
}: {
  order?: Order;
  onDone: (orderNumber: string) => void;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const editing = Boolean(order);
  const fieldsRef = useRef<DeliveryFieldsHandle>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const [phone, setPhone] = useState(order ? formatIraqiMobile(order.phone) : "");
  const [phoneErr, setPhoneErr] = useState("");
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    name: order?.name ?? "",
    province: order?.province ?? "",
    area: order?.area ?? "",
    address: order?.address ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [note, setNote] = useState(order?.note ?? "");
  const [cashier, setCashier] = useState(order?.cashierOrderId ?? "");
  const [paid, setPaid] = useState(Boolean(order?.paid));
  const [paidNote, setPaidNote] = useState(order?.paidNote ?? "");
  const [freeDelivery, setFreeDelivery] = useState(Boolean(order?.freeDelivery));
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries((order?.items ?? []).filter(Boolean).map((i) => [i!.slug, i!.qty])),
  );
  const [busy, setBusy] = useState(false);

  // Existing lines keep the price they were sold at; new lines use today's price.
  const oldQty: Record<string, number> = Object.fromEntries(
    (order?.items ?? []).filter(Boolean).map((i) => [i!.slug, i!.qty]),
  );
  const oldPrice = Object.fromEntries((order?.items ?? []).filter(Boolean).map((i) => [i!.slug, i!.price]));
  const lines = products
    .filter((p) => (qty[p.slug] ?? 0) > 0)
    .map((p) => ({ product: p, qty: qty[p.slug], price: oldPrice[p.slug] ?? p.price }));
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  const driverCollects = modonCollect(total, paid, freeDelivery);

  function step(slug: string, by: number) {
    setQty((q) => ({ ...q, [slug]: Math.min(MAX_QTY_PER_LINE, Math.max(0, (q[slug] ?? 0) + by)) }));
  }

  async function save() {
    if (busy) return;
    const pErr = phoneError(phone);
    const found = checkDelivery(delivery);
    setPhoneErr(pErr ?? "");
    setErrors(found);
    if (pErr) return phoneRef.current?.focus();
    if (Object.keys(found).length) return fieldsRef.current?.focusFirstError(found);
    if (!lines.length) {
      toast({ id: "admin", tone: "attention", message: "أضف نكهة واحدة على الأقل." });
      return;
    }
    const info = cleanDelivery(delivery);
    const customerPhone = normalizeIraqiMobile(phone)!;
    setBusy(true);

    if (order) {
      // Send only what was changed here, so a change saved meanwhile on another
      // phone (e.g. the cashier number) is never overwritten with an old value.
      const items = lines.map((l) => ({
        slug: l.product.slug,
        nameAr: l.product.nameAr,
        nameEn: l.product.nameEn,
        qty: l.qty,
        price: l.price,
      }));
      const before = {
        phone: order.phone,
        name: order.name,
        province: order.province ?? "",
        area: order.area ?? "",
        address: order.address,
        note: order.note ?? null,
        cashierOrderId: order.cashierOrderId ?? null,
        paid: Boolean(order.paid),
        paidNote: order.paidNote ?? null,
        freeDelivery: Boolean(order.freeDelivery),
      };
      const after = {
        phone: customerPhone,
        ...info,
        note: note.trim() || null,
        cashierOrderId: cashier.trim() || null,
        paid,
        paidNote: paid ? paidNote.trim() || null : null,
        freeDelivery,
      };
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(after) as (keyof typeof after)[]) {
        if (after[key] !== before[key]) changes[key] = after[key];
      }
      const sameItems =
        JSON.stringify(items.map((i) => [i.slug, i.qty])) ===
        JSON.stringify(products.filter((p) => oldQty[p.slug]).map((p) => [p.slug, oldQty[p.slug]]));
      if (!sameItems) Object.assign(changes, { items, jars, total });
      if (!Object.keys(changes).length) {
        setBusy(false);
        onDone(order.orderNumber);
        return;
      }
      const { errors: gqlErrors } = await dataClient.models.Order.update({
        id: order.id,
        ...changes,
        editedBy: auth.phone,
        editedAt: new Date().toISOString(),
      });
      setBusy(false);
      if (gqlErrors?.length) {
        console.error("order edit failed", gqlErrors);
        toast({ id: "admin", tone: "attention", message: "تعذّر حفظ التعديلات. حاول مجددًا." });
        return;
      }
      // Already at Modon: send the new details there too (only possible before pickup).
      // "paid" changes the amount the driver collects, so it must re-sync.
      const modonFields = ["phone", "name", "province", "area", "address", "note", "items", "paid", "freeDelivery"];
      if (order.modonQr && modonFields.some((k) => k in changes)) {
        const { error } = await callModon({ action: "update", orderId: order.id });
        toast(
          error
            ? { id: "admin", tone: "attention", message: `حُفظت التعديلات هنا، لكن لم تُحدَّث لدى مدن: ${error} اتصل بمدن.` }
            : { id: "admin", message: `حُفظت تعديلات ${order.orderNumber} وحُدّثت لدى مدن.` },
        );
      } else {
        toast({ id: "admin", message: `حُفظت تعديلات ${order.orderNumber}.` });
      }
      onDone(order.orderNumber);
      return;
    }

    const { data, errors: gqlErrors } = await dataClient.mutations.placeOrder({
      ...info,
      note: note.trim() || undefined,
      items: JSON.stringify(lines.map((l) => ({ slug: l.product.slug, qty: l.qty }))),
      customerPhone,
      cashierOrderId: cashier.trim() || undefined,
      paid,
      paidNote: paid ? paidNote.trim() || undefined : undefined,
      freeDelivery,
    });
    setBusy(false);
    if (data?.orderNumber) {
      toast({ id: "admin", message: `أُنشئ الطلب ${data.orderNumber}.` });
      onDone(data.orderNumber);
      return;
    }
    console.error("team order failed", gqlErrors);
    const code = errorCode(gqlErrors);
    if (code === "invalid_fields") {
      const fields = errorFields(gqlErrors);
      if (fields.phone) setPhoneErr(fields.phone);
      setErrors(fields);
    }
    toast({ id: "admin", tone: "attention", message: "تعذّر إنشاء الطلب. راجع الحقول وحاول مجددًا." });
  }

  return (
    <form
      className="panel-form admin-order-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="order-detail__block">
        <h2>العميل</h2>
        <label className={phoneErr ? "has-error" : undefined}>
          رقم الواتساب
          <input
            ref={phoneRef}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneErr) setPhoneErr(phoneError(e.target.value) ?? "");
            }}
            inputMode="tel"
            dir="ltr"
            placeholder="07XX XXX XXXX"
            aria-invalid={phoneErr ? true : undefined}
          />
          {phoneErr && <span className="field-error">{phoneErr}</span>}
          {!editing && !phoneErr && (
            <span className="field-hint">إذا سجّل العميل بهذا الرقم، يظهر الطلب في «طلباتي» عنده.</span>
          )}
        </label>
        <DeliveryFields
          ref={fieldsRef}
          values={delivery}
          errors={errors}
          onChange={setDelivery}
          onErrors={setErrors}
          idPrefix="admin-order"
        />
        <label>
          ملاحظة (اختياري)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
        </label>
      </section>

      <section className="order-detail__block">
        <h2>الطلب</h2>
        <ul className="admin-order-form__items">
          {products.map((p) => (
            <li key={p.slug}>
              <span>
                {p.nameAr}
                <small dir="ltr">{p.nameEn}</small>
              </span>
              <span className="stepper stepper--small" role="group" aria-label={`كمية ${p.nameAr}`}>
                <button type="button" onClick={() => step(p.slug, 1)} aria-label="زيادة">
                  +
                </button>
                <output>{qty[p.slug] ?? 0}</output>
                <button type="button" onClick={() => step(p.slug, -1)} aria-label="إنقاص">
                  −
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="order-card__total">
          <span>المجموع · {jars} علبة</span>
          <strong>{formatIQD(total)}</strong>
        </p>
      </section>

      <section className="order-detail__block">
        <h2>الدفع والتوصيل</h2>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          <span>العميل دفع ثمن الطلب مسبقاً (يستلم المندوب أجور التوصيل فقط)</span>
        </label>
        {paid && (
          <label>
            <span className="visually-hidden">طريقة الدفع</span>
            <input
              value={paidNote}
              onChange={(e) => setPaidNote(e.target.value)}
              maxLength={120}
              placeholder="طريقة الدفع، مثل: تحويل Qi"
            />
          </label>
        )}
        <label className="admin-order-form__check">
          <input type="checkbox" checked={freeDelivery} onChange={(e) => setFreeDelivery(e.target.checked)} />
          <span>توصيل مجاني — نتحمّل أجور التوصيل ({formatIQD(site.deliveryFee)})</span>
        </label>
        <p className="admin-order-form__collect">
          يستلم المندوب من العميل <strong>{formatIQD(driverCollects)}</strong>
          <small>{collectBreakdown(total, paid, freeDelivery)}</small>
        </p>
      </section>

      <section className="order-detail__block">
        <h2>رقم طلب الكاشير</h2>
        <label>
          <span className="visually-hidden">رقم طلب الكاشير</span>
          <input value={cashier} onChange={(e) => setCashier(e.target.value)} dir="ltr" maxLength={60} placeholder="اختياري" />
        </label>
      </section>

      <div className="order-detail__actions">
        <button type="submit" className="btn btn--full" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "إنشاء الطلب"}
        </button>
        <button type="button" className="btn btn--quiet btn--full" onClick={onCancel} disabled={busy}>
          إلغاء
        </button>
      </div>
    </form>
  );
}

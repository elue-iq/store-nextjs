"use client";

import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { DeliveryFields, type DeliveryFieldsHandle } from "./DeliveryFields";
import { SlotPicker } from "./SlotPicker";
import { DEFAULT_SLOT, isSlotKey, type SlotKey } from "@/lib/delivery-slot";
import { callModon } from "./AdminModon";
import { callBoxy } from "./AdminBoxy";
import { dataClient, errorCode, errorFields, type Order } from "@/lib/data";
import { products } from "@/lib/products";
import { MAX_QTY_PER_LINE } from "@/lib/order-text";
import { collectBreakdown, modonCollect } from "@/lib/modon";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { deliveryPayOf, formatIQD, freeDeliveryFor, needsPayRef, PAID_METHODS, PAY_METHOD_LABELS, site, type DeliveryPay, type PayMethod } from "@/lib/site";
import { checkDelivery, cleanDelivery, phoneError, type DeliveryInfo, type FieldErrors } from "@/lib/validate";

// Team form for one order:
// - "create": a new order for a customer (e.g. taken by phone). Goes through
//   placeOrder, so it gets the next EL- number and is sent to Telegram.
// - "edit": change any detail of an existing order. Only the team can do this;
//   customers ask on WhatsApp.
type JarsPay = "cash" | "prepaid" | "gift";

export function AdminOrderForm({
  order,
  prefill,
  onDone,
  onCancel,
}: {
  order?: Order;
  // New order for a known customer: start from their latest order's contact and address.
  prefill?: Order;
  onDone: (orderNumber: string) => void;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const editing = Boolean(order);
  const fieldsRef = useRef<DeliveryFieldsHandle>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const seed = order ?? prefill;
  const [phone, setPhone] = useState(seed ? formatIraqiMobile(seed.phone) : "");
  const [phoneErr, setPhoneErr] = useState("");
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    name: seed?.name ?? "",
    province: seed?.province ?? "",
    area: seed?.area ?? "",
    address: seed?.address ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [note, setNote] = useState(order?.note ?? "");
  const [cashier, setCashier] = useState(order?.cashierOrderId ?? "");
  // The jars: cash to the driver, paid in advance (Qi Card, ZainCash…), or a free gift from ÉLUE.
  const [jarsPay, setJarsPay] = useState<JarsPay>(
    order?.paid ? (order.payMethod === "GIFT" || order.paidNote === "هدية" ? "gift" : "prepaid") : "cash",
  );
  const paid = jarsPay !== "cash";
  // How it was paid in advance (shared by the jars and the delivery fee) and its transaction number.
  const [method, setMethod] = useState<PayMethod | "">(
    order?.payMethod === "QI" || order?.payMethod === "ZAINCASH" || order?.payMethod === "OTHER" ? order.payMethod : "",
  );
  const [payRef, setPayRef] = useState(order?.payRef ?? "");
  const [other, setOther] = useState(order?.paidNote && order.paidNote !== "هدية" ? order.paidNote : "");
  const [payErrors, setPayErrors] = useState<{ method?: string; payRef?: string; other?: string }>({});
  // The delivery fee: paid to the driver, already paid by the customer, or a gift from ÉLUE.
  const [deliveryPay, setDeliveryPay] = useState<DeliveryPay>(order ? deliveryPayOf(order) : "driver");
  const prepaidSomething = jarsPay === "prepaid" || deliveryPay === "prepaid";
  // Inside Baghdad the customer must have accepted the 6–10 pm delivery window.
  const [slot, setSlot] = useState<SlotKey>(isSlotKey(order?.deliverySlot) ? order.deliverySlot : DEFAULT_SLOT);
  const [slotDate, setSlotDate] = useState(order?.deliveryDate ?? "");
  const inBaghdad = delivery.province === site.baghdadWindow.province;
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
  // Orders of site.freeDeliveryMinJars jars or more: delivery is free automatically.
  const autoFreeDelivery = deliveryPay === "driver" && freeDeliveryFor(jars);
  const driverCollects = modonCollect(total, paid, deliveryPay);

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
    // Paid in advance: the method and the transaction number are required.
    const pe: typeof payErrors = {};
    if (prepaidSomething) {
      if (!method) pe.method = "اختر طريقة الدفع.";
      else {
        if (needsPayRef(method) && !payRef.trim()) pe.payRef = "اكتب رقم العملية أو الحوالة.";
        if (method === "OTHER" && !other.trim()) pe.other = "اكتب ما هي طريقة الدفع.";
      }
    }
    setPayErrors(pe);
    if (Object.keys(pe).length) {
      document.getElementById("order-pay")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const info = cleanDelivery(delivery);
    const customerPhone = normalizeIraqiMobile(phone)!;
    const savedMethod: PayMethod | null = jarsPay === "gift" ? "GIFT" : prepaidSomething && method ? method : null;
    const savedRef = savedMethod && needsPayRef(savedMethod) ? payRef.trim() : null;
    const savedNote = savedMethod === "OTHER" ? other.trim() || null : null;
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
        payMethod: order.payMethod ?? null,
        payRef: order.payRef ?? null,
        freeDelivery: Boolean(order.freeDelivery),
        deliveryPaid: Boolean(order.deliveryPaid),
        deliverySlot: order.deliverySlot ?? null,
        deliveryDate: order.deliveryDate ?? null,
      };
      const after = {
        phone: customerPhone,
        ...info,
        note: note.trim() || null,
        cashierOrderId: cashier.trim() || null,
        paid,
        paidNote: savedNote,
        payMethod: savedMethod,
        payRef: savedRef,
        freeDelivery: deliveryPay === "gift" || autoFreeDelivery,
        deliveryPaid: deliveryPay === "prepaid",
        deliverySlot: inBaghdad ? slot : null,
        deliveryDate: inBaghdad && slotDate ? slotDate : null,
      };
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(after) as (keyof typeof after)[]) {
        if (after[key] !== before[key]) changes[key] = after[key];
      }
      const sameItems =
        JSON.stringify(items.map((i) => [i.slug, i.qty])) ===
        JSON.stringify(products.filter((p) => oldQty[p.slug]).map((p) => [p.slug, oldQty[p.slug]]));
      if (!sameItems) Object.assign(changes, { items, jars, total });
      if (inBaghdad && !order.slotAccepted) changes.slotAccepted = true;
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
      const modonFields = ["phone", "name", "province", "area", "address", "note", "items", "paid", "freeDelivery", "deliveryPaid"];
      if (order.modonQr && modonFields.some((k) => k in changes)) {
        const { error } = await callModon({ action: "update", orderId: order.id });
        toast(
          error
            ? { id: "admin", tone: "attention", message: `حُفظت التعديلات هنا، لكن لم تُحدَّث لدى مدن: ${error} اتصل بمدن.` }
            : { id: "admin", message: `حُفظت تعديلات ${order.orderNumber} وحُدّثت لدى مدن.` },
        );
      } else if (order.boxyUid && modonFields.some((k) => k in changes)) {
        const { error } = await callBoxy({ action: "update", orderId: order.id });
        toast(
          error
            ? { id: "admin", tone: "attention", message: `حُفظت التعديلات هنا، لكن لم تُحدَّث لدى بوكسي: ${error} اتصل ببوكسي.` }
            : { id: "admin", message: `حُفظت تعديلات ${order.orderNumber} وحُدّثت لدى بوكسي.` },
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
      paidNote: savedNote ?? undefined,
      payMethod: savedMethod ?? undefined,
      payRef: savedRef ?? undefined,
      slotAccepted: inBaghdad ? true : undefined,
      deliverySlot: inBaghdad ? slot : undefined,
      deliveryDate: inBaghdad && slotDate ? slotDate : undefined,
      freeDelivery: deliveryPay === "gift",
      deliveryPaid: deliveryPay === "prepaid",
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
      if (fields.payMethod || fields.payRef) setPayErrors({ method: fields.payMethod, payRef: fields.payRef });
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

      <section className="order-detail__block" id="order-pay">
        <h2>الدفع والتوصيل</h2>
        <fieldset className="admin-order-form__group">
          <legend>ثمن العلب ({formatIQD(total)})</legend>
          {(
            [
              ["cash", "يدفعه العميل نقداً للمندوب عند الاستلام"],
              ["prepaid", "دفعه العميل مسبقاً (Qi Card أو زين كاش أو غيره)"],
              ["gift", "هدية من ÉLUE: العلب مجاناً"],
            ] as [JarsPay, string][]
          ).map(([value, label]) => (
            <label key={value} className="admin-order-form__check">
              <input
                type="radio"
                name="jars-pay"
                value={value}
                checked={jarsPay === value}
                onChange={() => {
                  setJarsPay(value);
                  if (value === "gift" && deliveryPay === "prepaid") setDeliveryPay("driver");
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="admin-order-form__group">
          <legend>أجور التوصيل ({formatIQD(site.deliveryFee)})</legend>
          {(
            [
              ["driver", "يدفعها العميل للمندوب عند الاستلام"],
              ["prepaid", "دفعها العميل مسبقاً (بطاقة أو تحويل)"],
              ["gift", "هدية من ÉLUE: توصيل مجاني ونتحمّل الأجور"],
            ] as [DeliveryPay, string][]
          )
            .filter(([value]) => !(value === "prepaid" && jarsPay === "gift"))
            .map(([value, label]) => (
              <label key={value} className="admin-order-form__check">
                <input
                  type="radio"
                  name="delivery-pay"
                  value={value}
                  checked={deliveryPay === value}
                  onChange={() => setDeliveryPay(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          {autoFreeDelivery && (
            <p className="panel-note">
              الطلب {site.freeDeliveryMinJars} علب أو أكثر، فالتوصيل مجاني تلقائياً ونتحمّل الأجور.
            </p>
          )}
        </fieldset>
        {prepaidSomething && (
          <fieldset className={payErrors.method ? "admin-order-form__group has-error" : "admin-order-form__group"}>
            <legend>طريقة الدفع المسبق</legend>
            {PAID_METHODS.map((m) => (
              <label key={m} className="admin-order-form__check">
                <input
                  type="radio"
                  name="pay-method"
                  value={m}
                  checked={method === m}
                  onChange={() => {
                    setMethod(m);
                    setPayErrors({});
                  }}
                />
                <span>{PAY_METHOD_LABELS[m]}</span>
              </label>
            ))}
            {payErrors.method && <span className="field-error">{payErrors.method}</span>}
            {method === "OTHER" && (
              <label className={payErrors.other ? "has-error" : undefined}>
                ما هي طريقة الدفع؟
                <input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  maxLength={120}
                  placeholder="مثل: حوالة بنكية، ماستر كارد"
                />
                {payErrors.other && <span className="field-error">{payErrors.other}</span>}
              </label>
            )}
            {method && (
              <label className={payErrors.payRef ? "has-error" : undefined}>
                رقم العملية أو الحوالة (مطلوب)
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  dir="ltr"
                  maxLength={80}
                  placeholder="رقم التتبع الذي يظهر للعميل بعد الدفع"
                  aria-invalid={payErrors.payRef ? true : undefined}
                />
                {payErrors.payRef && <span className="field-error">{payErrors.payRef}</span>}
              </label>
            )}
          </fieldset>
        )}
        <p className="admin-order-form__collect">
          يستلم المندوب من العميل <strong>{formatIQD(driverCollects)}</strong>
          <small>{collectBreakdown(total, paid, deliveryPay)}</small>
        </p>
      </section>

      {inBaghdad && (
        <section className="order-detail__block" id="order-slot">
          <SlotPicker id="order-slot-picker" slot={slot} date={slotDate} onSlot={setSlot} onDate={setSlotDate} />
        </section>
      )}

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

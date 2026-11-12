"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { DeliveryFields, type DeliveryFieldsHandle } from "./DeliveryFields";
import { SlotPicker } from "./SlotPicker";
import { CouponBox, PriceLines, useQuote } from "./CouponBox";
import { commissionFor, couponEffect, priceOrder, type CouponRule } from "@/lib/coupons";
import { DEFAULT_SLOT, isSlotKey, type SlotKey } from "@/lib/delivery-slot";
import { callModon } from "./AdminModon";
import { callBoxy } from "./AdminBoxy";
import { dataClient, errorCode, errorDetail, errorFields, type Order } from "@/lib/data";
import { products } from "@/lib/products";
import { HEARD_OPTIONS, type HeardKey } from "@/lib/attribution";
import { MAX_QTY_PER_LINE } from "@/lib/order-text";
import { collectBreakdown, modonCollect } from "@/lib/modon";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { deliveryPayOf, formatIQD, freeDeliveryFor, needsPayRef, PAID_METHODS, PAY_METHOD_LABELS, site, type DeliveryPay, type PayMethod } from "@/lib/site";
import { checkDelivery, cleanDelivery, phone2Error, phoneError, type DeliveryInfo, type FieldErrors } from "@/lib/validate";
import { giftCampaignLive, giftLines, MANUAL_GIFT, MAX_GIFT_UNITS, paidLines } from "@/lib/gifts";
import { callGiftAdmin, giftErrorText, listGiftCampaigns, type GiftCampaign } from "@/lib/gift-admin";

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
  const [phone2, setPhone2] = useState(seed?.phone2 ? formatIraqiMobile(seed.phone2) : "");
  const [phone2Err, setPhone2Err] = useState("");
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    name: seed?.name ?? "",
    province: seed?.province ?? "",
    area: seed?.area ?? "",
    address: seed?.address ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [note, setNote] = useState(order?.note ?? "");
  // «How did the customer hear about us?»: asked in the chat, recorded here for ad attribution.
  const [heard, setHeard] = useState<"" | HeardKey>((order?.heardFrom as HeardKey | null | undefined) ?? "");
  const [heardNote, setHeardNote] = useState(order?.heardNote ?? "");
  const [heardErr, setHeardErr] = useState("");
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
  // Paid jars. Gift jars (price 0, lib/gifts.ts) are their own lines, edited below.
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(paidLines(order?.items).map((i) => [i.slug, i.qty])),
  );
  const [busy, setBusy] = useState(false);

  // Gift jars: a live campaign's gift (counts against its total and the phone's allowance)
  // or a manual gift from the team (no limits). Checked and saved by the server.
  const oldGifts = giftLines(order?.items);
  const oldGiftKey = JSON.stringify([order?.giftCampaignId ?? "", products.map((p) => oldGifts.find((g) => g.slug === p.slug)?.qty ?? 0)]);
  const [giftQty, setGiftQty] = useState<Record<string, number>>(() => Object.fromEntries(oldGifts.map((i) => [i.slug, i.qty])));
  const [giftKind, setGiftKind] = useState<string>(order?.giftCampaignId ?? "");
  const [giftCampaigns, setGiftCampaigns] = useState<GiftCampaign[]>([]);
  useEffect(() => {
    let alive = true;
    listGiftCampaigns()
      .then((all) => {
        if (!alive) return;
        const usable = all.filter((c) => giftCampaignLive(c) || c.id === order?.giftCampaignId);
        setGiftCampaigns(usable);
        setGiftKind((k) => k || usable.find((c) => giftCampaignLive(c))?.id || MANUAL_GIFT);
      })
      .catch(() => alive && setGiftKind((k) => k || MANUAL_GIFT));
    return () => {
      alive = false;
    };
  }, [order?.giftCampaignId]);
  const giftCampaign = giftCampaigns.find((c) => c.id === giftKind) ?? null;
  // A campaign gives only its own flavors; a manual gift can be any flavor.
  const giftProducts = giftCampaign ? products.filter((p) => (giftCampaign.products ?? []).includes(p.slug)) : products;
  const giftPicks = giftProducts.filter((p) => (giftQty[p.slug] ?? 0) > 0).map((p) => ({ slug: p.slug, qty: giftQty[p.slug] }));
  const giftUnits = giftPicks.reduce((n, g) => n + g.qty, 0);
  const giftKey = JSON.stringify([giftUnits ? giftKind : "", products.map((p) => giftPicks.find((g) => g.slug === p.slug)?.qty ?? 0)]);
  const giftsChanged = giftKey !== oldGiftKey;

  // Existing lines keep the price they were sold at; new lines use today's price.
  const oldQty: Record<string, number> = Object.fromEntries(paidLines(order?.items).map((i) => [i.slug, i.qty]));
  const oldPrice = Object.fromEntries(paidLines(order?.items).map((i) => [i.slug, i.price]));
  const lines = products
    .filter((p) => (qty[p.slug] ?? 0) > 0)
    .map((p) => ({ product: p, qty: qty[p.slug], price: oldPrice[p.slug] ?? p.price }));
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  // Coupon: an existing order keeps its own (re-priced if the jars change); a new order is
  // priced by the server for this customer (their credit and limits).
  const savedRule: CouponRule | null = (() => {
    try {
      return order?.coupon ? (JSON.parse(String(order.coupon)) as CouponRule) : null;
    } catch {
      return null;
    }
  })();
  const [couponCode, setCouponCode] = useState("");
  const customerForQuote = normalizeIraqiMobile(phone) ?? "";
  const { quote, loading: quoting } = useQuote({
    items: lines.map((l) => ({ slug: l.product.slug, qty: l.qty })),
    couponCode,
    refCode: "",
    signedIn: true,
    phone: customerForQuote,
    enabled: !editing && Boolean(customerForQuote) && jarsPay === "cash",
  });
  const edited = priceOrder(
    lines.map((l) => ({ price: l.price, qty: l.qty })),
    savedRule,
    order?.creditUsed ?? 0,
  );
  const total = editing ? edited.total : jarsPay === "cash" && quote ? quote.total : lines.reduce((n, l) => n + l.qty * l.price, 0);
  // Orders of site.freeDeliveryMinJars jars or more (or a free-delivery code): delivery is free automatically.
  const autoFreeDelivery =
    deliveryPay === "driver" && (freeDeliveryFor(jars) || (editing ? edited.freeDelivery : Boolean(quote?.freeDelivery)));
  const driverCollects = modonCollect(total, paid, deliveryPay);

  function step(slug: string, by: number) {
    setQty((q) => ({ ...q, [slug]: Math.min(MAX_QTY_PER_LINE, Math.max(0, (q[slug] ?? 0) + by)) }));
  }
  function stepGift(slug: string, by: number) {
    setGiftQty((q) => ({ ...q, [slug]: Math.min(MAX_GIFT_UNITS, Math.max(0, (q[slug] ?? 0) + by)) }));
  }

  async function save() {
    if (busy) return;
    const pErr = phoneError(phone);
    const p2Err = phone2Error(phone2);
    setPhone2Err(p2Err ?? "");
    const found = checkDelivery(delivery);
    setPhoneErr(pErr ?? "");
    setErrors(found);
    if (pErr) return phoneRef.current?.focus();
    if (p2Err) return;
    if (Object.keys(found).length) return fieldsRef.current?.focusFirstError(found);
    if (!lines.length) {
      toast({ id: "admin", tone: "attention", message: "أضف نكهة واحدة على الأقل." });
      return;
    }
    // A new order must say how the customer heard of ÉLUE (edits of old orders may leave it empty).
    if (!order && !heard) {
      setHeardErr("اختر كيف سمع الزبون عنا.");
      document.getElementById("order-heard")?.scrollIntoView({ block: "center", behavior: "smooth" });
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
        phone2: order.phone2 ?? null,
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
        phone2: phone2.trim() ? normalizeIraqiMobile(phone2) : null,
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
      if (!sameItems) {
        // The gift lines stay as they are here: the server replaces them (setGifts below).
        const keptGifts = oldGifts.map((g) => ({ slug: g.slug, nameAr: g.nameAr, nameEn: g.nameEn, qty: g.qty, price: 0, gift: true, campaignId: g.campaignId ?? order.giftCampaignId ?? MANUAL_GIFT }));
        Object.assign(changes, { items: [...items, ...keptGifts], jars, total });
        // A coupon / credit on the order: the discount follows the new jars.
        if (savedRule || order.creditUsed || order.discount) {
          const oldLines = paidLines(order.items).map((i) => ({ price: i.price, qty: i.qty }));
          const oldFree = couponEffect(savedRule, oldLines).freeJars;
          const perJar = order.commission ? order.commission / Math.max(1, order.jars - oldFree) : 0;
          Object.assign(changes, {
            subtotal: edited.subtotal,
            discount: edited.discount || null,
            creditUsed: edited.creditUsed || null,
            cashback: edited.cashback || null,
            ...(order.commission != null ? { commission: Math.round(commissionFor(jars, edited.freeJars, perJar)) } : {}),
          });
        } else {
          changes.subtotal = total;
        }
      }
      if (inBaghdad && !order.slotAccepted) changes.slotAccepted = true;
      const heardNew = heard || null;
      const heardNoteNew = heard === "creator" || heard === "other" ? heardNote.trim().slice(0, 100) || null : null;
      if (heardNew !== (order.heardFrom ?? null)) changes.heardFrom = heardNew;
      if (heardNoteNew !== (order.heardNote ?? null)) changes.heardNote = heardNoteNew;
      if (!Object.keys(changes).length && !giftsChanged) {
        setBusy(false);
        onDone(order.orderNumber);
        return;
      }
      if (Object.keys(changes).length) {
        const { errors: gqlErrors } = await dataClient.models.Order.update({
          id: order.id,
          ...changes,
          editedBy: auth.phone,
          editedAt: new Date().toISOString(),
        });
        if (gqlErrors?.length) {
          setBusy(false);
          console.error("order edit failed", gqlErrors);
          toast({ id: "admin", tone: "attention", message: "تعذّر حفظ التعديلات. حاول مجددًا." });
          return;
        }
      }
      // The gift lines: checked on the server (campaign rules, jars left) and saved there.
      if (giftsChanged) {
        const { error } = await callGiftAdmin({ action: "setGifts", orderId: order.id, campaignId: giftKind || MANUAL_GIFT, gifts: giftPicks });
        if (error) {
          setBusy(false);
          toast({ id: "admin", tone: "attention", message: `${Object.keys(changes).length ? "حُفظت باقي التعديلات، لكن الهدية ما انحفظت: " : ""}${error}` });
          document.getElementById("order-gifts")?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        changes.items = true; // the parcel changed: the delivery company is updated below
      }
      setBusy(false);
      // Already at Modon: send the new details there too (only possible before pickup).
      // "paid" changes the amount the driver collects, so it must re-sync.
      const modonFields = ["phone", "phone2", "name", "province", "area", "address", "note", "items", "paid", "freeDelivery", "deliveryPaid"];
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
      phone2: phone2.trim() || undefined,
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
      couponCode: jarsPay === "cash" && quote?.coupon?.ok ? quote.coupon.code : undefined,
      heardFrom: heard || undefined,
      heardNote: heard === "creator" || heard === "other" ? heardNote.trim().slice(0, 100) || undefined : undefined,
      gifts: giftUnits ? JSON.stringify(giftPicks) : undefined,
      giftCampaignId: giftUnits ? giftKind || MANUAL_GIFT : undefined,
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
    if (code === "coupon") return toast({ id: "admin", tone: "attention", message: errorDetail(gqlErrors) });
    if (code === "gift") {
      document.getElementById("order-gifts")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return toast({ id: "admin", tone: "attention", message: giftErrorText(gqlErrors) });
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
        <label className={phone2Err ? "has-error" : undefined}>
          رقم هاتف ثانٍ (اختياري)
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            placeholder="0771 234 5678"
            value={phone2}
            onChange={(e) => {
              setPhone2(e.target.value);
              if (phone2Err) setPhone2Err(phone2Error(e.target.value) ?? "");
            }}
          />
          {phone2Err && <span className="field-error">{phone2Err}</span>}
        </label>
        <label>
          ملاحظة (اختياري)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
        </label>
        <label id="order-heard">
          كيف سمع عنا؟{order ? " (اختياري)" : ""}
          <select
            value={heard}
            onChange={(e) => {
              setHeard(e.target.value as "" | HeardKey);
              setHeardErr("");
            }}
          >
            <option value="">{order ? "غير معروف" : "اختر..."}</option>
            {HEARD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {heardErr && <span className="field-error">{heardErr}</span>}
        </label>
        {(heard === "creator" || heard === "other") && (
          <label>
            {heard === "creator" ? "اسم المؤثر" : "تفاصيل"} (اختياري)
            <input value={heardNote} onChange={(e) => setHeardNote(e.target.value)} maxLength={100} />
          </label>
        )}
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
        {editing ? (
          (order?.discount || order?.creditUsed) && (
            <PriceLines
              quote={{
                subtotal: edited.subtotal,
                discount: edited.discount,
                creditUsed: edited.creditUsed,
                cashback: edited.cashback,
                coupon: order?.couponCode ? { code: order.couponCode, ok: true, label: order.couponLabel ?? undefined } : null,
              } as Parameters<typeof PriceLines>[0]["quote"]}
            />
          )
        ) : (
          jarsPay === "cash" && <PriceLines quote={quote} />
        )}
        <fieldset className="admin-order-form__group admin-order-form__gifts" id="order-gifts">
          <legend>هدايا: علب مجانية تنضاف للطلب بسعر 0</legend>
          <label>
            نوع الهدية
            <select value={giftKind} onChange={(e) => setGiftKind(e.target.value)}>
              {!giftKind && <option value="">جارٍ التحميل…</option>}
              {giftCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  حملة: {c.name}
                  {giftCampaignLive(c) ? "" : " (منتهية)"}
                </option>
              ))}
              <option value={MANUAL_GIFT}>هدية يدوية (خارج الحملات)</option>
            </select>
            <small className="field-hint">
              {giftCampaign
                ? `هدية الحملة تنحسب من كميتها (${giftCampaign.perOrder ?? 1} بالطلب، ${giftCampaign.perPhone ?? 1} لكل رقم).`
                : "الهدية اليدوية بلا حدود وما تنحسب من أي حملة."}
            </small>
          </label>
          <ul className="admin-order-form__items">
            {giftProducts.map((p) => (
              <li key={p.slug}>
                <span>
                  {p.nameAr}
                  <small dir="ltr">{p.nameEn}</small>
                </span>
                <span className="stepper stepper--small" role="group" aria-label={`هدية ${p.nameAr}`}>
                  <button type="button" onClick={() => stepGift(p.slug, 1)} aria-label="زيادة">
                    +
                  </button>
                  <output>{giftQty[p.slug] ?? 0}</output>
                  <button type="button" onClick={() => stepGift(p.slug, -1)} aria-label="إنقاص">
                    −
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
        <p className="order-card__total">
          <span>
            المجموع · {jars} علبة{giftUnits ? ` + ${giftUnits} هدية` : ""}
          </span>
          <strong>{formatIQD(total)}</strong>
        </p>
        {editing ? (
          order?.couponCode && (
            <p className="hint">
              الطلب عليه الكود <strong dir="ltr">{order.couponCode}</strong>
              {order.couponLabel ? ` (${order.couponLabel})` : ""}. يتعدّل الخصم تلقائياً إذا غيّرت العلب.
            </p>
          )
        ) : jarsPay === "cash" ? (
          <CouponBox code={couponCode} quote={quote} loading={quoting} onApply={setCouponCode} onRemove={() => setCouponCode("")} />
        ) : null}
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

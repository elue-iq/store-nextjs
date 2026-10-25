"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { useStock } from "./StockProvider";
import { jarsLabel } from "./AddToCart";
import { LoginPanel } from "./LoginPanel";
import { DeliveryFields, type DeliveryFieldsHandle } from "./DeliveryFields";
import { buildWhatsAppText, priceCart, type CartItem } from "@/lib/order-text";
import { formatIraqiMobile } from "@/lib/phone";
import { collectStatement, formatIQD, site } from "@/lib/site";
import { fullAddress } from "@/lib/iraq";
import { checkDelivery, cleanDelivery, ltr, type DeliveryInfo, type FieldErrors } from "@/lib/validate";
import { dataClient, errorCode, errorDetail, errorFields } from "@/lib/data";
import { OPEN_STATUSES } from "@/lib/order-rules";
import { EMPTY_DELIVERY, loadProfile, saveProfile, type Profile } from "@/lib/profile";

type Step = "checkout" | "sent" | "failed";

type Placed = DeliveryInfo & {
  orderNumber: string;
  createdAt: string;
  items: CartItem[];
  total: number;
  phone: string;
  note: string;
};

export function OrderFlow() {
  const cart = useCart();
  const toast = useToast();
  const auth = useAuth();
  const stock = useStock();
  const { lines, total } = priceCart(cart.items);
  const signedIn = auth.status === "signedIn";
  const soldOutLines = lines.filter((l) => !stock.isAvailable(l.product.slug));
  // The shop's own (admin) login is for the orders page, not for ordering as a customer.
  const teamDevice = signedIn && auth.isAdmin;

  const [step, setStep] = useState<Step>("checkout");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileState, setProfileState] = useState<"idle" | "loading" | "ready">("idle");
  const [editing, setEditing] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryInfo>(EMPTY_DELIVERY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveToAccount, setSaveToAccount] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // An order still being handled blocks a new one (the server checks this too).
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [pdfSaved, setPdfSaved] = useState(false);
  const autoSaveStarted = useRef(false);
  const fields = useRef<DeliveryFieldsHandle>(null);

  useEffect(() => {
    if (!signedIn || teamDevice || !auth.owner) return setOpenOrder(null);
    let cancelled = false;
    dataClient.models.Order.listOrderByOwner(
      { owner: auth.owner },
      { limit: 200, selectionSet: ["orderNumber", "status", "createdAt"] },
    )
      .then(({ data }) => {
        if (cancelled) return;
        const open = (data ?? [])
          .filter((o) => (OPEN_STATUSES as readonly string[]).includes(o.status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOpenOrder(open[0]?.orderNumber ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn, teamDevice, auth.owner, step]);

  // After login: load the saved delivery details once.
  useEffect(() => {
    if (!signedIn || teamDevice) {
      setProfile(null);
      setProfileState("idle");
      return;
    }
    let cancelled = false;
    setProfileState("loading");
    loadProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        if (p) setDelivery({ name: p.name, province: p.province, area: p.area, address: p.address });
        setEditing(!p);
      })
      .catch(() => {
        if (!cancelled) setEditing(true);
      })
      .finally(() => {
        if (!cancelled) setProfileState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, teamDevice, auth.owner]);

  // ---- PDF ---------------------------------------------------------------

  const savePdf = useCallback(
    async (p: Placed, automatic: boolean) => {
      try {
        const { lines: priced } = priceCart(p.items);
        const { saveOrderPdf } = await import("@/lib/receipt");
        await saveOrderPdf({
          ...p,
          items: priced.map((l) => ({ slug: l.product.slug, nameAr: l.product.nameAr, nameEn: l.product.nameEn, qty: l.qty, price: l.product.price })),
        });
        setPdfSaved(true);
        toast({ id: automatic ? "checkout" : "pdf", message: "حفظنا ملخص الطلب (PDF) على جهازك." });
      } catch {
        if (!automatic) toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاول مجددًا." });
      }
    },
    [toast],
  );

  useEffect(() => {
    if (step === "sent" && placed && !autoSaveStarted.current) {
      autoSaveStarted.current = true;
      void savePdf(placed, true);
    }
  }, [step, placed, savePdf]);

  // ---- Actions -----------------------------------------------------------

  function showErrors(found: FieldErrors) {
    setEditing(true);
    setErrors(found);
    setTimeout(() => fields.current?.focusFirstError(found), 0);
    toast({ id: "checkout", tone: "attention", message: "يُرجى مراجعة الحقول المشار إليها." });
  }

  async function placeOrder() {
    if (busy || teamDevice || openOrder) return;
    if (soldOutLines.length) {
      toast({
        id: "checkout",
        tone: "attention",
        message: `نفدت كمية ${soldOutLines.map((l) => l.product.nameAr).join(" و")}. أزلها من السلة لإتمام الطلب.`,
      });
      return;
    }
    const found = checkDelivery(delivery);
    if (Object.keys(found).length) return showErrors(found);
    const info = cleanDelivery(delivery);

    setBusy(true);
    // Keep the details for next time (a failure here must not block the order).
    if (editing && saveToAccount) {
      try {
        setProfile(await saveProfile(info, profile?.id));
      } catch (err) {
        console.error("profile save failed", err);
      }
    }

    const snapshot = { ...info, items: cart.items, total, phone: auth.phone, note: note.trim() };
    try {
      const { data, errors: gqlErrors } = await dataClient.mutations.placeOrder({
        ...info,
        note: snapshot.note || undefined,
        source: cart.source || undefined,
        items: JSON.stringify(cart.items),
      });
      if (data?.orderNumber) {
        setPlaced({ ...snapshot, orderNumber: data.orderNumber, createdAt: data.createdAt });
        setStep("sent");
        cart.clear();
        toast({ id: "checkout", message: `استلمنا طلبك رقم ${ltr(data.orderNumber)}.` });
        window.scrollTo({ top: 0 });
        return;
      }
      const code = errorCode(gqlErrors);
      if (code === "invalid_fields") {
        showErrors(errorFields(gqlErrors) as FieldErrors);
      } else if (code === "out_of_stock") {
        await stock.refresh();
        toast({
          id: "checkout",
          tone: "attention",
          message: "نفدت كمية بعض النكهات في سلتك قبل قليل. أزلها من السلة ثم أكّد الطلب.",
        });
      } else if (code === "open_order") {
        setOpenOrder(errorDetail(gqlErrors) || "—");
        window.scrollTo({ top: 0 });
      } else if (code === "too_many_orders") {
        toast({ id: "checkout", tone: "attention", message: "وصلت إلى الحد اليومي للطلبات. لطلب إضافي راسلنا عبر واتساب." });
      } else if (code === "too_many_jars") {
        toast({
          id: "checkout",
          tone: "attention",
          message: `أقصى عدد في الطلب الواحد ${errorDetail(gqlErrors)} علبة. للطلبات الأكبر راسلنا عبر واتساب.`,
        });
      } else if (code === "busy") {
        toast({ id: "checkout", tone: "attention", message: "طلبك قيد الإرسال الآن. انتظر لحظة قبل المحاولة مجددًا." });
      } else if (code === "empty_cart") {
        toast({ id: "checkout", tone: "attention", message: "السلة فارغة أو فيها خطأ. عُد إلى النكهات وأضفها من جديد." });
      } else if (code === "not_signed_in") {
        // The login on this device is no longer valid: log in again with a fresh code.
        await auth.signOut();
        toast({ id: "checkout", tone: "attention", message: "انتهت جلسة الدخول. سجّل الدخول مجددًا لإتمام الطلب." });
      } else {
        console.error("placeOrder failed", gqlErrors);
        setPlaced({ ...snapshot, orderNumber: "", createdAt: new Date().toISOString() });
        setStep("failed");
      }
    } catch (err) {
      console.error("placeOrder failed", err);
      setPlaced({ ...snapshot, orderNumber: "", createdAt: new Date().toISOString() });
      setStep("failed");
    } finally {
      setBusy(false);
    }
  }

  function changeQty(slug: string, nameAr: string, qty: number) {
    cart.setQty(slug, qty);
    toast({ id: `qty-${slug}`, message: qty < 1 ? `أزلنا ${nameAr} من السلة.` : `${nameAr}: ${jarsLabel(qty)}` });
  }

  // ---- Screens -----------------------------------------------------------

  if (step === "sent" && placed) {
    const followUp = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
      buildWhatsAppText(
        { name: placed.name, phoneDisplay: formatIraqiMobile(placed.phone), address: fullAddress(placed), note: placed.note },
        placed.items,
        placed.orderNumber,
      ),
    )}`;
    return (
      <div className="order-result">
        <h2>استلمنا طلبك</h2>
        <p className="order-result__id">
          رقم الطلب <strong dir="ltr">{placed.orderNumber}</strong>
        </p>
        <p>
          سيتواصل فريقنا معك عبر واتساب على الرقم <span dir="ltr">{formatIraqiMobile(placed.phone)}</span> لتأكيد موعد
          التوصيل. ويمكنك متابعة حالة الطلب من صفحة «حسابي».
        </p>
        <p className="order-result__muted">
          {pdfSaved
            ? "حفظنا ملخص الطلب (PDF) على جهازك، ليبقى رقم الطلب وتفاصيله معك."
            : "يمكنك تنزيل ملخص الطلب (PDF) ليبقى رقم الطلب وتفاصيله معك."}
        </p>
        <div className="order-result__actions">
          <Link className="btn btn--full" href="/account">
            تابع طلبك في «حسابي»
          </Link>
          <a className="btn btn--quiet btn--full" href={followUp} target="_blank" rel="noopener noreferrer">
            راسلنا عبر واتساب
          </a>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => void savePdf(placed, false)}>
            تنزيل ملخص الطلب (PDF)
          </button>
          <Link href="/" className="link-button order-result__home">
            العودة إلى الصفحة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  if (cart.ready && lines.length === 0 && step !== "failed") {
    return (
      <div className="order-empty">
        <p>سلتك فارغة. اختر نكهة للبدء.</p>
        <Link href="/#flavors" className="btn">
          تصفّح النكهات
        </Link>
      </div>
    );
  }

  const fallbackHref = placed
    ? `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
        buildWhatsAppText(
          {
            name: placed.name,
            phoneDisplay: placed.phone ? formatIraqiMobile(placed.phone) : "",
            address: fullAddress(placed),
            note: placed.note,
          },
          placed.items,
        ),
      )}`
    : `https://wa.me/${site.whatsappNumber}`;

  return (
    <div className="order-layout">
      <div className="order-summary">
        <h2>طلبك</h2>
        <ul className="order-lines">
          {lines.map((l) => (
            <li key={l.product.slug} style={{ "--band": l.product.band } as React.CSSProperties}>
              <span className="order-lines__swatch" aria-hidden="true" />
              <span className="order-lines__name">
                {l.product.nameAr}
                <small dir="ltr">{l.product.kcalPerPiece} kcal average piece</small>
                {!stock.isAvailable(l.product.slug) && <strong className="order-lines__soldout">نفدت الكمية حاليًا</strong>}
              </span>
              <span className="stepper stepper--small" role="group" aria-label={`كمية ${l.product.nameAr}`}>
                <button type="button" onClick={() => changeQty(l.product.slug, l.product.nameAr, l.qty - 1)} aria-label="إنقاص الكمية">
                  −
                </button>
                <output>{l.qty}</output>
                <button type="button" onClick={() => changeQty(l.product.slug, l.product.nameAr, l.qty + 1)} aria-label="زيادة الكمية">
                  +
                </button>
              </span>
              <span className="order-lines__price">{formatIQD(l.subtotal)}</span>
            </li>
          ))}
        </ul>
        <p className="order-total">
          <span>المجموع</span>
          <strong>{formatIQD(total)}</strong>
        </p>
        <p className="order-pay">{collectStatement(total)}</p>
        <p className="order-pay">{site.paymentNote}</p>
      </div>

      <div className="order-form">
        {step === "failed" ? (
          <div className="order-failed" role="alert">
            <h2>لنُكمل طلبك عبر واتساب</h2>
            <p>حدث خلل أثناء إرسال الطلب. طلبك محفوظ على هذا الجهاز، والرسالة جاهزة: اضغط الزر وأرسلها إلينا مباشرة.</p>
            <a className="btn btn--full" href={fallbackHref} target="_blank" rel="noopener noreferrer">
              أرسل الطلب عبر واتساب
            </a>
            <button
              type="button"
              className="btn btn--quiet btn--full"
              disabled={busy}
              onClick={() => {
                setStep("checkout");
                void placeOrder();
              }}
            >
              {busy ? "جارٍ الإرسال…" : "حاول مجددًا"}
            </button>
          </div>
        ) : auth.status === "loading" ? (
          <p className="panel-loading">لحظة من فضلك…</p>
        ) : auth.status === "signedOut" ? (
          <LoginPanel
            compact
            title="سجّل الدخول لإتمام الطلب"
            intro="نتحقق من رقم الواتساب مرة واحدة فقط، ثم تُحفظ معلومات التوصيل في حسابك وتتابع طلباتك منه."
          />
        ) : teamDevice ? (
          <div className="order-failed" role="note">
            <h2>هذا الجهاز مسجَّل بحساب الفريق</h2>
            <p>
              الحساب الحالي (<span dir="ltr">{formatIraqiMobile(auth.phone)}</span>) مخصص للوحة الطلبات. لإرسال طلب، سجّل
              الخروج ثم ادخل برقم العميل.
            </p>
            <button type="button" className="btn btn--quiet btn--full" onClick={() => void auth.signOut()}>
              تسجيل الخروج
            </button>
          </div>
        ) : profileState !== "ready" ? (
          <p className="panel-loading">نجهّز معلومات التوصيل…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void placeOrder();
            }}
            noValidate
          >
            <h2>التوصيل</h2>

            <div className="account-phone">
              <span>رقم الواتساب</span>
              <strong dir="ltr">{formatIraqiMobile(auth.phone)}</strong>
              <button type="button" className="link-button" onClick={() => void auth.signOut()}>
                ليس رقمك؟ سجّل الخروج
              </button>
            </div>

            {editing ? (
              <>
                <DeliveryFields
                  ref={fields}
                  idPrefix="checkout"
                  values={delivery}
                  errors={errors}
                  onChange={setDelivery}
                  onErrors={setErrors}
                />
                <label className="check">
                  <input type="checkbox" checked={saveToAccount} onChange={(e) => setSaveToAccount(e.target.checked)} />
                  حفظ هذه المعلومات في حسابي للطلبات القادمة
                </label>
              </>
            ) : (
              <div className="delivery-card">
                <div>
                  <strong>{delivery.name}</strong>
                  <p>{fullAddress(delivery)}</p>
                </div>
                <button type="button" className="link-button" onClick={() => setEditing(true)}>
                  تعديل
                </button>
              </div>
            )}

            <label>
              <span>
                ملاحظة <span className="optional">(اختيارية)</span>
              </span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
            </label>

            {openOrder && (
              <div className="field-note open-order" role="alert">
                <p>
                  لديك طلب قيد التنفيذ رقم <strong dir="ltr">{openOrder}</strong>. يمكنك طلب جديد بعد توصيله.
                </p>
                <p>
                  لإضافة شيء إليه أو تعديله، راسلنا عبر واتساب.{" "}
                  <a href={`/account?order=${encodeURIComponent(openOrder)}`}>عرض الطلب</a>
                </p>
              </div>
            )}
            {soldOutLines.length > 0 && (
              <p className="field-note" role="alert">
                نفدت كمية {soldOutLines.map((l) => l.product.nameAr).join(" و")} حاليًا. أزلها من السلة لإتمام الطلب.
              </p>
            )}
            <button type="submit" className="btn btn--full" disabled={busy || soldOutLines.length > 0 || Boolean(openOrder)}>
              {busy ? "جارٍ إرسال الطلب…" : `تأكيد الطلب · ${formatIQD(total)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

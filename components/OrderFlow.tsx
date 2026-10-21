"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { jarsLabel } from "./AddToCart";
import { LoginPanel } from "./LoginPanel";
import { DeliveryFields, type DeliveryFieldsHandle } from "./DeliveryFields";
import { buildWhatsAppText, priceCart, type CartItem } from "@/lib/order-text";
import { formatIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { fullAddress } from "@/lib/iraq";
import { checkDelivery, cleanDelivery, ltr, type DeliveryInfo, type FieldErrors } from "@/lib/validate";
import { dataClient, errorCode, errorFields } from "@/lib/data";
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
  const { lines, total } = priceCart(cart.items);
  const signedIn = auth.status === "signedIn";
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

  const [placed, setPlaced] = useState<Placed | null>(null);
  const [pdfSaved, setPdfSaved] = useState(false);
  const autoSaveStarted = useRef(false);
  const fields = useRef<DeliveryFieldsHandle>(null);

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
        toast({ id: automatic ? "checkout" : "pdf", message: "حفظنا ملخص الطلب (PDF) على جهازكم." });
      } catch {
        if (!automatic) toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاولوا مجددًا." });
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
    if (busy || teamDevice) return;
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
        toast({ id: "checkout", message: `استلمنا طلبكم رقم ${ltr(data.orderNumber)}.` });
        window.scrollTo({ top: 0 });
        return;
      }
      const code = errorCode(gqlErrors);
      if (code === "invalid_fields") {
        showErrors(errorFields(gqlErrors) as FieldErrors);
      } else if (code === "empty_cart") {
        toast({ id: "checkout", tone: "attention", message: "السلة فارغة أو فيها خطأ. عودوا إلى النكهات وأضيفوها من جديد." });
      } else if (code === "not_signed_in") {
        // The login on this device is no longer valid: log in again with a fresh code.
        await auth.signOut();
        toast({ id: "checkout", tone: "attention", message: "انتهت جلسة الدخول. سجّلوا الدخول مجددًا لإتمام الطلب." });
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
        <h2>استلمنا طلبكم</h2>
        <p className="order-result__id">
          رقم الطلب <strong dir="ltr">{placed.orderNumber}</strong>
        </p>
        <p>
          سيتواصل فريقنا معكم عبر واتساب على الرقم <span dir="ltr">{formatIraqiMobile(placed.phone)}</span> لتأكيد موعد
          التوصيل. ويمكنكم متابعة حالة الطلب من صفحة «حسابي».
        </p>
        <p className="order-result__muted">
          {pdfSaved
            ? "حفظنا ملخص الطلب (PDF) على جهازكم، ليبقى رقم الطلب وتفاصيله معكم."
            : "يمكنكم تنزيل ملخص الطلب (PDF) ليبقى رقم الطلب وتفاصيله معكم."}
        </p>
        <div className="order-result__actions">
          <Link className="btn btn--full" href="/account">
            تابعوا طلبكم في «حسابي»
          </Link>
          <a className="btn btn--quiet btn--full" href={followUp} target="_blank" rel="noopener noreferrer">
            راسلونا عبر واتساب
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
        <p>سلتكم فارغة. اختاروا نكهة للبدء.</p>
        <Link href="/#flavors" className="btn">
          تصفّحوا النكهات
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
        <h2>طلبكم</h2>
        <ul className="order-lines">
          {lines.map((l) => (
            <li key={l.product.slug} style={{ "--band": l.product.band } as React.CSSProperties}>
              <span className="order-lines__swatch" aria-hidden="true" />
              <span className="order-lines__name">
                {l.product.nameAr}
                <small dir="ltr">{l.product.kcalPerPiece} kcal average piece</small>
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
        <p className="order-pay">{site.paymentNote}</p>
      </div>

      <div className="order-form">
        {step === "failed" ? (
          <div className="order-failed" role="alert">
            <h2>لنُكمل طلبكم عبر واتساب</h2>
            <p>حدث خلل أثناء إرسال الطلب. طلبكم محفوظ على هذا الجهاز، والرسالة جاهزة: اضغطوا الزر وأرسلوها إلينا مباشرة.</p>
            <a className="btn btn--full" href={fallbackHref} target="_blank" rel="noopener noreferrer">
              أرسلوا الطلب عبر واتساب
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
              {busy ? "جارٍ الإرسال…" : "حاولوا مجددًا"}
            </button>
          </div>
        ) : auth.status === "loading" ? (
          <p className="panel-loading">لحظة من فضلكم…</p>
        ) : auth.status === "signedOut" ? (
          <LoginPanel
            compact
            title="سجّلوا الدخول لإتمام الطلب"
            intro="نتحقق من رقم الواتساب مرة واحدة فقط، ثم تُحفظ معلومات التوصيل في حسابكم وتتابعون طلباتكم منه."
          />
        ) : teamDevice ? (
          <div className="order-failed" role="note">
            <h2>هذا الجهاز مسجَّل بحساب الفريق</h2>
            <p>
              الحساب الحالي (<span dir="ltr">{formatIraqiMobile(auth.phone)}</span>) مخصص للوحة الطلبات. لإرسال طلب، سجّلوا
              الخروج ثم ادخلوا برقم العميل.
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
                ليس رقمكم؟ سجّلوا الخروج
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

            <button type="submit" className="btn btn--full" disabled={busy}>
              {busy ? "جارٍ إرسال الطلب…" : `تأكيد الطلب · ${formatIQD(total)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

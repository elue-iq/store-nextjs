"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { jarsLabel } from "./AddToCart";
import { CodeInput, type CodeInputHandle } from "./CodeInput";
import { buildWhatsAppText, priceCart, type CartItem } from "@/lib/order-text";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { CODE_LENGTH, ltr, addressError, checkFields, cleanName, nameError, phoneError, type Field, type FieldErrors } from "@/lib/validate";
import { confirmLoginCode, sendLoginCode } from "@/lib/auth-flow";
import { dataClient, errorCode, errorFields, newestFirst } from "@/lib/data";

type Step = "details" | "code" | "sent" | "failed";

type Placed = {
  orderNumber: string;
  createdAt: string;
  items: CartItem[];
  total: number;
  name: string;
  phone: string;
  address: string;
  note: string;
};

const RESEND_SECONDS = 60;
const FIELD_ORDER: Field[] = ["name", "phone", "address"];

export function OrderFlow() {
  const cart = useCart();
  const toast = useToast();
  const auth = useAuth();
  const { lines, total } = priceCart(cart.items);
  const signedIn = auth.status === "signedIn";
  // The shop's own (admin) login is for the orders page, not for ordering as a customer.
  const teamDevice = signedIn && auth.isAdmin;

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [placed, setPlaced] = useState<Placed | null>(null);
  const [pdfSaved, setPdfSaved] = useState(false);
  const autoSaveStarted = useRef(false);
  const prefilled = useRef(false);

  const inputs = {
    name: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    address: useRef<HTMLTextAreaElement>(null),
  };
  const codeBoxes = useRef<CodeInputHandle>(null);
  const focusPhoneNext = useRef(false);

  // Logged-in customers order with their account number; others type it.
  const phone = signedIn ? auth.phone : normalizeIraqiMobile(phoneInput);
  const phoneDisplay = phone ? formatIraqiMobile(phone) : "";

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "details" && focusPhoneNext.current) {
      focusPhoneNext.current = false;
      inputs.phone.current?.focus();
      inputs.phone.current?.select();
    }
  });

  // Returning customers: fill name and address from their last order.
  useEffect(() => {
    if (!signedIn || auth.isAdmin || !auth.owner || prefilled.current) return;
    prefilled.current = true;
    dataClient.models.Order.listOrderByOwner({ owner: auth.owner }, { selectionSet: ["name", "address", "createdAt"] })
      .then(({ data }) => {
        const last = [...(data ?? [])].sort(newestFirst)[0];
        if (!last) return;
        setName((v) => v || last.name);
        setAddress((v) => v || last.address);
      })
      .catch(() => {});
  }, [signedIn, auth.isAdmin, auth.owner]);

  // ---- PDF ---------------------------------------------------------------

  const savePdf = useCallback(
    async (p: Placed, automatic: boolean) => {
      try {
        const { lines: priced } = priceCart(p.items);
        const { saveOrderPdf } = await import("@/lib/receipt");
        await saveOrderPdf({
          orderNumber: p.orderNumber,
          createdAt: p.createdAt,
          items: priced.map((l) => ({ nameAr: l.product.nameAr, nameEn: l.product.nameEn, qty: l.qty, price: l.product.price })),
          total: p.total,
          name: p.name,
          phone: p.phone,
          address: p.address,
          note: p.note,
        });
        setPdfSaved(true);
        toast({ id: automatic ? "checkout" : "pdf", message: automatic ? "حفظنا ملخص طلبكم على جهازكم (PDF)" : "نزّلنا ملخص الطلب (PDF)" });
      } catch {
        if (!automatic) toast({ id: "pdf", tone: "attention", message: "ما گدرنا نجهز الملف هسه. حاولوا مرة ثانية." });
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

  // ---- Fields ------------------------------------------------------------

  const fieldCheck: Record<Field, (v: string) => string | null> = { name: nameError, phone: phoneError, address: addressError };
  const fieldValue: Record<Field, string> = { name, phone: signedIn ? auth.phone : phoneInput, address };

  function recheck(field: Field, value: string, always: boolean) {
    if (!always && !errors[field]) return;
    const message = fieldCheck[field](value);
    setErrors((e) => {
      const next = { ...e };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function showFieldErrors(found: FieldErrors) {
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) inputs[first].current?.focus();
    toast({ id: "checkout", tone: "attention", message: "تأكدوا من المعلومات المؤشرة بالأسفل." });
  }

  // ---- Actions -----------------------------------------------------------

  async function submitDetails() {
    const found = checkFields({ name, phone: fieldValue.phone, address });
    if (Object.keys(found).length) return showFieldErrors(found);
    if (teamDevice) return;
    if (signedIn) return placeNow();
    await sendCode(false);
  }

  async function sendCode(isResend: boolean) {
    if (!phone) return;
    setBusy(true);
    const result = await sendLoginCode(phone);
    setBusy(false);
    if (result === "sent") {
      setCode("");
      setCodeError("");
      setStep("code");
      setResendIn(RESEND_SECONDS);
      codeBoxes.current?.clear();
      toast({
        id: "checkout",
        message: isResend ? "أرسلنا رمز جديد على الواتساب" : `أرسلنا الرمز على الواتساب للرقم ${ltr(phoneDisplay)}`,
      });
    } else if (result === "rate_limited") {
      toast({ id: "checkout", tone: "attention", message: "طلبتوا رموز كثيرة لهذا الرقم. حاولوا بعد 10 دقائق." });
    } else if (result === "invalid_phone") {
      setStep("details");
      showFieldErrors({ phone: phoneError("x") ?? "" });
    } else {
      toast({ id: "checkout", tone: "attention", message: "ما گدرنا نرسل الرمز هسه. تأكدوا من الرقم وحاولوا بعد شوية." });
    }
  }

  function changeNumber() {
    setStep("details");
    setCode("");
    setCodeError("");
    setResendIn(0);
    focusPhoneNext.current = true;
    toast({ id: "checkout", message: "عدّلوا رقم الواتساب وأرسلوا رمز جديد" });
  }

  async function confirmCode(value: string) {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    const result = await confirmLoginCode(value);
    setBusy(false);
    if (result === "ok") {
      await auth.refresh();
      await placeNow();
    } else if (result === "wrong") {
      setCodeError("الرمز غير صحيح. تأكدوا منه وجربوا مرة ثانية.");
      codeBoxes.current?.clear();
      toast({ id: "checkout", tone: "attention", message: "الرمز غير صحيح" });
    } else {
      setCodeError("انتهت صلاحية الرمز أو جربتوه أكثر من مرة. اطلبوا رمز جديد.");
      setResendIn(0);
      codeBoxes.current?.clear();
      toast({ id: "checkout", tone: "attention", message: "اطلبوا رمز جديد حتى تكملون" });
    }
  }

  async function placeNow() {
    const snapshot = {
      items: cart.items,
      total,
      name: cleanName(name),
      phone: phone ?? "",
      address: address.trim(),
      note: note.trim(),
    };
    setBusy(true);
    try {
      const { data, errors: gqlErrors } = await dataClient.mutations.placeOrder({
        name: snapshot.name,
        address: snapshot.address,
        note: snapshot.note || undefined,
        source: cart.source || undefined,
        items: JSON.stringify(cart.items),
      });
      if (data?.orderNumber) {
        setPlaced({ ...snapshot, orderNumber: data.orderNumber, createdAt: data.createdAt });
        setStep("sent");
        cart.clear();
        toast({ id: "checkout", message: `وصلنا طلبكم رقم ${ltr(data.orderNumber)}` });
        window.scrollTo({ top: 0 });
        return;
      }
      const codeName = errorCode(gqlErrors);
      if (codeName === "invalid_fields") {
        setStep("details");
        showFieldErrors(errorFields(gqlErrors) as FieldErrors);
      } else if (codeName === "empty_cart") {
        toast({ id: "checkout", tone: "attention", message: "السلة فارغة أو فيها خطأ. ارجعوا للنكهات وضيفوها من جديد." });
      } else if (codeName === "not_signed_in") {
        // The login on this device is no longer valid: start over with a fresh code.
        await auth.signOut();
        setStep("details");
        toast({ id: "checkout", tone: "attention", message: "انتهى تسجيل الدخول. أكدوا رقمكم برمز جديد حتى نكمل الطلب." });
      } else {
        console.error("placeOrder failed", gqlErrors);
        setPlaced({ ...snapshot, orderNumber: "", createdAt: new Date().toISOString() });
        setStep("failed");
        toast({ id: "checkout", tone: "attention", message: "نكمل طلبكم على الواتساب" });
      }
    } catch (err) {
      console.error("placeOrder failed", err);
      setPlaced({ ...snapshot, orderNumber: "", createdAt: new Date().toISOString() });
      setStep("failed");
      toast({ id: "checkout", tone: "attention", message: "نكمل طلبكم على الواتساب" });
    } finally {
      setBusy(false);
    }
  }

  function changeQty(slug: string, nameAr: string, qty: number) {
    cart.setQty(slug, qty);
    toast({ id: `qty-${slug}`, message: qty < 1 ? `شلنا ${nameAr} من السلة` : `${nameAr}: ${jarsLabel(qty)}` });
  }

  // ---- Screens -----------------------------------------------------------

  if (step === "sent" && placed) {
    const details = { name: placed.name, phoneDisplay: formatIraqiMobile(placed.phone), address: placed.address, note: placed.note };
    const followUp = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
      buildWhatsAppText(details, placed.items, placed.orderNumber),
    )}`;
    return (
      <div className="order-result">
        <h2>وصلنا طلبكم</h2>
        <p className="order-result__id">
          رقم الطلب <strong dir="ltr">{placed.orderNumber}</strong>
        </p>
        <p>
          فريقنا راح يتواصل وياكم على الواتساب على الرقم <span dir="ltr">{details.phoneDisplay}</span> لتأكيد التوصيل.
          تكدرون تتابعون حالة الطلب من صفحة «طلباتي».
        </p>
        <p className="order-result__muted">
          {pdfSaved
            ? "حفظنا ملخص الطلب (PDF) على جهازكم، حتى يبقى عندكم رقم الطلب وتفاصيله."
            : "تكدرون تنزّلون ملخص الطلب (PDF) حتى يبقى عندكم رقم الطلب وتفاصيله."}
        </p>
        <div className="order-result__actions">
          <Link className="btn btn--full" href="/account">
            تابعوا طلبكم بصفحة طلباتي
          </Link>
          <a className="btn btn--quiet btn--full" href={followUp} target="_blank" rel="noopener noreferrer">
            راسلونا على الواتساب
          </a>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => void savePdf(placed, false)}>
            تحميل ملخص الطلب (PDF)
          </button>
          <Link href="/" className="link-button order-result__home">
            الرجوع للصفحة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  if (cart.ready && lines.length === 0 && step !== "failed") {
    return (
      <div className="order-empty">
        <p>السلة فارغة. اختاروا نكهة حتى تبدون.</p>
        <Link href="/#flavors" className="btn">
          شوفوا النكهات
        </Link>
      </div>
    );
  }

  const fallbackHref = placed
    ? `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
        buildWhatsAppText(
          { name: placed.name, phoneDisplay: placed.phone ? formatIraqiMobile(placed.phone) : "", address: placed.address, note: placed.note },
          placed.items,
        ),
      )}`
    : `https://wa.me/${site.whatsappNumber}`;

  const fieldProps = (field: Field) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${field}-error` : undefined,
    onBlur: () => recheck(field, fieldValue[field], fieldValue[field].trim().length > 0),
  });

  const fieldError = (field: Field) =>
    errors[field] ? (
      <span className="field-error" id={`${field}-error`}>
        {errors[field]}
      </span>
    ) : null;

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
                <button type="button" onClick={() => changeQty(l.product.slug, l.product.nameAr, l.qty - 1)} aria-label="قلل">
                  −
                </button>
                <output>{l.qty}</output>
                <button type="button" onClick={() => changeQty(l.product.slug, l.product.nameAr, l.qty + 1)} aria-label="زيد">
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
        {step === "details" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitDetails();
            }}
            noValidate
          >
            <h2>معلومات التوصيل</h2>
            <label className={errors.name ? "has-error" : undefined}>
              الاسم الكامل
              <input
                ref={inputs.name}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  recheck("name", e.target.value, false);
                }}
                autoComplete="name"
                maxLength={80}
                placeholder="الاسم الأول واسم الأب أو العائلة"
                required
                {...fieldProps("name")}
              />
              {fieldError("name")}
            </label>

            {teamDevice ? (
              <div className="account-phone account-phone--team" role="note">
                <span>
                  هذا الجهاز مسجل بحساب الفريق (<span dir="ltr">{phoneDisplay}</span>). الطلب لازم يكون برقم الزبون.
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    void auth.signOut();
                    toast({ id: "checkout", message: "سجّلتوا خروج حساب الفريق. اكتبوا رقم الزبون." });
                  }}
                >
                  تسجيل الخروج والطلب برقم ثاني
                </button>
              </div>
            ) : signedIn ? (
              <div className="account-phone">
                <span>رقم الواتساب</span>
                <strong dir="ltr">{phoneDisplay}</strong>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    void auth.signOut();
                    toast({ id: "checkout", message: "سجّلتوا الخروج. اكتبوا الرقم الجديد." });
                  }}
                >
                  مو رقمكم؟ غيّروه
                </button>
              </div>
            ) : (
              <label className={errors.phone ? "has-error" : undefined}>
                رقم الواتساب
                <input
                  ref={inputs.phone}
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value);
                    recheck("phone", e.target.value, false);
                  }}
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  placeholder="07XX XXX XXXX"
                  required
                  {...fieldProps("phone")}
                />
                {fieldError("phone") ??
                  (phone && (
                    <span className="field-hint">
                      راح نرسل رمز التحقق على <span dir="ltr">{phoneDisplay}</span>
                    </span>
                  ))}
              </label>
            )}

            <label className={errors.address ? "has-error" : undefined}>
              العنوان وأقرب نقطة دالة
              <textarea
                ref={inputs.address}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  recheck("address", e.target.value, false);
                }}
                rows={3}
                maxLength={400}
                required
                {...fieldProps("address")}
              />
              {fieldError("address")}
            </label>
            <label>
              <span>
                ملاحظة <span className="optional">(اختياري)</span>
              </span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
            </label>
            <button type="submit" className="btn btn--full" disabled={busy || auth.status === "loading" || teamDevice}>
              {busy ? "جاري الإرسال…" : signedIn ? "أكدوا الطلب" : "أرسلوا رمز التحقق على الواتساب"}
            </button>
            {!signedIn && (
              <p className="hint">نتأكد من الرقم مرة وحدة بس. بعدها تبقون مسجلين على هذا الجهاز وتشوفون طلباتكم.</p>
            )}
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmCode(code);
            }}
            noValidate
          >
            <h2>رمز التحقق</h2>
            <div className="sent-to">
              <p>أرسلنا رمز من {CODE_LENGTH} أرقام على الواتساب للرقم</p>
              <p className="sent-to__number" dir="ltr">
                {phoneDisplay}
              </p>
              <button type="button" className="link-button" onClick={changeNumber}>
                الرقم غلط؟ غيّروه
              </button>
            </div>
            <p className="hint">{site.codeSenderNote}</p>
            <CodeInput
              ref={codeBoxes}
              length={CODE_LENGTH}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (codeError) setCodeError("");
              }}
              onComplete={(v) => void confirmCode(v)}
              disabled={busy}
              invalid={Boolean(codeError)}
              describedBy={codeError ? "code-error" : undefined}
            />
            {codeError && (
              <p className="field-error field-error--center" id="code-error">
                {codeError}
              </p>
            )}
            <button type="submit" className="btn btn--full" disabled={busy || code.length !== CODE_LENGTH}>
              {busy ? "جاري التأكيد…" : "أكدوا الطلب"}
            </button>
            <div className="code-actions">
              <button type="button" className="link-button" disabled={resendIn > 0 || busy} onClick={() => void sendCode(true)}>
                {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : "إعادة إرسال الرمز"}
              </button>
            </div>
            <p className="hint">ما وصلكم الرمز؟ تأكدوا إن الرقم صحيح وعليه واتساب.</p>
          </form>
        )}

        {step === "failed" && (
          <div className="order-failed" role="alert">
            <h2>نكمل طلبكم على الواتساب</h2>
            <p>صار خلل بإرسال الطلب. طلبكم محفوظ بهذا الجهاز ومكتوب جاهز، دوسوا الزر وأرسلوه علينا مباشرة.</p>
            <a className="btn btn--full" href={fallbackHref} target="_blank" rel="noopener noreferrer">
              أرسلوا الطلب على الواتساب
            </a>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => void placeNow()}>
              {busy ? "جاري الإرسال…" : "حاولوا مرة ثانية"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { jarsLabel } from "./AddToCart";
import { CodeInput, type CodeInputHandle } from "./CodeInput";
import { buildWhatsAppText, priceCart, type CartItem } from "@/lib/order-text";
import { formatIraqiMobile, normalizeIraqiMobile, toLatinDigits } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { CODE_LENGTH, ltr, addressError, checkFields, cleanName, nameError, phoneError, type Field, type FieldErrors } from "@/lib/validate";
import type { ReceiptData } from "@/lib/receipt";

type Step = "details" | "code" | "sent" | "failed";

type Placed = {
  orderId: string;
  time: string;
  items: CartItem[];
  name: string;
  phoneDisplay: string;
  address: string;
  note: string;
};

const RESEND_SECONDS = 60;
const FIELD_ORDER: Field[] = ["name", "phone", "address"];

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function baghdadNow(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(new Date());
}

function toReceipt(p: Placed): ReceiptData {
  const { lines, total } = priceCart(p.items);
  return {
    orderId: p.orderId,
    time: p.time,
    lines: lines.map((l) => ({
      nameAr: l.product.nameAr,
      nameEn: l.product.nameEn,
      qty: l.qty,
      price: l.product.price,
      subtotal: l.subtotal,
    })),
    total,
    name: p.name,
    phoneDisplay: p.phoneDisplay,
    address: p.address,
    note: p.note || undefined,
  };
}

export function OrderFlow() {
  const cart = useCart();
  const toast = useToast();
  const { lines, total } = priceCart(cart.items);

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [placed, setPlaced] = useState<Placed | null>(null);
  const [pdfSaved, setPdfSaved] = useState(false);
  const pdfBlob = useRef<Blob | null>(null);
  const autoSaveStarted = useRef(false);

  const inputs = {
    name: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    address: useRef<HTMLTextAreaElement>(null),
  };
  const codeBoxes = useRef<CodeInputHandle>(null);
  const focusPhoneNext = useRef(false);

  const phone = normalizeIraqiMobile(phoneInput);
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

  // ---- PDF ---------------------------------------------------------------

  const getPdf = useCallback(async (p: Placed) => {
    if (pdfBlob.current) return pdfBlob.current;
    const { buildReceiptPdf } = await import("@/lib/receipt");
    pdfBlob.current = await buildReceiptPdf(toReceipt(p));
    return pdfBlob.current;
  }, []);

  const savePdf = useCallback(
    async (p: Placed, automatic: boolean) => {
      try {
        const blob = await getPdf(p);
        const { downloadBlob, receiptFilename } = await import("@/lib/receipt");
        downloadBlob(blob, receiptFilename(p.orderId));
        setPdfSaved(true);
        // The automatic save replaces the "order received" alert so the screen stays clear.
        toast({ id: automatic ? "checkout" : "pdf", message: automatic ? "حفظنا ملخص طلبكم على جهازكم (PDF)" : "نزّلنا ملخص الطلب (PDF)" });
      } catch {
        if (!automatic) toast({ id: "pdf", tone: "attention", message: "ما گدرنا نجهز الملف هسه. حاولوا مرة ثانية." });
      }
    },
    [getPdf, toast],
  );

  useEffect(() => {
    if (step === "sent" && placed && !autoSaveStarted.current) {
      autoSaveStarted.current = true;
      void savePdf(placed, true);
    }
  }, [step, placed, savePdf]);

  // ---- Fields ------------------------------------------------------------

  const fieldCheck: Record<Field, (v: string) => string | null> = { name: nameError, phone: phoneError, address: addressError };
  const fieldValue: Record<Field, string> = { name, phone: phoneInput, address };

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

  async function sendCode(isResend: boolean) {
    if (!isResend) {
      const found = checkFields({ name, phone: phoneInput, address });
      if (Object.keys(found).length) return showFieldErrors(found);
    }
    if (!phone) return;

    setBusy(true);
    try {
      const { status, data } = await postJson("/api/send-code", { phone });
      if (status === 200 && typeof data.token === "string") {
        setToken(data.token);
        setDevCode(typeof data.devCode === "string" ? data.devCode : "");
        setCode("");
        setCodeError("");
        setStep("code");
        setResendIn(RESEND_SECONDS);
        toast({ id: "checkout", message: isResend ? "أرسلنا رمز جديد على الواتساب" : `أرسلنا الرمز على الواتساب للرقم ${ltr(phoneDisplay)}` });
        codeBoxes.current?.clear();
      } else if (status === 429) {
        toast({ id: "checkout", tone: "attention", message: `طلبتوا رموز كثيرة لهذا الرقم. حاولوا بعد ${Number(data.waitMinutes) || 10} دقائق.` });
      } else if (data.error === "invalid_phone") {
        setStep("details");
        showFieldErrors({ phone: phoneError("x") ?? "" });
      } else {
        toast({ id: "checkout", tone: "attention", message: "ما گدرنا نرسل الرمز هسه. تأكدوا من الرقم وحاولوا بعد شوية." });
      }
    } catch {
      toast({ id: "checkout", tone: "attention", message: "ماكو اتصال بالإنترنت. تأكدوا من الاتصال وحاولوا مرة ثانية." });
    } finally {
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep("details");
    setToken("");
    setCode("");
    setCodeError("");
    setResendIn(0);
    focusPhoneNext.current = true;
    toast({ id: "checkout", message: "عدّلوا رقم الواتساب وأرسلوا رمز جديد" });
  }

  async function placeOrder(codeValue: string) {
    const digits = toLatinDigits(codeValue).replace(/\D/g, "");
    if (digits.length !== CODE_LENGTH) {
      setCodeError(`الرمز يتكون من ${CODE_LENGTH} أرقام.`);
      return;
    }
    if (busy) return;

    const snapshot: Omit<Placed, "orderId" | "time"> = {
      items: cart.items,
      name: cleanName(name),
      phoneDisplay,
      address: address.trim(),
      note: note.trim(),
    };

    setBusy(true);
    setCodeError("");
    try {
      const { status, data } = await postJson("/api/place-order", {
        token,
        code: digits,
        name: snapshot.name,
        phone,
        address: snapshot.address,
        note: snapshot.note,
        items: cart.items,
        source: cart.source,
      });
      const orderId = typeof data.orderId === "string" ? data.orderId : "";
      const time = typeof data.time === "string" ? data.time : baghdadNow();

      if (status === 200 && orderId) {
        setPlaced({ ...snapshot, orderId, time });
        setStep("sent");
        cart.clear();
        toast({ id: "checkout", message: `وصلنا طلبكم رقم ${ltr(orderId)}` });
        window.scrollTo({ top: 0 });
      } else if (data.error === "code_invalid") {
        setCodeError("الرمز غير صحيح. تأكدوا منه وجربوا مرة ثانية.");
        toast({ id: "checkout", tone: "attention", message: "الرمز غير صحيح" });
        codeBoxes.current?.clear();
      } else if (data.error === "code_expired") {
        setCodeError("انتهت صلاحية الرمز. اطلبوا رمز جديد.");
        setResendIn(0);
        toast({ id: "checkout", tone: "attention", message: "انتهت صلاحية الرمز" });
      } else if (data.error === "code_locked" || status === 429) {
        setCodeError("جربتوا الرمز أكثر من مرة. اطلبوا رمز جديد.");
        setResendIn(0);
        codeBoxes.current?.clear();
        toast({ id: "checkout", tone: "attention", message: "اطلبوا رمز جديد حتى تكملون" });
      } else if (data.error === "invalid_order") {
        setStep("details");
        const fields = (data.fields ?? {}) as FieldErrors;
        if (Object.keys(fields).length) showFieldErrors(fields);
        else toast({ id: "checkout", tone: "attention", message: "السلة فارغة أو فيها خطأ. ارجعوا للنكهات وضيفوها من جديد." });
      } else {
        setPlaced({ ...snapshot, orderId, time });
        setStep("failed");
        toast({ id: "checkout", tone: "attention", message: "نكمل طلبكم على الواتساب" });
      }
    } catch {
      // No response at all (network dropped). The order may not have arrived.
      setPlaced({ ...snapshot, orderId: "", time: baghdadNow() });
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
    const followUp = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
      buildWhatsAppText(placed, placed.items, placed.orderId),
    )}`;
    return (
      <div className="order-result">
        <h2>وصلنا طلبكم</h2>
        <p className="order-result__id">
          رقم الطلب <strong dir="ltr">{placed.orderId}</strong>
        </p>
        <p>
          فريقنا راح يتواصل وياكم على الواتساب على الرقم <span dir="ltr">{placed.phoneDisplay}</span> لتأكيد التوصيل.
        </p>
        <p className="order-result__muted">
          {pdfSaved
            ? "حفظنا ملخص الطلب (PDF) على جهازكم، حتى يبقى عندكم رقم الطلب وتفاصيله."
            : "تكدرون تنزّلون ملخص الطلب (PDF) حتى يبقى عندكم رقم الطلب وتفاصيله."}
        </p>
        <div className="order-result__actions">
          <a className="btn btn--full" href={followUp} target="_blank" rel="noopener noreferrer">
            تابعوا طلبكم على الواتساب
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
    ? `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppText(placed, placed.items))}`
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
              void sendCode(false);
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
            <button type="submit" className="btn btn--full" disabled={busy}>
              {busy ? "جاري الإرسال…" : "أرسلوا رمز التحقق على الواتساب"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void placeOrder(code);
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
            {devCode && (
              <p className="dev-note">
                وضع التطوير (OTPIQ غير مربوط): الرمز هو <strong dir="ltr">{devCode}</strong>
              </p>
            )}
            <CodeInput
              ref={codeBoxes}
              length={CODE_LENGTH}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (codeError) setCodeError("");
              }}
              onComplete={(v) => void placeOrder(v)}
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
            <p>صار تأخير بإرسال الطلب لفريقنا. طلبكم محفوظ بهذا الجهاز ومكتوب جاهز، دوسوا الزر وأرسلوه علينا مباشرة.</p>
            <a className="btn btn--full" href={fallbackHref} target="_blank" rel="noopener noreferrer">
              أرسلوا الطلب على الواتساب
            </a>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => void placeOrder(code)}>
              {busy ? "جاري الإرسال…" : "حاولوا مرة ثانية"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "./CartProvider";
import { buildWhatsAppText, priceCart } from "@/lib/order-text";
import { formatIraqiMobile, normalizeIraqiMobile, toLatinDigits } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";

type Step = "details" | "code" | "sent" | "failed";

const RESEND_SECONDS = 60;

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export function OrderFlow() {
  const cart = useCart();
  const { lines, total } = priceCart(cart.items);

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");

  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const phone = normalizeIraqiMobile(phoneInput);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const whatsappHref = phone
    ? `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
        buildWhatsAppText({ name, phoneDisplay: formatIraqiMobile(phone), address, note }, cart.items),
      )}`
    : `https://wa.me/${site.whatsappNumber}`;

  async function sendCode() {
    setError("");
    if (!name.trim()) return setError("اكتبوا الاسم.");
    if (!phone) return setError("رقم الواتساب لازم يكون رقم موبايل عراقي، مثل 0771 234 5678.");
    if (address.trim().length < 5) return setError("اكتبوا العنوان وأقرب نقطة دالة.");

    setBusy(true);
    try {
      const { status, data } = await postJson("/api/send-code", { phone });
      if (status === 200 && typeof data.token === "string") {
        setToken(data.token);
        setDevCode(typeof data.devCode === "string" ? data.devCode : "");
        setCode("");
        setStep("code");
        setResendIn(RESEND_SECONDS);
      } else if (status === 429) {
        setError(`طلبتوا رموز كثيرة لهذا الرقم. حاولوا بعد ${Number(data.waitMinutes) || 10} دقائق.`);
      } else if (data.error === "invalid_phone") {
        setError("رقم الواتساب لازم يكون رقم موبايل عراقي، مثل 0771 234 5678.");
      } else {
        setError("ما گدرنا نرسل الرمز هسه. حاولوا بعد شوية، أو أرسلوا الطلب علينا بالواتساب.");
      }
    } catch {
      setError("ماكو اتصال بالإنترنت. تأكدوا من الاتصال وحاولوا مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder() {
    setError("");
    const digits = toLatinDigits(code).replace(/\D/g, "");
    if (digits.length !== 6) return setError("الرمز يتكون من 6 أرقام.");

    setBusy(true);
    try {
      const { status, data } = await postJson("/api/place-order", {
        token,
        code: digits,
        name,
        phone,
        address,
        note,
        items: cart.items,
        source: cart.source,
      });
      if (status === 200 && typeof data.orderId === "string") {
        setOrderId(data.orderId);
        setStep("sent");
        cart.clear();
      } else if (data.error === "code_invalid") {
        setStep("code");
        setError("الرمز غير صحيح. تأكدوا منه وحاولوا مرة ثانية.");
      } else if (data.error === "code_expired") {
        setStep("code");
        setError("انتهت صلاحية الرمز. اطلبوا رمز جديد.");
      } else if (data.error === "invalid_order") {
        setStep("details");
        setError("في معلومة ناقصة بالطلب. تأكدوا من الاسم والعنوان والسلة.");
      } else {
        setStep("failed");
      }
    } catch {
      // No response at all (network dropped). The order may not have arrived.
      setStep("failed");
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent") {
    return (
      <div className="order-result">
        <h2>وصلنا طلبكم</h2>
        <p>
          رقم الطلب <strong dir="ltr">{orderId}</strong>. راح نتواصل وياكم على الواتساب على الرقم{" "}
          <span dir="ltr">{phone ? formatIraqiMobile(phone) : ""}</span> لتأكيد التوصيل.
        </p>
        <Link href="/" className="btn btn--quiet">
          الرجوع للصفحة الرئيسية
        </Link>
      </div>
    );
  }

  if (cart.ready && lines.length === 0) {
    return (
      <div className="order-empty">
        <p>السلة فارغة. اختاروا نكهة حتى تبدون.</p>
        <Link href="/#flavors" className="btn">
          شوفوا النكهات
        </Link>
      </div>
    );
  }

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
                <button type="button" onClick={() => cart.setQty(l.product.slug, l.qty - 1)} aria-label="قلل">
                  −
                </button>
                <output>{l.qty}</output>
                <button type="button" onClick={() => cart.setQty(l.product.slug, l.qty + 1)} aria-label="زيد">
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
              void sendCode();
            }}
            noValidate
          >
            <h2>معلومات التوصيل</h2>
            <label>
              الاسم
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
            </label>
            <label>
              رقم الواتساب
              <input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="07XX XXX XXXX"
                required
              />
            </label>
            <label>
              العنوان وأقرب نقطة دالة
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} maxLength={400} required />
            </label>
            <label>
              <span>
                ملاحظة <span className="optional">(اختياري)</span>
              </span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn--full" disabled={busy}>
              {busy ? "جاري الإرسال…" : "أرسل رمز التحقق على الواتساب"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void placeOrder();
            }}
            noValidate
          >
            <h2>رمز التحقق</h2>
            <p>
              أرسلنا رمز من 6 أرقام على الواتساب للرقم <span dir="ltr">{phone ? formatIraqiMobile(phone) : ""}</span>.{" "}
              {site.codeSenderNote}
            </p>
            {devCode && (
              <p className="dev-note">
                وضع التطوير (OTPIQ غير مربوط): الرمز هو <strong dir="ltr">{devCode}</strong>
              </p>
            )}
            <label>
              الرمز
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                className="code-input"
                autoFocus
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn--full" disabled={busy}>
              {busy ? "جاري الإرسال…" : "أكد الطلب"}
            </button>
            <div className="code-actions">
              <button type="button" className="link-button" onClick={() => setStep("details")}>
                تعديل المعلومات
              </button>
              <button type="button" className="link-button" disabled={resendIn > 0 || busy} onClick={() => void sendCode()}>
                {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : "إعادة إرسال الرمز"}
              </button>
            </div>
            <p className="hint">ما وصلكم الرمز؟ تأكدوا إن الرقم عليه واتساب.</p>
          </form>
        )}

        {step === "failed" && (
          <div className="order-failed" role="alert">
            <h2>ما وصل الطلب لفريقنا</h2>
            <p>طلبكم محفوظ بهذا الجهاز. أرسلوه علينا بالواتساب وهو مكتوب جاهز، أو حاولوا مرة ثانية.</p>
            <a className="btn btn--full" href={whatsappHref} target="_blank" rel="noopener noreferrer">
              أرسل الطلب بالواتساب
            </a>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => void placeOrder()}>
              {busy ? "جاري الإرسال…" : "حاول مرة ثانية"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

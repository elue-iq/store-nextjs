"use client";

import { useEffect, useRef, useState } from "react";
import { CodeInput, type CodeInputHandle } from "./CodeInput";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { confirmLoginCode, sendLoginCode } from "@/lib/auth-flow";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { CODE_LENGTH, ltr, phoneError } from "@/lib/validate";
import { site } from "@/lib/site";

const RESEND_SECONDS = 60;

// WhatsApp number -> 4-digit code -> logged in.
// Used on /account, /admin and at checkout.
export function LoginPanel({
  title,
  intro,
  compact = false,
}: {
  title: string;
  intro: string;
  // Inside checkout: smaller heading, framed like the other checkout panels.
  compact?: boolean;
}) {
  const toast = useToast();
  const auth = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const boxes = useRef<CodeInputHandle>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const phone = normalizeIraqiMobile(phoneInput);
  const phoneDisplay = phone ? formatIraqiMobile(phone) : "";

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function send(isResend = false) {
    const err = phoneError(phoneInput);
    setPhoneErr(err ?? "");
    if (err || !phone) {
      phoneInputRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await sendLoginCode(phone);
    setBusy(false);
    if (result === "sent") {
      setStep("code");
      setCode("");
      setCodeErr("");
      boxes.current?.clear();
      setResendIn(RESEND_SECONDS);
      toast({
        id: "login",
        message: isResend ? "أرسلنا رمزًا جديدًا عبر واتساب." : `أرسلنا الرمز عبر واتساب إلى الرقم ${ltr(phoneDisplay)}.`,
      });
    } else if (result === "rate_limited") {
      toast({ id: "login", tone: "attention", message: "طلبتم رموزًا كثيرة لهذا الرقم. حاولوا مجددًا بعد 10 دقائق." });
    } else if (result === "invalid_phone") {
      setStep("phone");
      setPhoneErr(phoneError("x") ?? "");
    } else {
      toast({ id: "login", tone: "attention", message: "تعذّر إرسال الرمز الآن. تأكدوا من الرقم وحاولوا بعد قليل." });
    }
  }

  async function confirm(value: string) {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    const result = await confirmLoginCode(value);
    if (result === "ok") {
      await auth.refresh();
      setBusy(false);
      toast({ id: "login", message: "تم تسجيل الدخول." });
      return;
    }
    setBusy(false);
    boxes.current?.clear();
    if (result === "wrong") {
      setCodeErr("الرمز غير صحيح. تأكدوا منه وحاولوا مجددًا.");
    } else {
      setCodeErr("انتهت صلاحية الرمز أو تجاوزتم عدد المحاولات. اطلبوا رمزًا جديدًا.");
      setResendIn(0);
    }
  }

  function changeNumber() {
    setStep("phone");
    setCode("");
    setCodeErr("");
    setResendIn(0);
    setTimeout(() => {
      phoneInputRef.current?.focus();
      phoneInputRef.current?.select();
    }, 0);
  }

  const Heading = compact ? "h2" : "h1";

  return (
    <div className={compact ? "login-panel login-panel--compact" : "login-panel"}>
      <Heading>{title}</Heading>
      <p className="login-panel__intro">{intro}</p>
      {step === "phone" ? (
        <form
          className="panel-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className={phoneErr ? "has-error" : undefined}>
            رقم الواتساب
            <input
              ref={phoneInputRef}
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                if (phoneErr) setPhoneErr(phoneError(e.target.value) ?? "");
              }}
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="07XX XXX XXXX"
              aria-invalid={phoneErr ? true : undefined}
              aria-describedby={phoneErr ? "login-phone-error" : undefined}
            />
            {phoneErr ? (
              <span className="field-error" id="login-phone-error">
                {phoneErr}
              </span>
            ) : (
              phone && (
                <span className="field-hint">
                  سنرسل رمز التحقق إلى <span dir="ltr">{phoneDisplay}</span>
                </span>
              )
            )}
          </label>
          <button type="submit" className="btn btn--full" disabled={busy}>
            {busy ? "جارٍ الإرسال…" : "أرسلوا رمز التحقق عبر واتساب"}
          </button>
          <p className="hint">{site.codeSenderNote}</p>
        </form>
      ) : (
        <form
          className="panel-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void confirm(code);
          }}
        >
          <div className="sent-to">
            <p>أرسلنا رمزًا من {CODE_LENGTH} أرقام عبر واتساب إلى الرقم</p>
            <p className="sent-to__number" dir="ltr">
              {phoneDisplay}
            </p>
            <button type="button" className="link-button" onClick={changeNumber}>
              الرقم غير صحيح؟ عدّلوه
            </button>
          </div>
          <CodeInput
            ref={boxes}
            length={CODE_LENGTH}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (codeErr) setCodeErr("");
            }}
            onComplete={(v) => void confirm(v)}
            disabled={busy}
            invalid={Boolean(codeErr)}
            describedBy={codeErr ? "login-code-error" : undefined}
          />
          {codeErr && (
            <p className="field-error field-error--center" id="login-code-error">
              {codeErr}
            </p>
          )}
          <button type="submit" className="btn btn--full" disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? "جارٍ التحقق…" : "تسجيل الدخول"}
          </button>
          <div className="code-actions">
            <button type="button" className="link-button" disabled={resendIn > 0 || busy} onClick={() => void send(true)}>
              {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : "إعادة إرسال الرمز"}
            </button>
          </div>
          <p className="hint">لم يصلكم الرمز؟ تأكدوا من صحة الرقم ومن أن واتساب مفعّل عليه.</p>
        </form>
      )}
    </div>
  );
}

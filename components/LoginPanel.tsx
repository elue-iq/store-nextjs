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

// Phone number -> WhatsApp code -> logged in. Used on /account and /admin.
export function LoginPanel({ title, intro }: { title: string; intro: string }) {
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

  const phone = normalizeIraqiMobile(phoneInput);
  const phoneDisplay = phone ? formatIraqiMobile(phone) : "";

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function send() {
    const err = phoneError(phoneInput);
    setPhoneErr(err ?? "");
    if (err || !phone) return;
    setBusy(true);
    const result = await sendLoginCode(phone);
    setBusy(false);
    if (result === "sent") {
      setStep("code");
      setCode("");
      setCodeErr("");
      setResendIn(RESEND_SECONDS);
      toast({ id: "login", message: `أرسلنا الرمز على الواتساب للرقم ${ltr(phoneDisplay)}` });
    } else if (result === "rate_limited") {
      toast({ id: "login", tone: "attention", message: "طلبتوا رموز كثيرة لهذا الرقم. حاولوا بعد 10 دقائق." });
    } else if (result === "invalid_phone") {
      setPhoneErr(phoneError("x") ?? "");
    } else {
      toast({ id: "login", tone: "attention", message: "ما گدرنا نرسل الرمز هسه. حاولوا بعد شوية." });
    }
  }

  async function confirm(value: string) {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    const result = await confirmLoginCode(value);
    setBusy(false);
    if (result === "ok") {
      toast({ id: "login", message: "سجّلتوا الدخول" });
      await auth.refresh();
    } else if (result === "wrong") {
      setCodeErr("الرمز غير صحيح. تأكدوا منه وجربوا مرة ثانية.");
      boxes.current?.clear();
    } else {
      setCodeErr("انتهت صلاحية الرمز أو جربتوه أكثر من مرة. اطلبوا رمز جديد.");
      setResendIn(0);
      boxes.current?.clear();
    }
  }

  return (
    <div className="login-panel">
      <h1>{title}</h1>
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
            {phoneErr && (
              <span className="field-error" id="login-phone-error">
                {phoneErr}
              </span>
            )}
          </label>
          <button type="submit" className="btn btn--full" disabled={busy}>
            {busy ? "جاري الإرسال…" : "أرسلوا الرمز على الواتساب"}
          </button>
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
            <p>أرسلنا رمز من {CODE_LENGTH} أرقام على الواتساب للرقم</p>
            <p className="sent-to__number" dir="ltr">
              {phoneDisplay}
            </p>
            <button type="button" className="link-button" onClick={() => setStep("phone")}>
              الرقم غلط؟ غيّروه
            </button>
          </div>
          <p className="hint">{site.codeSenderNote}</p>
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
          />
          {codeErr && <p className="field-error field-error--center">{codeErr}</p>}
          <button type="submit" className="btn btn--full" disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? "جاري التأكيد…" : "دخول"}
          </button>
          <div className="code-actions">
            <button type="button" className="link-button" disabled={resendIn > 0 || busy} onClick={() => void send()}>
              {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : "إعادة إرسال الرمز"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { formatIQD, site } from "@/lib/site";

// Paying by transfer to ÉLUE's Qi Card account (site.qiTransfer), while the Qi gateway is off.
// The customer transfers, then sends the receipt on WhatsApp; the team marks the order paid.

export function qiTransferWhatsApp(orderNumber: string, amount: number): string {
  const text = `هلا، حوّلت ${formatIQD(amount)} لطلبي رقم ${orderNumber}. هاي صورة التحويل:`;
  return `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(text)}`;
}

export function QiTransferBox({ amount, orderNumber }: { amount: number; orderNumber?: string }) {
  const [copied, setCopied] = useState(false);
  const { account, holder } = site.qiTransfer;

  async function copy() {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="qi-transfer" role={orderNumber ? "alert" : undefined}>
      {orderNumber && <strong className="qi-transfer__title">باقي خطوة وحدة</strong>}
      <p>
        حوّلوا <strong>{formatIQD(amount)}</strong> على حساب كي:
      </p>
      <dl className="qi-transfer__account">
        <div>
          <dt>رقم الحساب</dt>
          <dd>
            <span dir="ltr">{account}</span>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => void copy()}>
              {copied ? "تم النسخ" : "نسخ"}
            </button>
          </dd>
        </div>
        <div>
          <dt>الاسم</dt>
          <dd dir="ltr">{holder}</dd>
        </div>
      </dl>
      {orderNumber ? (
        <>
          <p>بعدها دزّوا صورة التحويل على واتساب حتى نثبّت طلبكم مدفوع.</p>
          <a className="btn btn--full" href={qiTransferWhatsApp(orderNumber, amount)} target="_blank" rel="noopener noreferrer">
            دزّوا صورة التحويل على واتساب
          </a>
        </>
      ) : (
        <p className="qi-transfer__note">بعد تأكيد الطلب دزّوا صورة التحويل على واتساب حتى نثبّته مدفوع.</p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import type { Order } from "@/lib/data";
import type { receiptFromOrder } from "@/lib/receipt";
import { chatUrl, orderMessage, reviewReminderMessage, reviewRequestMessage } from "@/lib/share";
import { dataClient } from "@/lib/data";
import { Stars, type ReviewRow } from "./ReviewStats";

type Mode = "share" | "chat";

// One button that sends an order on WhatsApp: a text message and the order
// summary picture. Used for the customer and for the local delivery team.
//
// WhatsApp lets a website open a chat with text, but not attach a picture to a
// chosen chat. So, per phone:
// - Android: the share sheet sends the picture with the text as its caption
//   (choose WhatsApp, then the chat).
// - iPhone and computers: the chat opens with the text ready, and the picture is
//   copied, ready to paste in the same chat. (iPhone's share sheet drops the
//   picture when text is shared with it, so it can't do both at once.)
export function SendOnWhatsApp({
  order: o,
  phone,
  text,
  label,
  primary = true,
  chatHint,
  shareHint,
  business = false,
  compact = false,
}: {
  order: Parameters<typeof receiptFromOrder>[0];
  phone: string; // "" = WhatsApp asks which chat or group
  text: string;
  label: string;
  primary?: boolean;
  chatHint: string;
  shareHint: string;
  // The team's WhatsApp Business: skip the share sheet (it asks which WhatsApp) and open the chat directly.
  business?: boolean;
  // A small button without the explanation line (the order screen's quick actions).
  compact?: boolean;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("chat");
  const image = useRef<Promise<Blob> | null>(null);
  const chat = chatUrl(phone, text);
  const file = `ELUE-${o.orderNumber}.png`;

  // The picture is made when the order opens (and again when it changes), so it is
  // ready the moment the button is tapped.
  useEffect(() => {
    const p = import("@/lib/receipt").then((m) => m.orderImage(o));
    p.catch((err) => console.error("summary picture failed", err));
    image.current = p;
  }, [o]);

  useEffect(() => {
    void import("@/lib/receipt").then(({ isIOS }) => {
      const probe = new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" });
      setMode(!business && !isIOS() && navigator.canShare?.({ files: [probe] }) ? "share" : "chat");
    });
  }, []);

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    const pic = image.current;
    if (mode === "share" && pic) {
      e.preventDefault();
      void (async () => {
        try {
          const blob = await pic;
          await navigator.share({ files: [new File([blob], file, { type: "image/png" })], text });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("share failed", err);
          window.open(chat, "_blank", "noopener");
          toast({ id: "send", tone: "attention", message: "فتحنا المحادثة بالنص. أرسل الصورة من «حفظ الصورة»." });
        }
      })();
      return;
    }
    // The link opens the chat with the text. Copy the picture in the same tap.
    if (pic && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      navigator.clipboard
        .write([new ClipboardItem({ "image/png": pic })])
        .then(() => toast({ id: "send", message: "الصورة منسوخة: الصقها في المحادثة (اضغط مطولاً في خانة الكتابة ← لصق)." }))
        .catch((err) => {
          console.error("copy picture failed", err);
          toast({ id: "send", tone: "attention", message: "أُرسل النص فقط. لإرسال الصورة استخدم «حفظ الصورة»." });
        });
    }
  }

  return (
    <div className={compact ? "send-order send-order--compact" : "send-order"}>
      <a
        className={compact ? "btn btn--quiet btn--small" : primary ? "btn btn--full" : "btn btn--quiet btn--full"}
        href={chat}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        title={mode === "share" ? shareHint : chatHint}
      >
        {label}
      </a>
      {!compact && <small>{mode === "share" ? shareHint : chatHint}</small>}
    </div>
  );
}

// To the customer: order summary, delivery, tracking link.
export function SendOrderToCustomer({ order: o, compact = false }: { order: Order; compact?: boolean }) {
  return (
    <SendOnWhatsApp
      order={o}
      phone={o.phone}
      text={orderMessage(o)}
      business
      compact={compact}
      label={compact ? "إرسال الطلب" : "إرسال الطلب للعميل على واتساب"}
      shareHint="اختر واتساب ثم محادثة العميل: تُرسل صورة الملخص ومعها النص."
      chatHint="تُفتح محادثة العميل والنص جاهز، وتُنسخ صورة الملخص: الصقها في المحادثة."
    />
  );
}

// «التقييم» on the order screen: whether the customer was asked, how many times, and the
// review itself once it arrives. Asking opens WhatsApp with the review link and records it.
export function ReviewPanel({ order: o, me }: { order: Order; me: string }) {
  const [review, setReview] = useState<ReviewRow | null>(null);
  useEffect(() => {
    if (!o.reviewed) return;
    let alive = true;
    dataClient.models.Review.get({ orderNumber: o.orderNumber })
      .then(({ data }) => alive && setReview((data as unknown as ReviewRow) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [o.reviewed, o.orderNumber]);

  if (o.status === "CANCELLED") return null;
  if (o.reviewed) {
    return (
      <section className="order-detail__block review-panel is-done">
        <h2>تقييم العميل</h2>
        {review ? (
          <>
            <div className="review-panel__stars">
              <Stars n={review.taste} label="الطعم" />
              <Stars n={review.delivery} label="التوصيل" />
            </div>
            {review.comment ? <blockquote>{review.comment}</blockquote> : <p className="hint">بدون تعليق.</p>}
          </>
        ) : (
          <p className="delivery__ok">✓ العميل قيّم هذا الطلب</p>
        )}
      </section>
    );
  }
  if (o.status !== "DELIVERED") return null;
  return (
    <section className="order-detail__block review-panel">
      <h2>التقييم</h2>
      <ReviewRequestButton order={o} me={me} />
    </section>
  );
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? "أمس" : `قبل ${d} أيام`;
};

// The ask (first time) or a gentle reminder; recorded on the order so the team sees it.
export function ReviewRequestButton({ order: o, me, compact = false }: { order: Order; me: string; compact?: boolean }) {
  const toast = useToast();
  const asked = Boolean(o.reviewRequestedAt);
  const text = asked ? reviewReminderMessage(o, window.location.origin) : reviewRequestMessage(o, window.location.origin);
  function record() {
    void dataClient.models.Order.update({
      id: o.id,
      reviewRequestedAt: new Date().toISOString(),
      reviewRequests: (o.reviewRequests ?? 0) + 1,
      editedBy: me,
      editedAt: new Date().toISOString(),
    }).then(({ errors }) => {
      if (errors?.length) {
        console.error("recording the review request failed", errors);
        toast({ id: "review", tone: "attention", message: "فُتح واتساب، لكن ما انحفظ أنه انطلب التقييم." });
      }
    });
  }
  return (
    <div className={compact ? "review-ask review-ask--compact" : "review-ask"}>
      {!compact && (
        <p className={asked ? "review-ask__state is-asked" : "review-ask__state"}>
          {asked
            ? `طُلب التقييم ${ago(o.reviewRequestedAt!)}${(o.reviewRequests ?? 1) > 1 ? ` (${o.reviewRequests} مرات)` : ""} · لم يقيّم بعد`
            : "لم يُطلب التقييم بعد"}
        </p>
      )}
      <a
        className={asked ? "btn btn--quiet btn--full" : "btn btn--full"}
        href={chatUrl(o.phone, text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={record}
      >
        {asked ? "تذكير العميل بالتقييم" : "اطلب التقييم على واتساب"}
      </a>
    </div>
  );
}

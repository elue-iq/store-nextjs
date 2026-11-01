"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import type { Order } from "@/lib/data";
import { chatUrl, orderMessage, reviewRequestMessage } from "@/lib/share";

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
function SendOnWhatsApp({
  order: o,
  phone,
  text,
  label,
  primary = true,
  chatHint,
  shareHint,
}: {
  order: Order;
  phone: string; // "" = WhatsApp asks which chat or group
  text: string;
  label: string;
  primary?: boolean;
  chatHint: string;
  shareHint: string;
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
      setMode(!isIOS() && navigator.canShare?.({ files: [probe] }) ? "share" : "chat");
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
    <div className="send-order">
      <a
        className={primary ? "btn btn--full" : "btn btn--quiet btn--full"}
        href={chat}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
      >
        {label}
      </a>
      <small>{mode === "share" ? shareHint : chatHint}</small>
    </div>
  );
}

// To the customer: order summary, delivery, tracking link.
export function SendOrderToCustomer({ order: o }: { order: Order }) {
  return (
    <SendOnWhatsApp
      order={o}
      phone={o.phone}
      text={orderMessage(o)}
      label="إرسال الطلب للعميل على واتساب"
      shareHint="اختر واتساب ثم محادثة العميل: تُرسل صورة الملخص ومعها النص."
      chatHint="تُفتح محادثة العميل والنص جاهز، وتُنسخ صورة الملخص: الصقها في المحادثة."
    />
  );
}

// After delivery: asks the customer for their review (a link to /review, with the transparency promise).
export function SendReviewRequest({ order: o }: { order: Order }) {
  if (o.status !== "DELIVERED" || o.reviewed) return null;
  return (
    <div className="send-order">
      <a
        className="btn btn--quiet btn--full"
        href={chatUrl(o.phone, reviewRequestMessage(o, window.location.origin))}
        target="_blank"
        rel="noopener noreferrer"
      >
        اطلب من العميل تقييم الطلب (واتساب)
      </a>
      <small>تُفتح محادثة العميل ومعها رابط التقييم. بعد التقييم يقدر يطلب مرة ثانية.</small>
    </div>
  );
}

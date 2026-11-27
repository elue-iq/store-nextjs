"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { dataClient } from "@/lib/data";
import { vapidKeyBytes } from "@/lib/push";

// The bell in the admin bar: turns new-order notifications on or off on this phone (web push).
// iPhone: only inside the admin app opened from the Home Screen (Apple's rule), and only after
// a tap; Android: in the browser too.
type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "جهاز";
}

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/admin")) ?? (await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }));
}

// Saves this phone's push address for the team list (once per address).
async function save(sub: PushSubscription, phone: string) {
  const json = sub.toJSON();
  const endpoint = sub.endpoint;
  const { data } = await dataClient.models.PushSub.listPushSubByEndpoint({ endpoint });
  if (data?.length) return;
  const { errors } = await dataClient.models.PushSub.create({
    endpoint,
    p256dh: json.keys?.p256dh ?? "",
    authKey: json.keys?.auth ?? "",
    device: deviceName(),
    addedBy: phone || null,
  });
  if (errors?.length) throw new Error(errors[0].message);
}

async function forget(endpoint: string) {
  const { data } = await dataClient.models.PushSub.listPushSubByEndpoint({ endpoint });
  await Promise.all((data ?? []).map((s) => dataClient.models.PushSub.delete({ id: s.id })));
}

export function AdminPush() {
  const auth = useAuth();
  const [state, setState] = useState<State>("loading");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!auth.isAdmin) return;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        setState("on");
        save(sub, auth.phone).catch(() => {}); // keep the team list right (e.g. after a reinstall)
      } else setState("off");
    })().catch(() => setState("unsupported"));
  }, [auth.isAdmin, auth.phone]);

  if (!auth.isAdmin) return null;

  async function turnOn() {
    setBusy(true);
    setNote("");
    try {
      // Asked straight from the tap (iPhone requires it).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      if (!reg) throw new Error("no_sw");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() as BufferSource }));
      await save(sub, auth.phone);
      setState("on");
      setNote("تمام. اضغطوا «تجربة» حتى تتأكدون.");
    } catch {
      setNote("ما گدرنا نفعّلها. جرّبوا مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote("");
    try {
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await forget(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setNote("ما گدرنا نطفّيها. جرّبوا مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote("");
    try {
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setState("off");
      await save(sub, auth.phone);
      const { data, errors } = await dataClient.mutations.pushTest({ endpoint: sub.endpoint });
      const r = typeof data === "string" ? (JSON.parse(data) as { sent?: number; noKey?: boolean }) : null;
      if (errors?.length || !r) setNote("صار خطأ بالتجربة.");
      else if (r.noKey) setNote("مفتاح الإشعارات (VAPID_PRIVATE_KEY) بعده مو مضاف بإعدادات Amplify.");
      else if (r.sent) setNote("انرسل. لازم يوصلكم إشعار خلال ثواني.");
      else setNote("ما انرسل. طفّوها وشغّلوها مرة ثانية.");
    } catch {
      setNote("صار خطأ بالتجربة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-push">
      <button
        type="button"
        className={`admin-push__bell${state === "on" ? " admin-push__bell--on" : ""}`}
        aria-label="إشعارات الطلبات"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      </button>
      {open && (
        <div className="admin-push__panel" role="dialog" aria-label="إشعارات الطلبات">
          <strong>إشعارات الطلبات الجديدة</strong>
          {state === "loading" && <p>لحظة…</p>}
          {state === "on" && (
            <>
              <p>شغّالة على هذا الجهاز: كل طلب جديد يوصلكم إشعار.</p>
              <div className="admin-push__actions">
                <button type="button" className="btn btn--small" disabled={busy} onClick={() => void test()}>
                  تجربة
                </button>
                <button type="button" className="btn btn--small btn--quiet" disabled={busy} onClick={() => void turnOff()}>
                  إيقاف
                </button>
              </div>
            </>
          )}
          {state === "off" && (
            <>
              <p>فعّلوها حتى يوصلكم إشعار بكل طلب جديد على هذا الجهاز.</p>
              <button type="button" className="btn btn--small" disabled={busy} onClick={() => void turnOn()}>
                فعّلوا الإشعارات
              </button>
            </>
          )}
          {state === "ios-install" && (
            <p>على الآيفون: ثبّتوا لوحة الطلبات على الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية)، افتحوها من هناك، وبعدها فعّلوا الإشعارات.</p>
          )}
          {state === "denied" && <p>الإشعارات مرفوضة لهذا الموقع. فعّلوها من إعدادات الجهاز، وبعدها ارجعوا هنا.</p>}
          {state === "unsupported" && <p>هذا المتصفح ما يدعم الإشعارات. جرّبوا Chrome على أندرويد، أو لوحة الطلبات من الشاشة الرئيسية على الآيفون.</p>}
          {note && <p className="admin-push__note">{note}</p>}
        </div>
      )}
    </div>
  );
}

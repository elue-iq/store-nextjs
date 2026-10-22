"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Registers the admin service worker and offers "تثبيت التطبيق":
// - Android / Chrome / Edge: the browser's own install dialog.
// - iPhone / iPad (Safari): short instructions (Share → Add to Home Screen).
// Hidden once the app is already running installed.
export function AdminInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }).catch(() => {});
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <div className="admin-install">
      <button
        type="button"
        className="btn btn--small"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") setInstalled(true);
            setPrompt(null);
          } else {
            setShowHelp((v) => !v);
          }
        }}
      >
        تثبيت التطبيق
      </button>
      {showHelp && (
        <div className="admin-install__help" role="dialog" aria-label="طريقة التثبيت">
          <p>لتثبيت لوحة الطلبات على هذا الجهاز:</p>
          <ol>
            <li>
              اضغط زر المشاركة{" "}
              <svg viewBox="0 0 24 24" aria-hidden="true" className="admin-install__share">
                <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
              </svg>{" "}
              في Safari.
            </li>
            <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
            <li>افتح «طلبات ÉLUE» من الشاشة الرئيسية وسجّل الدخول مرة واحدة.</li>
          </ol>
          <button type="button" className="link-button" onClick={() => setShowHelp(false)}>
            إغلاق
          </button>
        </div>
      )}
    </div>
  );
}

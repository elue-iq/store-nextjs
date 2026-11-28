"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { openAdminOrder, openAdminView, useAdminOrders } from "@/lib/adminFeed";
import { newOrderPush } from "@/lib/push";
import type { Order } from "@/lib/data";

// The bell in the admin's top bar: the newest orders as notifications, with a count of the
// ones this phone has not seen yet. Built from orders already on the phone (no extra data).
// Notification settings (on/off/test) are in the menu › الإعدادات.

const SEEN_KEY = "elue-admin-inbox-seen-v1";
const SHOWN = 30;

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(at: string) {
  try {
    localStorage.setItem(SEEN_KEY, at);
  } catch {}
}

// An order waiting for its Qi payment, or abandoned there, is not news yet.
const isNews = (o: Order) => !(o.qiStatus && !o.paid && o.status !== "CONFIRMED");

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "الآن";
  if (min < 60) return `قبل ${min} د`;
  const h = Math.round(min / 60);
  if (h < 24) return `قبل ${h} س`;
  return new Date(iso).toLocaleDateString("ar-IQ-u-nu-latn", { day: "numeric", month: "short", timeZone: "Asia/Baghdad" });
}

export function AdminInbox() {
  const auth = useAuth();
  const orders = useAdminOrders();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  // What was unread when the list was opened (kept marked while it is open).
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const s = readSeen();
    if (s) setSeen(s);
    else {
      // First time on this phone: start from now, not from every old order.
      const at = new Date().toISOString();
      writeSeen(at);
      setSeen(at);
    }
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(
    () =>
      orders
        .filter(isNews)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, SHOWN),
    [orders],
  );
  // Unread: arrived after this phone last opened the list, and not entered by this person.
  const unread = seen ? items.filter((o) => o.createdAt > seen && o.createdBy !== auth.phone).length : 0;

  // The app icon's badge (Home Screen app), where the phone supports it.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  if (!auth.isAdmin) return null;

  function toggle() {
    if (!open) {
      setSeenAtOpen(seen);
      const at = new Date().toISOString();
      writeSeen(at);
      setSeen(at);
      setNow(Date.now());
    }
    setOpen((v) => !v);
  }

  return (
    <div className="admin-push">
      <button
        type="button"
        className="admin-push__bell"
        aria-label={unread ? `الإشعارات: ${unread} جديدة` : "الإشعارات"}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span className="admin-push__count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="admin-push__panel admin-inbox" role="dialog" aria-label="الإشعارات">
          <div className="admin-inbox__head">
            <strong>الإشعارات</strong>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setOpen(false);
                openAdminView("settings");
              }}
            >
              الإعدادات
            </button>
          </div>
          {items.length === 0 ? (
            <p className="admin-push__note">ماكو طلبات بعد.</p>
          ) : (
            <ul className="admin-inbox__list">
              {items.map((o) => {
                const msg = newOrderPush(o);
                const fresh = Boolean(seenAtOpen && o.createdAt > seenAtOpen && o.createdBy !== auth.phone);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`admin-inbox__item${fresh ? " admin-inbox__item--new" : ""}`}
                      onClick={() => {
                        setOpen(false);
                        openAdminOrder(o.id);
                      }}
                    >
                      <span className="admin-inbox__title">
                        {msg.title}
                        <span className="admin-inbox__time">{ago(o.createdAt, now)}</span>
                      </span>
                      <span className="admin-inbox__body">{msg.body}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

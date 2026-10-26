"use client";

import { useEffect } from "react";

export type AdminView = "orders" | "customers" | "products";

// The admin's side menu (opens from the ☰ button). One tap to any section, so the
// order list stays about orders only.
export function AdminDrawer({
  open,
  view,
  counts,
  phone,
  onClose,
  onView,
  onNewOrder,
  onSignOut,
}: {
  open: boolean;
  view: AdminView;
  counts: { orders: number; customers: number; attention: number };
  phone: string;
  onClose: () => void;
  onView: (v: AdminView) => void;
  onNewOrder: () => void;
  onSignOut: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const item = (v: AdminView, label: string, badge?: number, attention?: boolean) => (
    <button
      type="button"
      className="admin-drawer__item"
      aria-current={view === v ? "page" : undefined}
      onClick={() => onView(v)}
    >
      <span>{label}</span>
      {badge !== undefined && <small className={attention ? "is-attention" : undefined}>{badge}</small>}
    </button>
  );

  return (
    <div className={`admin-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button type="button" className="admin-drawer__backdrop" tabIndex={-1} aria-label="إغلاق القائمة" onClick={onClose} />
      <nav className="admin-drawer__panel" aria-label="أقسام لوحة الفريق">
        <div className="admin-drawer__head">
          <strong>لوحة الفريق</strong>
          <button type="button" className="admin-drawer__close" aria-label="إغلاق" onClick={onClose}>
            ×
          </button>
        </div>
        {item("orders", "الطلبات", counts.orders, counts.attention > 0)}
        {item("customers", "العملاء", counts.customers)}
        {item("products", "المنتجات")}
        <button type="button" className="admin-drawer__item admin-drawer__item--primary" onClick={onNewOrder}>
          <span>+ طلب جديد لعميل</span>
        </button>
        <div className="admin-drawer__foot">
          <span dir="ltr">{phone}</span>
          <button type="button" className="link-button" onClick={onSignOut}>
            تسجيل الخروج
          </button>
        </div>
      </nav>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { dataClient, type Order } from "@/lib/data";
import { collectBreakdown, MODON_CITY, modonCollect, normalizeArabic, suggestRegion, type ModonRegion } from "@/lib/modon";
import { formatIQD, site } from "@/lib/site";

// Errors from the modon function come back as "code:message".
function modonError(errors: { message?: string }[] | null | undefined, fallback: string): string {
  const m = errors?.[0]?.message ?? "";
  const i = m.indexOf(":");
  const code = i > 0 ? m.slice(0, i) : m;
  const detail = i > 0 ? m.slice(i + 1).trim() : "";
  if (code === "already_sent") return `الطلب مُرسل إلى مدن مسبقًا (${detail}).`;
  if (code.startsWith("modon_")) return detail ? `مدن: ${detail}` : fallback;
  return fallback;
}

export async function callModon(args: {
  action: "regions" | "send" | "update" | "delete" | "refresh";
  orderId?: string;
  cityId?: number;
  regionId?: number;
  regionName?: string;
}): Promise<{ data: Record<string, unknown> | null; error: string }> {
  try {
    const { data, errors } = await dataClient.mutations.modon(args);
    if (errors?.length) return { data: null, error: modonError(errors, "تعذّر الاتصال بمدن الآن. حاول مجددًا.") };
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return { data: (parsed ?? {}) as Record<string, unknown>, error: "" };
  } catch (err) {
    console.error("modon call failed", err);
    return { data: null, error: "تعذّر الاتصال بمدن الآن. حاول مجددًا." };
  }
}

// When each order last asked Modon for its status from this screen (one call a minute at most,
// even if the order screen is opened again or re-rendered).
const lastAsked = new Map<string, number>();

// Tap a region to choose it. (A <select> list showed its first row as picked while nothing was
// chosen, so tapping that row did nothing.)
function RegionList({ regions, value, onPick }: { regions: ModonRegion[]; value: number | null; onPick: (id: number) => void }) {
  return (
    <div className="modon__regions" role="listbox" aria-label="المنطقة لدى مدن">
      {regions.map((r) => (
        <button
          key={r.id}
          type="button"
          role="option"
          aria-selected={r.id === value}
          className={r.id === value ? "modon__region is-picked" : "modon__region"}
          onClick={() => onPick(r.id)}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}

// The «التوصيل عبر مدن» block on an order screen in /admin.
export function AdminModon({ order: o }: { order: Order }) {
  const toast = useToast();
  const cityId = MODON_CITY[o.province ?? ""];
  const [regions, setRegions] = useState<ModonRegion[] | null>(null);
  const [regionsError, setRegionsError] = useState("");
  const [regionId, setRegionId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const sent = Boolean(o.modonQr);
  const cancelled = o.status === "CANCELLED";
  const finished = o.status === "DELIVERED" || cancelled;

  // Opening the order asks Modon for the latest status, so nobody has to press a button.
  // Not once the order is delivered or cancelled (nothing more can change), and not
  // again within a minute of the last update, to keep the API calls down.
  useEffect(() => {
    if (!sent || finished) return;
    const last = o.modonUpdatedAt ? Date.parse(o.modonUpdatedAt) : 0;
    if (Date.now() - Math.max(last, lastAsked.get(o.id) ?? 0) < 60_000) return;
    lastAsked.set(o.id, Date.now());
    void callModon({ action: "refresh", orderId: o.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id]);

  // Regions for the picker, with the closest match to what the customer typed selected.
  useEffect(() => {
    if ((sent && !editing) || cancelled || !cityId) return;
    let alive = true;
    void callModon({ action: "regions", cityId }).then(({ data, error }) => {
      if (!alive) return;
      if (error) return setRegionsError(error);
      const list = (data?.regions as ModonRegion[]) ?? [];
      setRegions(list);
      const current = sent ? list.find((r) => r.id === o.modonRegionId) : null;
      const guess = current ?? suggestRegion(list, o.area ?? "", o.address);
      if (guess) setRegionId(guess.id);
    });
    return () => {
      alive = false;
    };
  }, [sent, editing, cancelled, cityId, o.area, o.address, o.modonRegionId]);

  const shown = useMemo(() => {
    if (!regions) return [];
    const q = normalizeArabic(search);
    const list = q ? regions.filter((r) => normalizeArabic(r.name).includes(q)) : regions;
    const chosen = regions.find((r) => r.id === regionId);
    // Keep the chosen region visible while searching.
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list;
  }, [regions, search, regionId]);

  const chosen = regions?.find((r) => r.id === regionId) ?? null;

  async function run(action: "send" | "update" | "delete" | "refresh", ok: string) {
    setBusy(true);
    const { data, error } = await callModon({
      action,
      orderId: o.id,
      ...(action === "send" || action === "update" ? { regionId: regionId ?? undefined, regionName: chosen?.name } : {}),
    });
    setBusy(false);
    setConfirmSend(false);
    setConfirmDelete(false);
    if (!error && action === "update") setEditing(false);
    if (error) {
      toast({ id: "modon", tone: "attention", message: error });
      return;
    }
    toast({ id: "modon", message: ok });
    if (action === "send" && data?.link) window.open(String(data.link), "_blank", "noopener");
  }

  if (!sent) {
    if (cancelled) return null;
    return (
      <section className="order-detail__block modon">
        <h2>التوصيل عبر مدن</h2>
        {!cityId ? (
          <p className="hint">لا توجد مدينة لدى مدن لمحافظة «{o.province || "غير محددة"}». عدّل عنوان الطلب أولًا.</p>
        ) : regionsError ? (
          <p className="panel-note">{regionsError}</p>
        ) : !regions ? (
          <p className="panel-loading">جارٍ تحميل مناطق مدن…</p>
        ) : (
          <>
            <p className="modon__area">
              كتب العميل: <strong>{[o.area, o.address].filter(Boolean).join(" — ") || "—"}</strong>
            </p>
            <label className="modon__label">
              المنطقة لدى مدن
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`ابحث بين ${regions.length} منطقة`}
              />
            </label>
            <RegionList regions={shown} value={regionId} onPick={setRegionId} />
            <p className="modon__sum">
              يستلم المندوب من العميل{" "}
              <strong>{formatIQD(modonCollect(o.total, Boolean(o.paid), Boolean(o.freeDelivery)))}</strong>
              <small>{collectBreakdown(o.total, Boolean(o.paid), Boolean(o.freeDelivery))}</small>
            </p>
            {confirmSend ? (
              <div className="modon__confirm" role="alert">
                <p>
                  سيُنشأ الطلب لدى مدن ويأتي المندوب لاستلامه. المنطقة: <strong>{chosen?.name}</strong>
                </p>
                <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run("send", "أُرسل الطلب إلى مدن.")}>
                  {busy ? "جارٍ الإرسال…" : "تأكيد الإرسال إلى مدن"}
                </button>
                <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setConfirmSend(false)}>
                  تراجع
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--full" disabled={!chosen} onClick={() => setConfirmSend(true)}>
                {chosen ? "أرسل إلى مدن" : "اختر المنطقة أولًا"}
              </button>
            )}
          </>
        )}
      </section>
    );
  }

  const beforePickup = (o.modonStatusId ?? "1") === "1";

  return (
    <section className="order-detail__block modon">
      <h2>التوصيل عبر مدن</h2>
      <dl className="modon__facts">
        <div>
          <dt>رقم مدن</dt>
          <dd dir="ltr">{o.modonQr}</dd>
        </div>
        <div>
          <dt>الحالة لدى مدن</dt>
          <dd>{o.modonStatus || "—"}</dd>
        </div>
        <div>
          <dt>يستلم المندوب</dt>
          <dd>
            {formatIQD(o.modonPrice ?? modonCollect(o.total, Boolean(o.paid), Boolean(o.freeDelivery)))}
            {o.paid && <small className="modon__paid"> · مدفوع</small>}
            {o.freeDelivery && <small className="modon__paid"> · توصيل مجاني</small>}
          </dd>
        </div>
        {o.modonFee != null && (
          <div>
            <dt>أجور مدن</dt>
            <dd className={o.modonFee !== site.deliveryFee ? "is-warn" : undefined}>{formatIQD(o.modonFee)}</dd>
          </div>
        )}
        {o.modonRegionName && (
          <div>
            <dt>المنطقة</dt>
            <dd>{o.modonRegionName}</dd>
          </div>
        )}
      </dl>
      {o.modonFee != null && o.modonFee !== site.deliveryFee && (
        <p className="panel-note">أجور مدن لهذا الطلب تختلف عن {formatIQD(site.deliveryFee)} المعتمدة في الموقع.</p>
      )}
      {o.modonNote && <p className="panel-note">ملاحظة المندوب: {o.modonNote}</p>}
      <div className="modon__actions">
        {o.modonLink && (
          <a className="btn btn--small" href={o.modonLink} target="_blank" rel="noopener noreferrer">
            طباعة الملصق
          </a>
        )}
      </div>
      {!cancelled &&
        (editing ? (
          <div className="modon__confirm">
            <p>سيُرسل إلى مدن كل ما في الطلب الآن: اسم العميل ورقمه وعنوانه والمنطقة والمبلغ والملاحظة.</p>
            {regionsError ? (
              <p className="panel-note">{regionsError}</p>
            ) : !regions ? (
              <p className="panel-loading">جارٍ تحميل مناطق مدن…</p>
            ) : (
              <>
                <p className="modon__area">
                  العنوان في ÉLUE: <strong>{[o.area, o.address].filter(Boolean).join(" — ") || "—"}</strong>
                </p>
                <label className="modon__label">
                  المنطقة لدى مدن
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`ابحث بين ${regions.length} منطقة`}
                  />
                </label>
                <RegionList regions={shown} value={regionId} onPick={setRegionId} />
                <p className="modon__sum">
                  يستلم المندوب من العميل{" "}
                  <strong>{formatIQD(modonCollect(o.total, Boolean(o.paid), Boolean(o.freeDelivery)))}</strong>
                  <small>{collectBreakdown(o.total, Boolean(o.paid), Boolean(o.freeDelivery))}</small>
                </p>
                <button
                  type="button"
                  className="btn btn--full"
                  disabled={busy || !chosen}
                  onClick={() => void run("update", "حُدّث الطلب لدى مدن.")}
                >
                  {busy ? "جارٍ التحديث…" : "تأكيد التحديث في مدن"}
                </button>
              </>
            )}
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setEditing(false)}>
              تراجع
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--quiet btn--full" onClick={() => setEditing(true)}>
            تحديث الطلب في مدن
          </button>
        ))}
      {beforePickup &&
        (confirmDelete ? (
          <div className="modon__confirm" role="alert">
            <p>سيُحذف الطلب من مدن ولن يأتي المندوب لاستلامه.</p>
            <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run("delete", "حُذف الطلب من مدن.")}>
              {busy ? "جارٍ الحذف…" : "تأكيد الحذف من مدن"}
            </button>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setConfirmDelete(false)}>
              تراجع
            </button>
          </div>
        ) : (
          <button type="button" className="link-button modon__delete" onClick={() => setConfirmDelete(true)}>
            حذف الطلب من مدن
          </button>
        ))}
      {!beforePickup && <p className="hint">استلم المندوب الطلب: الإلغاء يكون بالاتصال بمدن. إن رفض مدن التعديل ستظهر رسالتهم.</p>}
    </section>
  );
}

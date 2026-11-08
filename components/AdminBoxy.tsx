"use client";

import { useEffect, useMemo, useState } from "react";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";
import { useToast } from "./Toast";
import { dataClient, type Order } from "@/lib/data";
import { BOXY_PROVINCE, boxyCollect, type BoxyRegion } from "@/lib/boxy";
import { collectBreakdown, normalizeArabic, suggestRegion } from "@/lib/modon";
import { deliveryPayOf, formatIQD, site } from "@/lib/site";

// Errors from the boxy function come back as "code:message".
function boxyError(errors: { message?: string }[] | null | undefined, fallback: string): string {
  const m = errors?.[0]?.message ?? "";
  const i = m.indexOf(":");
  const code = i > 0 ? m.slice(0, i) : m;
  const detail = i > 0 ? m.slice(i + 1).trim() : "";
  if (code === "already_sent") return `الطلب مُرسل إلى بوكسي مسبقًا (${detail}).`;
  if (code.startsWith("boxy_")) return detail ? `بوكسي: ${detail}` : fallback;
  return fallback;
}

export function boxyEventList(raw: unknown): { at: string; text: string }[] {
  let v: unknown = raw;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((e): e is { at: string; text: string } => Boolean(e) && typeof e.at === "string" && typeof e.text === "string") : [];
}

// Every notification Boxy sent to our webhook, newest first (the Delivery tab).
export function AdminBoxyFeed({ onOpenOrder }: { onOpenOrder: (orderNumber: string) => void }) {
  const [list, setList] = useState<{ id: string; at: string; title?: string | null; detail?: string | null; orderNumber?: string | null; kind?: string | null; raw?: string | null }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      dataClient.models.BoxyEvent.list({ limit: 200 })
        .then(({ data }) => live && setList([...data].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60)))
        .catch(() => live && setList([]));
    void load();
    const t = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <section className="order-detail__block">
      <h3 className="order-detail__title">إشعارات بوكسي</h3>
      {list === null ? (
        <p className="hint">جارٍ التحميل…</p>
      ) : list.length === 0 ? (
        <p className="hint">لا توجد إشعارات بعد.</p>
      ) : (
        <ol className="boxy-feed">
          {list.map((e) => (
            <li key={e.id}>
              <small>{new Date(e.at).toLocaleString("ar-IQ")}</small>
              <strong>{e.title || e.kind || "إشعار"}</strong>
              {e.detail && <span>{e.detail}</span>}
              {e.orderNumber && (
                <button type="button" className="btn btn--small btn--ghost" onClick={() => onOpenOrder(e.orderNumber as string)}>
                  {e.orderNumber}
                </button>
              )}
              {e.raw && (
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? "إخفاء" : "التفاصيل"}
                </button>
              )}
              {open === e.id && <pre dir="ltr">{e.raw}</pre>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export async function callBoxy(args: {
  action: "regions" | "send" | "update" | "cancel" | "refresh" | "label";
  orderId?: string;
  province?: string;
  regionId?: number;
  regionName?: string;
}): Promise<{ data: Record<string, unknown> | null; error: string }> {
  try {
    const { data, errors } = await dataClient.mutations.boxy(args);
    requestOrdersRefresh();
    if (errors?.length) return { data: null, error: boxyError(errors, "تعذّر الاتصال ببوكسي الآن. حاول مجددًا.") };
    let parsed: unknown = data;
    for (let i = 0; i < 3 && typeof parsed === "string"; i++) parsed = JSON.parse(parsed);
    return { data: (parsed ?? {}) as Record<string, unknown>, error: "" };
  } catch (err) {
    console.error("boxy call failed", err);
    return { data: null, error: "تعذّر الاتصال ببوكسي الآن. حاول مجددًا." };
  }
}

const lastAsked = new Map<string, number>();

// The «التوصيل عبر بوكسي» block on an order screen in /admin.
export function AdminBoxy({ order: o }: { order: Order }) {
  const toast = useToast();
  const hasProvince = Boolean(BOXY_PROVINCE[o.province ?? ""]);
  const [regions, setRegions] = useState<BoxyRegion[] | null>(null);
  const [regionsError, setRegionsError] = useState("");
  const [regionText, setRegionText] = useState(o.boxyRegionName || o.area || "");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const sent = Boolean(o.boxyUid);
  const cancelled = o.status === "CANCELLED";
  const finished = o.status === "DELIVERED" || cancelled;
  const beforePickup = ["new", "scheduled", ""].includes(o.boxyStatus ?? "new");

  // Opening the order asks Boxy for the latest status (once a minute at most).
  useEffect(() => {
    if (!sent || finished) return;
    const last = o.boxyUpdatedAt ? Date.parse(o.boxyUpdatedAt) : 0;
    if (Date.now() - Math.max(last, lastAsked.get(o.id) ?? 0) < 60_000) return;
    lastAsked.set(o.id, Date.now());
    void callBoxy({ action: "refresh", orderId: o.id }).then(({ data }) => {
      if ((data?.released as string[] | undefined)?.length)
        toast({ id: "boxy", tone: "attention", message: "هذا الطلب ملغى في بوكسي. يمكنك إرساله إلى بوكسي من جديد." });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id]);

  useEffect(() => {
    if ((sent && !editing) || cancelled || !hasProvince) return;
    let alive = true;
    void callBoxy({ action: "regions", province: o.province ?? "" }).then(({ data, error }) => {
      if (!alive) return;
      if (error) return setRegionsError(error);
      const list = (data?.regions as BoxyRegion[]) ?? [];
      setRegions(list);
      // Boxy's list may hold just one area per province: it is only a hint. The
      // area is free text, starting from the best match or what the customer wrote.
      const current = sent ? list.find((r) => r.name === o.boxyRegionName) : null;
      const guess = current ?? suggestRegion(list, o.area ?? "", o.address);
      if (guess) setRegionText(guess.name);
    });
    return () => {
      alive = false;
    };
  }, [sent, editing, cancelled, hasProvince, o.province, o.area, o.address, o.boxyRegionName]);

  const shown = useMemo(() => {
    if (!regions) return [];
    const q = normalizeArabic(regionText);
    const list = q ? regions.filter((r) => normalizeArabic(r.name).includes(q)) : regions;
    return list.slice(0, 40);
  }, [regions, regionText]);
  const typed = regionText.trim();
  const chosen = typed ? { name: typed, id: regions?.find((r) => r.name === typed)?.id ?? null } : null;
  const collect = boxyCollect(o as unknown as Parameters<typeof boxyCollect>[0]);

  async function run(action: "send" | "update" | "cancel", ok: string) {
    setBusy(true);
    const { data, error } = await callBoxy({
      action,
      orderId: o.id,
      ...(action !== "cancel" && chosen ? { ...(chosen.id != null ? { regionId: chosen.id } : {}), regionName: chosen.name } : {}),
    });
    setBusy(false);
    setConfirmSend(false);
    setConfirmCancel(false);
    if (!error && action === "update") setEditing(false);
    if (error) return toast({ id: "boxy", tone: "attention", message: error });
    if (data?.cooled === false) {
      return toast({
        id: "boxy",
        tone: "attention",
        message: "أُرسل بدون تبريد: بوكسي ما يوصّل المبرد لهذه المنطقة حالياً. نبّهوا العميل يحط الطلب بالبراد أول ما يستلمه.",
      });
    }
    toast({ id: "boxy", message: data?.recreated ? "كان الطلب ملغى في بوكسي، فأُرسل إليهم من جديد." : ok });
  }

  async function label() {
    setBusy(true);
    const { data, error } = await callBoxy({ action: "label", orderId: o.id });
    setBusy(false);
    if (error) return toast({ id: "boxy", tone: "attention", message: error });
    if (typeof data?.pdf === "string") {
      const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
      window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank", "noopener");
    } else if (o.boxyLink) {
      window.open(o.boxyLink, "_blank", "noopener");
    } else {
      toast({ id: "boxy", tone: "attention", message: "لم يُرجع بوكسي ملصقًا قابلًا للطباعة." });
    }
  }

  const picker = (
    <>
      <p className="modon__area">
        كتب العميل: <strong>{[o.area, o.address].filter(Boolean).join(" — ") || "—"}</strong>
      </p>
      {regionsError && <p className="panel-note">{regionsError}</p>}
      <label className="modon__label">
        المنطقة لدى بوكسي
        <input type="text" value={regionText} onChange={(e) => setRegionText(e.target.value)} placeholder="اكتب اسم المنطقة" />
      </label>
      {shown.length > 0 && (
        <div className="modon__regions" role="listbox" aria-label="مناطق بوكسي المقترحة">
          {shown.map((r) => (
            <button
              key={r.name}
              type="button"
              role="option"
              aria-selected={r.name === typed}
              className={r.name === typed ? "modon__region is-picked" : "modon__region"}
              onClick={() => setRegionText(r.name)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      <p className="modon__sum">
        يستلم المندوب من العميل <strong>{formatIQD(collect)}</strong>
        <small>{collectBreakdown(o.total, Boolean(o.paid), deliveryPayOf(o))}</small>
      </p>
    </>
  );

  if (!sent) {
    if (cancelled) return null;
    return (
      <section className="order-detail__block modon">
        <h2>التوصيل عبر بوكسي</h2>
        {!hasProvince ? (
          <p className="hint">لا توجد محافظة لدى بوكسي مطابقة لـ «{o.province || "غير محددة"}». عدّل عنوان الطلب أولًا.</p>
        ) : (
          <>
            {picker}
            {confirmSend ? (
              <div className="modon__confirm" role="alert">
                <p>
                  سيُنشأ الطلب لدى بوكسي ويأتي المندوب لاستلامه. المنطقة: <strong>{chosen?.name}</strong>
                </p>
                <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run("send", "أُرسل الطلب إلى بوكسي.")}>
                  {busy ? "جارٍ الإرسال…" : "تأكيد الإرسال إلى بوكسي"}
                </button>
                <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setConfirmSend(false)}>
                  تراجع
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--full" disabled={!chosen} onClick={() => setConfirmSend(true)}>
                {chosen ? "أرسل إلى بوكسي" : "اكتب المنطقة أولًا"}
              </button>
            )}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="order-detail__block modon">
      <h2>التوصيل عبر بوكسي</h2>
      <dl className="modon__facts">
        <div>
          <dt>رقم بوكسي</dt>
          <dd dir="ltr">{o.boxyCode}</dd>
        </div>
        <div>
          <dt>الحالة لدى بوكسي</dt>
          <dd>{o.boxyStatusTitle || o.boxyStatus || "—"}</dd>
        </div>
        <div>
          <dt>يستلم المندوب</dt>
          <dd>
            {formatIQD(collect)}
            {o.paid && <small className="modon__paid"> · مدفوع</small>}
          </dd>
        </div>
        {o.boxyFee != null && (
          <div>
            <dt>أجور بوكسي</dt>
            <dd className={o.boxyFee !== site.deliveryFee ? "is-warn" : undefined}>{formatIQD(o.boxyFee)}</dd>
          </div>
        )}
        {o.boxyRegionName && (
          <div>
            <dt>المنطقة</dt>
            <dd>{o.boxyRegionName}</dd>
          </div>
        )}
      </dl>
      {o.boxyCooled === false && (
        <p className="panel-note">
          ❄️ أُرسل بدون تبريد: بوكسي ما يوصّل المبرد لهذه المنطقة حالياً. نبّهوا العميل يحط الطلب بالبراد أول ما يستلمه.
        </p>
      )}
      {o.boxyNote && <p className="panel-note">ملاحظة بوكسي: {o.boxyNote}</p>}
      {boxyEventList(o.boxyEvents).length > 0 && (
        <details className="boxy-events">
          <summary>إشعارات بوكسي ({boxyEventList(o.boxyEvents).length})</summary>
          <ol>
            {[...boxyEventList(o.boxyEvents)].reverse().map((e, i) => (
              <li key={i}>
                <small>{new Date(e.at).toLocaleString("ar-IQ")}</small> {e.text}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="modon__actions">
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => void label()}>
          طباعة الملصق
        </button>
        {o.boxyLink && (
          <a className="btn btn--small btn--ghost" href={o.boxyLink} target="_blank" rel="noopener noreferrer">
            صفحة التتبع
          </a>
        )}
      </div>
      {!cancelled &&
        (editing ? (
          <div className="modon__confirm">
            <p>سيُرسل إلى بوكسي كل ما في الطلب الآن: اسم العميل ورقمه وعنوانه والمنطقة والمبلغ والملاحظة.</p>
            {picker}
            <button type="button" className="btn btn--full" disabled={busy || !chosen} onClick={() => void run("update", "حُدّث الطلب لدى بوكسي.")}>
              {busy ? "جارٍ التحديث…" : "تأكيد التحديث في بوكسي"}
            </button>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setEditing(false)}>
              تراجع
            </button>
          </div>
        ) : (
          beforePickup && (
            <button type="button" className="btn btn--quiet btn--full" onClick={() => setEditing(true)}>
              تحديث الطلب في بوكسي
            </button>
          )
        ))}
      {beforePickup &&
        (confirmCancel ? (
          <div className="modon__confirm" role="alert">
            <p>سيُلغى الطلب لدى بوكسي ولن يأتي المندوب لاستلامه.</p>
            <button type="button" className="btn btn--full" disabled={busy} onClick={() => void run("cancel", "أُلغي الطلب لدى بوكسي.")}>
              {busy ? "جارٍ الإلغاء…" : "تأكيد الإلغاء في بوكسي"}
            </button>
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setConfirmCancel(false)}>
              تراجع
            </button>
          </div>
        ) : (
          <button type="button" className="link-button modon__delete" onClick={() => setConfirmCancel(true)}>
            إلغاء الطلب في بوكسي
          </button>
        ))}
      {!beforePickup && <p className="hint">استلم المندوب الطلب: الإلغاء أو التعديل يكون بالاتصال ببوكسي.</p>}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AdminModon, callModon } from "./AdminModon";
import { AdminBoxy, callBoxy } from "./AdminBoxy";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";
import { useToast } from "./Toast";
import { baghdadTime, dataClient, type Courier, type Order } from "@/lib/data";
import { ISSUE_KINDS, issueLabel, issuePlain, modonSupportUrl, type DispatchOrder, type IssueKind } from "@/lib/dispatch";
import { site } from "@/lib/site";

// Errors from the dispatch function come back as "code:detail".
function dispatchError(errors: { message?: string }[] | null | undefined): string {
  const m = errors?.[0]?.message ?? "";
  const i = m.indexOf(":");
  const code = i > 0 ? m.slice(0, i) : m;
  const detail = i > 0 ? m.slice(i + 1).trim() : "";
  if (code === "already_modon") return `الطلب مُرسل إلى مدن (${detail}). احذفه من مدن أولاً.`;
  if (code === "courier_inactive") return "شركة التوصيل هذه موقوفة.";
  if (code === "courier_not_found") return "لم نجد شركة التوصيل. ربما حُذفت.";
  if (code === "cancelled") return "الطلب ملغى.";
  if (code === "not_assigned") return "الطلب غير مُسند إلى شركة توصيل محلية.";
  return "تعذّر تنفيذ الطلب الآن. حاول مجددًا.";
}

export async function callDispatch(args: {
  action: "bot" | "test" | "assign" | "resend" | "unassign" | "cancel_notice" | "report";
  orderId?: string;
  courierId?: string;
  chatId?: string;
  kind?: string;
  text?: string;
}): Promise<{ data: Record<string, unknown> | null; error: string }> {
  try {
    const { data, errors } = await dataClient.mutations.dispatch(args);
    requestOrdersRefresh();
    if (errors?.length) return { data: null, error: dispatchError(errors) };
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return { data: (parsed ?? {}) as Record<string, unknown>, error: "" };
  } catch (err) {
    console.error("dispatch call failed", err);
    return { data: null, error: "تعذّر الاتصال بالخادم الآن. حاول مجددًا." };
  }
}

type Issue = { at: string; by?: string; kind: string; text?: string; to: string; via: string; ok: boolean };

function issuesOf(o: Order): Issue[] {
  let list: unknown = o.issues;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? (list as Issue[]) : [];
}

// «التوصيل» on an order screen in /admin: who delivers it (Modon, or one of our
// own couriers, who gets the order on Telegram), and «الإبلاغ عن مشكلة».
export function AdminDelivery({ order: o, onOpenCouriers }: { order: Order; onOpenCouriers: () => void }) {
  const toast = useToast();
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null); // courier id being assigned
  const [changing, setChanging] = useState(false); // choosing a different delivery company
  const [target, setTarget] = useState<string | null>(null); // "MODON" or a courier id, picked while changing
  const [reporting, setReporting] = useState(false);
  const [kind, setKind] = useState<IssueKind | "">("");
  const [text, setText] = useState("");

  const atModon = Boolean(o.modonQr);
  const local = o.courierKind === "LOCAL" && Boolean(o.courierId);
  const pickedModon = atModon || o.courierKind === "MODON";
  const atBoxy = Boolean(o.boxyUid);
  const pickedBoxy = atBoxy || o.courierKind === "BOXY";
  const cancelled = o.status === "CANCELLED";
  const delivered = o.status === "DELIVERED";

  useEffect(() => {
    let alive = true;
    dataClient.models.Courier.list({ limit: 100 })
      .then(({ data }) => alive && setCouriers([...data].sort((a, b) => a.name.localeCompare(b.name, "ar"))))
      .catch((err) => {
        console.error("couriers failed", err);
        if (alive) setCouriers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const active = (couriers ?? []).filter((c) => c.active !== false);

  async function assign(c: Courier) {
    setBusy(true);
    const { data, error } = await callDispatch({ action: "assign", orderId: o.id, courierId: c.id });
    setBusy(false);
    setConfirm(null);
    if (error) return toast({ id: "dispatch", tone: "attention", message: error });
    toast(
      data?.ok
        ? { id: "dispatch", message: `أُسند ${o.orderNumber} إلى ${c.name} وأُرسل على تيليغرام.` }
        : { id: "dispatch", tone: "attention", message: `أُسند الطلب إلى ${c.name} لكن لم يصل: ${String(data?.error ?? "")}` },
    );
  }

  async function printLabel() {
    setBusy(true);
    try {
      const { buildLabelsPdf, labelsFilename } = await import("@/lib/label");
      const { downloadBlob } = await import("@/lib/receipt");
      downloadBlob(await buildLabelsPdf([o]), labelsFilename([o]));
    } catch (err) {
      console.error("label failed", err);
      toast({ id: "delivery", tone: "attention", message: "تعذّر تجهيز الملصق. حاول مرة ثانية." });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    const { data, error } = await callDispatch({ action: "resend", orderId: o.id });
    setBusy(false);
    if (error) return toast({ id: "dispatch", tone: "attention", message: error });
    toast(
      data?.ok
        ? { id: "dispatch", message: "أُعيد إرسال الطلب على تيليغرام." }
        : { id: "dispatch", tone: "attention", message: `لم يصل: ${String(data?.error ?? "")}` },
    );
  }

  async function unassign() {
    setBusy(true);
    const { error } = await callDispatch({ action: "unassign", orderId: o.id });
    setBusy(false);
    setConfirm(null);
    if (error) return toast({ id: "dispatch", tone: "attention", message: error });
    toast({ id: "dispatch", message: `سُحب الطلب من ${o.courierName ?? "شركة التوصيل"}.` });
  }

  async function pickModon() {
    setBusy(true);
    const { errors } = await dataClient.models.Order.update({ id: o.id, courierKind: "MODON" });
    requestOrdersRefresh();
    setBusy(false);
    if (errors?.length) toast({ id: "dispatch", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
  }

  async function pickBoxy() {
    setBusy(true);
    const { errors } = await dataClient.models.Order.update({ id: o.id, courierKind: "BOXY" });
    requestOrdersRefresh();
    setBusy(false);
    if (errors?.length) toast({ id: "dispatch", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
  }

  async function clearBoxy() {
    setBusy(true);
    await dataClient.models.Order.update({ id: o.id, courierKind: null });
    requestOrdersRefresh();
    setBusy(false);
  }

  async function clearModon() {
    setBusy(true);
    await dataClient.models.Order.update({ id: o.id, courierKind: null });
    requestOrdersRefresh();
    setBusy(false);
  }

  // Move the order to another delivery company in one step. The old one is told
  // (a local courier gets a «withdrawn» note on Telegram; at Modon the order is deleted,
  // which is only possible before the Modon driver picks it up).
  const beforePickup = (o.modonStatusId ?? "1") === "1";
  async function switchTo(to: string) {
    setBusy(true);
    try {
      if (atModon) {
        const { error } = await callModon({ action: "delete", orderId: o.id });
        if (error) return toast({ id: "dispatch", tone: "attention", message: error });
      }
      if (atBoxy) {
        const { error } = await callBoxy({ action: "cancel", orderId: o.id });
        if (error) return toast({ id: "dispatch", tone: "attention", message: error });
      }
      if (to === "BOXY") {
        if (local) {
          const { error } = await callDispatch({ action: "unassign", orderId: o.id });
          if (error) return toast({ id: "dispatch", tone: "attention", message: error });
        }
        const { errors } = await dataClient.models.Order.update({ id: o.id, courierKind: "BOXY" });
        requestOrdersRefresh();
        if (errors?.length) return toast({ id: "dispatch", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
        toast({ id: "dispatch", message: "اخترت بوكسي. اختر المنطقة وأرسل الطلب إليهم." });
      } else if (to === "MODON") {
        if (local) {
          const { error } = await callDispatch({ action: "unassign", orderId: o.id });
          if (error) return toast({ id: "dispatch", tone: "attention", message: error });
        }
        const { errors } = await dataClient.models.Order.update({ id: o.id, courierKind: "MODON" });
        requestOrdersRefresh();
        if (errors?.length) return toast({ id: "dispatch", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
        toast({ id: "dispatch", message: "اخترت مدن Express. اختر المنطقة وأرسل الطلب إليهم." });
      } else {
        const c = active.find((x) => x.id === to);
        if (!c) return;
        const { data, error } = await callDispatch({ action: "assign", orderId: o.id, courierId: c.id });
        if (error) return toast({ id: "dispatch", tone: "attention", message: error });
        toast(
          data?.ok
            ? { id: "dispatch", message: `نُقل ${o.orderNumber} إلى ${c.name} وأُرسل على تيليغرام.` }
            : { id: "dispatch", tone: "attention", message: `نُقل الطلب إلى ${c.name} لكن لم يصل: ${String(data?.error ?? "")}` },
        );
      }
      setChanging(false);
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const boxyBeforePickup = ["new", "scheduled", ""].includes(o.boxyStatus ?? "new");
  const canChange = (local || (atModon && beforePickup) || (atBoxy && boxyBeforePickup)) && !cancelled && !delivered;
  const changeOptions: [string, string][] = [
    ...(atModon || o.courierKind === "MODON" ? [] : [["MODON", "مدن Express"] as [string, string]]),
    ...(atBoxy || o.courierKind === "BOXY" ? [] : [["BOXY", "بوكسي"] as [string, string]]),
    ...active.filter((c) => c.id !== o.courierId).map((c) => [c.id, c.name] as [string, string]),
  ];
  const targetName = changeOptions.find(([id]) => id === target)?.[1] ?? "";
  const fromName = atModon ? "مدن Express" : atBoxy ? "بوكسي" : (o.courierName ?? "شركة التوصيل");

  // ---- Problem report ------------------------------------------------------

  const reportOrder = { ...o, courierSentAt: o.courierSentAt ?? o.modonSentAt } as unknown as DispatchOrder;
  const recipient = atModon ? "دعم مدن Express" : (o.courierName ?? "شركة التوصيل");
  const message = kind ? issuePlain(reportOrder, kind, text, recipient) : "";

  async function recordIssue(entry: Issue) {
    const { errors } = await dataClient.models.Order.update({ id: o.id, issues: JSON.stringify([...issuesOf(o), entry].slice(-30)) });
    if (errors?.length) console.error("saving the report failed", errors);
  }

  async function reportLocal() {
    if (!kind) return;
    setBusy(true);
    const { data, error } = await callDispatch({ action: "report", orderId: o.id, kind, text });
    setBusy(false);
    if (error) return toast({ id: "dispatch", tone: "attention", message: error });
    if (data?.ok) {
      toast({ id: "dispatch", message: `أُرسل البلاغ إلى ${o.courierName} على تيليغرام.` });
      setReporting(false);
      setKind("");
      setText("");
    } else {
      toast({ id: "dispatch", tone: "attention", message: `لم يصل البلاغ: ${String(data?.error ?? "")}` });
    }
  }

  function reportModon() {
    // The link opens WhatsApp itself; this only keeps a record of the report.
    void recordIssue({ at: new Date().toISOString(), kind: kind as string, text: text.trim(), to: "دعم مدن", via: "whatsapp", ok: true });
    setReporting(false);
    setKind("");
    setText("");
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast({ id: "dispatch", message: "نُسخ نص البلاغ." });
    } catch {
      toast({ id: "dispatch", tone: "attention", message: "تعذّر النسخ." });
    }
  }

  const canReport = atModon || local;
  const issues = issuesOf(o);

  if (!pickedModon && !pickedBoxy && !local && (cancelled || delivered)) return null;

  return (
    <>
      <section className="order-detail__block delivery">
        <h2>شركة التوصيل</h2>

        {atModon ? (
          <p className="hint">الطلب عند مدن Express.{beforePickup ? "" : " استلمه المندوب: التغيير يكون بالاتصال بمدن."}</p>
        ) : atBoxy ? (
          <p className="hint">الطلب عند بوكسي.{boxyBeforePickup ? "" : " استلمه المندوب: التغيير يكون بالاتصال ببوكسي."}</p>
        ) : local ? (
          <div className="delivery__status">
            <p>
              <strong>{o.courierName}</strong> · تيليغرام
            </p>
            <p className={o.courierStatus === "SENT" ? "delivery__ok" : "order-card__warn"}>
              {o.courierStatus === "SENT" && o.courierSentAt
                ? `✓ أُرسل إليهم ${baghdadTime(o.courierSentAt).slice(5)}`
                : `✗ لم يصل الطلب${o.courierError ? `: ${o.courierError}` : ""}`}
            </p>
            {!cancelled && (
              <div className="modon__actions">
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void printLabel()}>
                  طباعة الملصق (PDF)
                </button>
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void resend()}>
                  {o.courierStatus === "SENT" ? "إعادة الإرسال" : "حاول الإرسال مجددًا"}
                </button>
                {confirm === "unassign" ? (
                  <button type="button" className="btn btn--ghost is-confirm" disabled={busy} onClick={() => void unassign()}>
                    تأكيد سحب الطلب
                  </button>
                ) : (
                  <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirm("unassign")}>
                    سحب الطلب
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          !cancelled && (
            <>
              <div className="delivery__chips" role="group" aria-label="اختر شركة التوصيل">
                <button type="button" aria-pressed={pickedModon} disabled={busy} onClick={() => void pickModon()}>
                  مدن Express
                </button>
                <button type="button" aria-pressed={pickedBoxy} disabled={busy} onClick={() => void pickBoxy()}>
                  بوكسي
                </button>
                {active.map((c) => (
                  <button key={c.id} type="button" aria-pressed={confirm === c.id} disabled={busy} onClick={() => setConfirm(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {couriers && active.length === 0 && (
                <p className="hint">
                  لا توجد شركات توصيل محلية بعد.{" "}
                  <button type="button" className="link-button" onClick={onOpenCouriers}>
                    أضف واحدة
                  </button>
                </p>
              )}
              {confirm && active.find((c) => c.id === confirm) && (
                <div className="modon__confirm" role="alert">
                  <p>
                    سيصل الطلب <span dir="ltr">{o.orderNumber}</span> بكل تفاصيله إلى «{active.find((c) => c.id === confirm)!.name}» على
                    تيليغرام الآن.
                  </p>
                  <button
                    type="button"
                    className="btn btn--full"
                    disabled={busy}
                    onClick={() => void assign(active.find((c) => c.id === confirm)!)}
                  >
                    {busy ? "جارٍ الإرسال…" : "تأكيد الإسناد والإرسال"}
                  </button>
                  <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setConfirm(null)}>
                    تراجع
                  </button>
                </div>
              )}
              {o.courierKind === "MODON" && (
                <button type="button" className="link-button" disabled={busy} onClick={() => void clearModon()}>
                  إلغاء اختيار مدن
                </button>
              )}
              {o.courierKind === "BOXY" && (
                <button type="button" className="link-button" disabled={busy} onClick={() => void clearBoxy()}>
                  إلغاء اختيار بوكسي
                </button>
              )}
            </>
          )
        )}

        {canChange &&
          (changing ? (
            <div className="modon__confirm">
              <div className="delivery__chips" role="group" aria-label="انقل الطلب إلى">
                {changeOptions.map(([id, name]) => (
                  <button key={id} type="button" aria-pressed={target === id} disabled={busy} onClick={() => setTarget(id)}>
                    {name}
                  </button>
                ))}
              </div>
              {changeOptions.length === 0 && <p className="hint">لا توجد شركة توصيل أخرى فعّالة.</p>}
              {target && (
                <>
                  <p role="alert">
                    {target === "BOXY"
                      ? `سيُسحب الطلب من «${fromName}» ثم تختار منطقة بوكسي وترسله.`
                      : atBoxy
                        ? `سيُلغى الطلب لدى بوكسي ثم ${target === "MODON" ? "تختار منطقة مدن" : `يُرسل إلى «${targetName}» على تيليغرام`}.`
                      : atModon
                      ? `سيُحذف الطلب من مدن، ثم ${target === "MODON" ? "" : `يُرسل إلى «${targetName}» على تيليغرام`}.`
                      : target === "MODON"
                        ? `سيُسحب الطلب من «${fromName}» (يصله إشعار على تيليغرام) ثم تختار منطقة مدن وترسله.`
                        : `سيُسحب الطلب من «${fromName}» (يصله إشعار) ويصل «${targetName}» بكل تفاصيله على تيليغرام الآن.`}
                  </p>
                  <button type="button" className="btn btn--full" disabled={busy} onClick={() => void switchTo(target)}>
                    {busy ? "جارٍ النقل…" : `تأكيد النقل إلى ${targetName}`}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn--quiet btn--full"
                disabled={busy}
                onClick={() => (setChanging(false), setTarget(null))}
              >
                تراجع
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setChanging(true)}>
              تغيير شركة التوصيل
            </button>
          ))}
      </section>

      {pickedModon && <AdminModon order={o} />}
      {pickedBoxy && <AdminBoxy order={o} />}

      {canReport && (
        <section className="order-detail__block delivery">
          <h2>مشكلة في التوصيل؟</h2>
          {!reporting ? (
            <button type="button" className="btn btn--quiet btn--full" onClick={() => setReporting(true)}>
              الإبلاغ عن مشكلة
            </button>
          ) : (
            <div className="delivery__report panel-form">
              <label>
                نوع المشكلة
                <select value={kind} onChange={(e) => setKind(e.target.value as IssueKind | "")}>
                  <option value="">اختر…</option>
                  {ISSUE_KINDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                تفاصيل (اختياري)
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} />
              </label>
              <p className="hint">
                {atModon ? (
                  <>
                    يفتح واتساب برسالة جاهزة إلى دعم مدن (<span dir="ltr">{site.modonSupport.display}</span>) فيها كل بيانات الطلب: اضغط إرسال
                    هناك.
                  </>
                ) : (
                  `يُرسل البلاغ بكل بيانات الطلب إلى «${o.courierName}» على تيليغرام.`
                )}
              </p>
              {atModon ? (
                <>
                  <a
                    className={kind ? "btn btn--full" : "btn btn--full is-disabled"}
                    href={kind ? modonSupportUrl(message) : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!kind}
                    onClick={(e) => (kind ? reportModon() : e.preventDefault())}
                  >
                    إرسال البلاغ إلى دعم مدن
                  </a>
                  <div className="order-detail__contact">
                    <button type="button" className="btn btn--quiet btn--small" disabled={!kind} onClick={() => void copyMessage()}>
                      نسخ نص البلاغ
                    </button>
                    <a className="btn btn--quiet btn--small" href={`tel:+${site.modonSupport.whatsapp}`}>
                      اتصال بدعم مدن
                    </a>
                  </div>
                </>
              ) : (
                <button type="button" className="btn btn--full" disabled={busy || !kind} onClick={() => void reportLocal()}>
                  {busy ? "جارٍ الإرسال…" : `إرسال البلاغ إلى ${o.courierName}`}
                </button>
              )}
              <button type="button" className="btn btn--quiet btn--full" disabled={busy} onClick={() => setReporting(false)}>
                تراجع
              </button>
            </div>
          )}
          {issues.length > 0 && (
            <ul className="delivery__issues">
              {[...issues].reverse().map((i, n) => (
                <li key={`${i.at}-${n}`}>
                  <strong>{issueLabel(i.kind)}</strong>
                  {i.text ? ` — ${i.text}` : ""}
                  <small>
                    {baghdadTime(i.at).slice(5)} · {i.to} · {i.via === "telegram" ? (i.ok ? "تيليغرام ✓" : "تيليغرام ✗ لم يصل") : "واتساب"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

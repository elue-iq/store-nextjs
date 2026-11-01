"use client";

import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { callDispatch } from "./AdminDelivery";
import { dataClient, type Courier } from "@/lib/data";
import { chatIdError } from "@/lib/dispatch";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { chatUrl } from "@/lib/share";

type Draft = { id: string; name: string; chatId: string; phone: string; note: string };
const EMPTY: Draft = { id: "", name: "", chatId: "", phone: "", note: "" };

// «شركات التوصيل» in /admin: the local couriers / delivery companies. Each has its own
// Telegram chat (a channel or group the ÉLUE bot is a member of). An order given to a
// courier is sent to its chat by the bot, and delivery problem reports go there too.
export function AdminCouriers() {
  const toast = useToast();
  const [list, setList] = useState<Courier[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<{ name?: string; chatId?: string; phone?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [bot, setBot] = useState<string | null | undefined>(undefined);

  async function load() {
    try {
      const { data } = await dataClient.models.Courier.list({ limit: 100 });
      setList([...data].sort((a, b) => a.name.localeCompare(b.name, "ar")));
    } catch (err) {
      console.error("couriers failed", err);
      setList([]);
    }
  }

  useEffect(() => {
    void load();
    void callDispatch({ action: "bot" }).then(({ data }) => setBot((data?.username as string | null) ?? null));
  }, []);

  async function save() {
    if (!draft) return;
    const found: typeof errors = {};
    if (draft.name.trim().length < 2) found.name = "اكتب اسم شركة التوصيل.";
    const idErr = chatIdError(draft.chatId);
    if (idErr) found.chatId = idErr;
    // The courier's own WhatsApp number (for logging in to /courier); optional, never shared by two.
    const phone = draft.phone.trim() ? normalizeIraqiMobile(draft.phone) : null;
    if (draft.phone.trim() && !phone) found.phone = "رقم الواتساب غير صحيح (مثل 0771 234 5678).";
    else if (phone && (list ?? []).some((c) => c.id !== draft.id && c.phone === phone)) found.phone = "هذا الرقم مسجّل لمندوب آخر.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy("save");
    const values = { name: draft.name.trim(), telegramChatId: draft.chatId.trim(), phone, note: draft.note.trim() || null };
    const { errors: gql } = draft.id
      ? await dataClient.models.Courier.update({ id: draft.id, ...values })
      : await dataClient.models.Courier.create({ ...values, active: true });
    setBusy(null);
    if (gql?.length) {
      console.error("courier save failed", gql);
      return toast({ id: "courier", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
    }
    toast({ id: "courier", message: draft.id ? "حُفظت التعديلات." : `أُضيفت ${values.name}.` });
    setDraft(null);
    await load();
  }

  async function test(c: Courier | Draft) {
    const chatId = "telegramChatId" in c ? c.telegramChatId : c.chatId;
    const err = chatIdError(chatId);
    if (err) return toast({ id: "courier", tone: "attention", message: err });
    setBusy(`test:${"id" in c ? c.id : ""}`);
    const { data, error } = await callDispatch({ action: "test", chatId });
    setBusy(null);
    if (error) return toast({ id: "courier", tone: "attention", message: error });
    toast(
      data?.ok
        ? { id: "courier", message: "وصلت رسالة التجربة إلى القناة." }
        : { id: "courier", tone: "attention", message: String(data?.error ?? "لم تصل الرسالة.") },
    );
  }

  async function toggle(c: Courier) {
    setBusy(c.id);
    await dataClient.models.Courier.update({ id: c.id, active: c.active === false });
    setBusy(null);
    await load();
  }

  async function remove(c: Courier) {
    setBusy(c.id);
    const { errors: gql } = await dataClient.models.Courier.delete({ id: c.id });
    setBusy(null);
    setConfirmDelete(null);
    if (gql?.length) return toast({ id: "courier", tone: "attention", message: "تعذّر الحذف." });
    toast({ id: "courier", message: `حُذفت ${c.name}.` });
    await load();
  }

  const form = draft && (
    <form
      className="panel-form courier-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={errors.name ? "has-error" : undefined}>
        الاسم
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} placeholder="مثل: تيم الفهود" />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label className={errors.chatId ? "has-error" : undefined}>
        رقم قناة تيليغرام (أو @اسم القناة)
        <input
          value={draft.chatId}
          onChange={(e) => setDraft({ ...draft, chatId: e.target.value })}
          dir="ltr"
          maxLength={40}
          placeholder="-1001234567890"
        />
        {errors.chatId && <span className="field-error">{errors.chatId}</span>}
      </label>
      <label className={errors.phone ? "has-error" : undefined}>
        رقم واتساب المندوب (لدخوله إلى تطبيق المندوب)
        <input
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          dir="ltr"
          inputMode="tel"
          maxLength={20}
          placeholder="0771 234 5678"
        />
        {errors.phone && <span className="field-error">{errors.phone}</span>}
        <small className="hint">بهذا الرقم يسجّل دخوله على /courier برمز واتساب، ويشوف طلباته فقط. اتركه فارغاً إذا ما تريد.</small>
      </label>
      <label>
        ملاحظة (اختياري)
        <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={120} />
      </label>
      <div className="order-detail__actions">
        <button type="submit" className="btn btn--full" disabled={busy === "save"}>
          {busy === "save" ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <button type="button" className="btn btn--quiet btn--full" disabled={busy === "save"} onClick={() => void test(draft)}>
          إرسال رسالة تجربة إلى القناة
        </button>
        <button type="button" className="btn btn--quiet btn--full" onClick={() => setDraft(null)}>
          إلغاء
        </button>
      </div>
    </form>
  );

  return (
    <div className="couriers">
      <section className="order-detail__block">
        <h2>كيف أربط قناة؟</h2>
        <ol className="couriers__steps">
          <li>
            أضف بوت ÉLUE إلى قناة أو مجموعة شركة التوصيل كمشرف يقدر ينشر
            {bot ? (
              <>
                : <strong dir="ltr">@{bot}</strong>
              </>
            ) : null}
            .
          </li>
          <li>انسخ رقم القناة (يبدأ بـ -100) أو اسمها العام مثل <span dir="ltr">@my_channel</span>، والصقه هنا.</li>
          <li>اضغط «إرسال رسالة تجربة»: إذا وصلت الرسالة فالقناة جاهزة.</li>
        </ol>
      </section>

      {form ? (
        <section className="order-detail__block">
          <h2>{draft?.id ? "تعديل شركة التوصيل" : "شركة توصيل جديدة"}</h2>
          {form}
        </section>
      ) : (
        <button type="button" className="btn btn--full" onClick={() => (setErrors({}), setDraft(EMPTY))}>
          + شركة توصيل محلية جديدة
        </button>
      )}

      {list === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {list && list.length === 0 && !draft && <p className="hint">لم تضف أي شركة توصيل محلية بعد. مدن Express موجودة دائماً.</p>}
      <ul className="couriers__list">
        {(list ?? []).map((c) => (
          <li key={c.id} className={c.active === false ? "is-off" : undefined}>
            <div>
              <strong>{c.name}</strong>
              {c.active === false && <small> · موقوفة</small>}
              <span dir="ltr">{c.telegramChatId}</span>
              {c.phone && <small dir="ltr">{formatIraqiMobile(c.phone)} · يدخل تطبيق المندوب</small>}
              {c.note && <small>{c.note}</small>}
            </div>
            <div className="couriers__actions">
              <button
                type="button"
                className="btn btn--quiet btn--small"
                disabled={busy !== null}
                onClick={() => (setErrors({}), setDraft({ id: c.id, name: c.name, chatId: c.telegramChatId, phone: c.phone ?? "", note: c.note ?? "" }))}
              >
                تعديل
              </button>
              <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void test(c)}>
                تجربة
              </button>
              {c.phone && (
                <a
                  className="btn btn--quiet btn--small"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={chatUrl(
                    c.phone,
                    `مرحباً ${c.name}، هذا تطبيق مندوب ÉLUE لاستلام الطلبات ومسح الملصق وتحديث الحالة:\n${window.location.origin}/courier\nسجّل الدخول بهذا الرقم، يصلك رمز على واتساب.`,
                  )}
                >
                  إرسال الرابط
                </a>
              )}
              <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void toggle(c)}>
                {c.active === false ? "تفعيل" : "إيقاف"}
              </button>
              {confirmDelete === c.id ? (
                <button type="button" className="btn btn--small is-confirm" disabled={busy !== null} onClick={() => void remove(c)}>
                  تأكيد الحذف
                </button>
              ) : (
                <button type="button" className="link-button" onClick={() => setConfirmDelete(c.id)}>
                  حذف
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

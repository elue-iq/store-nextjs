"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { DELIVERY_PROVINCES, PROVINCES } from "@/lib/iraq";
import {
  addressError,
  areaError,
  nameError,
  provinceError,
  type DeliveryInfo,
  type Field,
  type FieldErrors,
} from "@/lib/validate";

type DeliveryField = Exclude<Field, "phone">;
const ORDER: DeliveryField[] = ["name", "province", "area", "address"];
const CHECKS: Record<DeliveryField, (v: string) => string | null> = {
  name: nameError,
  province: provinceError,
  area: areaError,
  address: addressError,
};

export type DeliveryFieldsHandle = { focusFirstError: (errors: FieldErrors) => void };

// Name, governorate, area and address. Used on "معلوماتي" and at checkout.
export function DeliveryFields({
  values,
  errors,
  onChange,
  onErrors,
  idPrefix,
  ref,
}: {
  values: DeliveryInfo;
  errors: FieldErrors;
  onChange: (next: DeliveryInfo) => void;
  onErrors: (next: FieldErrors) => void;
  idPrefix: string;
  ref?: Ref<DeliveryFieldsHandle>;
}) {
  const inputs = {
    name: useRef<HTMLInputElement>(null),
    province: useRef<HTMLSelectElement>(null),
    area: useRef<HTMLInputElement>(null),
    address: useRef<HTMLTextAreaElement>(null),
  };

  useImperativeHandle(ref, () => ({
    focusFirstError: (found) => {
      const first = ORDER.find((f) => found[f]);
      if (first) inputs[first].current?.focus();
    },
  }));

  // Re-check a field as it's edited (only once it has shown an error),
  // and on leaving it (once it has something in it).
  function recheck(field: DeliveryField, value: string, always: boolean) {
    if (!always && !errors[field]) return;
    const message = CHECKS[field](value);
    const next = { ...errors };
    if (message) next[field] = message;
    else delete next[field];
    onErrors(next);
  }

  function set(field: DeliveryField, value: string) {
    onChange({ ...values, [field]: value });
    recheck(field, value, field === "province");
  }

  const a11y = (field: DeliveryField) => ({
    id: `${idPrefix}-${field}`,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${idPrefix}-${field}-error` : undefined,
    onBlur: () => recheck(field, values[field], values[field].trim().length > 0),
  });

  const error = (field: DeliveryField) =>
    errors[field] ? (
      <span className="field-error" id={`${idPrefix}-${field}-error`}>
        {errors[field]}
      </span>
    ) : null;

  const outsideDelivery = values.province && !DELIVERY_PROVINCES.includes(values.province);

  return (
    <>
      <label className={errors.name ? "has-error" : undefined}>
        الاسم الكامل
        <input
          ref={inputs.name}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          autoComplete="name"
          maxLength={80}
          placeholder="الاسم الأول واسم الأب أو العائلة"
          {...a11y("name")}
        />
        {error("name")}
      </label>

      <div className="field-row">
        <label className={errors.province ? "has-error" : undefined}>
          المحافظة
          <select
            ref={inputs.province}
            value={values.province}
            onChange={(e) => set("province", e.target.value)}
            autoComplete="address-level1"
            {...a11y("province")}
          >
            <option value="" disabled>
              اختاروا المحافظة
            </option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {error("province")}
        </label>

        <label className={errors.area ? "has-error" : undefined}>
          المنطقة أو الحي
          <input
            ref={inputs.area}
            value={values.area}
            onChange={(e) => set("area", e.target.value)}
            autoComplete="address-level2"
            maxLength={80}
            placeholder="مثل: المنصور"
            {...a11y("area")}
          />
          {error("area")}
        </label>
      </div>

      {outsideDelivery && (
        <p className="field-note" role="note">
          التوصيل متاح حاليًا داخل بغداد فقط. يمكنكم إرسال الطلب، وسنتواصل معكم بشأن التوصيل إلى محافظتكم.
        </p>
      )}

      <label className={errors.address ? "has-error" : undefined}>
        تفاصيل العنوان وأقرب نقطة دالة
        <textarea
          ref={inputs.address}
          value={values.address}
          onChange={(e) => set("address", e.target.value)}
          autoComplete="street-address"
          rows={3}
          maxLength={400}
          placeholder="الشارع، رقم الدار أو العمارة، وأقرب نقطة دالة"
          {...a11y("address")}
        />
        {error("address")}
      </label>
    </>
  );
}

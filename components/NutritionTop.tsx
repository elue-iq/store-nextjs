"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBack } from "./LinkIcons";

// The top of the nutrition pages: the ÉLUE wordmark (to the shop), and on a flavor a way
// back to the list. Coming from the list, «كل النكهات» goes back in history, so the phone's
// own back button and this one lead to the same place.
const FROM_LIST = "elue-nf-from-list";

export function markFromList() {
  try {
    sessionStorage.setItem(FROM_LIST, "1");
  } catch {}
}

export function NutritionTop({ back }: { back?: boolean }) {
  const router = useRouter();
  return (
    <div className="nf-top">
      {back ? (
        <Link
          href="/nutrition"
          className="nf-top__back"
          onClick={(e) => {
            let fromList = false;
            try {
              fromList = sessionStorage.getItem(FROM_LIST) === "1";
              sessionStorage.removeItem(FROM_LIST);
            } catch {}
            if (fromList && window.history.length > 1) {
              e.preventDefault();
              router.back();
            }
          }}
        >
          <IconBack />
          كل النكهات
        </Link>
      ) : (
        <span />
      )}
      <Link href="/" className="nf-top__brand" aria-label="ÉLUE — الصفحة الرئيسية" dir="ltr">
        ÉLUE
      </Link>
    </div>
  );
}

// A flavor card on the list: remembers it came from the list (see NutritionTop).
export function FlavorCardLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={className} onClick={markFromList}>
      {children}
    </Link>
  );
}

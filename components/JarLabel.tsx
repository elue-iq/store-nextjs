import Image from "next/image";
import type { Product } from "@/lib/products";
import { Logo } from "./Logo";

// Product visual.
// With a photo: just the photo, clean.
// Without a photo: a drawn version of the printed jar label, so the site never shows an empty box.

export function JarLabel({
  product,
  size = "card",
  preload = false,
}: {
  product: Product;
  size?: "card" | "large";
  preload?: boolean;
}) {
  const band = (
    <div className="jar-label__band" dir="ltr">
      <span className="jar-label__kcal">
        <strong>{product.kcalPerPiece} kcal</strong> <span>average piece</span>
      </span>
      <span className="jar-label__sugar">No added sugar</span>
    </div>
  );

  if (product.image) {
    return (
      <div
        className={`jar-photo jar-photo--${size}`}
        style={{ "--band": product.band } as React.CSSProperties}
      >
        <div className="jar-photo__frame">
          <Image
            src={product.image}
            alt={`ÉLUE ${product.nameEn} truffles jar`}
            fill
            sizes={size === "large" ? "(max-width: 900px) 100vw, 50vw" : "(max-width: 900px) 50vw, 25vw"}
            className="jar-photo__img"
            preload={preload}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`jar-label jar-label--${size}`} style={{ "--band": product.band } as React.CSSProperties}>
      <div className="jar-label__panel">
        <div className="jar-label__print" dir="ltr" aria-hidden="true">
          <Logo className="jar-label__logo" />
          <span className="jar-label__line">Chocolate truffles</span>
          <span className="jar-label__flavor">{product.nameEn}</span>
        </div>
      </div>
      {band}
    </div>
  );
}

import Image from "next/image";
import type { Product } from "@/lib/products";
import { Logo } from "./Logo";

// A product visual built like the printed jar label: a coloured band around
// a cream panel, with the wordmark, flavor and kcal. When a photo is set
// for the product, the photo fills the panel instead of the label text.

export function JarLabel({ product, size = "card", priority = false }: { product: Product; size?: "card" | "large"; priority?: boolean }) {
  return (
    <div className={`jar-label jar-label--${size}`} style={{ "--band": product.band } as React.CSSProperties}>
      <div className="jar-label__panel">
        {product.image ? (
          <Image
            src={product.image}
            alt={`ÉLUE ${product.nameEn} truffles`}
            fill
            sizes={size === "large" ? "(max-width: 860px) 100vw, 50vw" : "(max-width: 640px) 50vw, 25vw"}
            className="jar-label__photo"
            priority={priority}
          />
        ) : (
          <div className="jar-label__print" dir="ltr" aria-hidden="true">
            <Logo className="jar-label__logo" />
            <span className="jar-label__line">Chocolate truffles</span>
            <span className="jar-label__flavor">{product.nameEn}</span>
          </div>
        )}
      </div>
      <div className="jar-label__band" dir="ltr">
        <span className="jar-label__kcal">
          <strong>{product.kcalPerPiece} kcal</strong> <span>average piece</span>
        </span>
        <span className="jar-label__sugar">No added sugar</span>
      </div>
    </div>
  );
}

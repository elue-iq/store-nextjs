import { site } from "@/lib/site";

// Always at the top of the site: the product must stay cold (one short line;
// the full note is shown at checkout and on each order).
export function ColdBanner() {
  const { coldNote } = site;
  return (
    <aside className="cold-banner" aria-label={coldNote.title}>
      <div className="cold-banner__inner">
        <strong className="cold-banner__title">{coldNote.banner}</strong>
      </div>
    </aside>
  );
}

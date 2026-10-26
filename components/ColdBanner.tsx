import { site } from "@/lib/site";

// Always at the top of the site: the product must stay cold.
export function ColdBanner() {
  const { coldNote } = site;
  return (
    <aside className="cold-banner" aria-label={coldNote.title}>
      <div className="cold-banner__inner">
        <strong className="cold-banner__title">{coldNote.title}</strong>
        <p>{coldNote.text}</p>
        <p>
          {coldNote.problem}{" "}
          <a href={`tel:+${site.whatsappNumber}`} dir="ltr" className="cold-banner__phone">
            {site.whatsappDisplay}
          </a>
        </p>
      </div>
    </aside>
  );
}

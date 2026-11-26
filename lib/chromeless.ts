// Pages that are their own screen, without the shop's header, banners and footer:
// the courier app, and the links page with the nutrition pages (the jar's QR leads there).
export const isCourierPath = (p: string) => p === "/courier" || p.startsWith("/courier/");
export const isLinksPath = (p: string) => p === "/links" || p === "/nutrition" || p.startsWith("/nutrition/");
export const isChromeless = (p: string) => isCourierPath(p) || isLinksPath(p);

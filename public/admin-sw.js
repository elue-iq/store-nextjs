// Service worker for the ÉLUE admin app (scope: /admin).
// It makes the orders page installable and shows a clear message when the
// phone is offline. Orders themselves always come live from the server.

const OFFLINE_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>لا يوجد اتصال</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5EFE6;color:#3B2A23;
font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center;padding:24px}
h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#6E584C;margin:0 0 1.5rem}
button{font:inherit;padding:.8rem 1.6rem;border-radius:999px;border:0;background:#9A513C;color:#F5EFE6}</style>
</head><body><div><h1>لا يوجد اتصال بالإنترنت</h1><p>تحتاج لوحة الطلبات إلى الإنترنت لعرض الطلبات المباشرة.</p>
<button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return; // data and assets go straight to the network
  event.respondWith(
    fetch(req).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});

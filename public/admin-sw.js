// Service worker for the ÉLUE admin app (scope: /admin).
// It makes the orders page installable, shows a clear message when the phone is
// offline, and shows the team's new-order notifications (web push, lib/push.ts).
// Orders themselves always come live from the server.

const OFFLINE_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>لا يوجد اتصال</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5EFE6;color:#3B2A23;
font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center;padding:24px}
h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#6E584C;margin:0 0 1.5rem}
button{font:inherit;padding:.8rem 1.6rem;border-radius:999px;border:0;background:#A45A44;color:#F5EFE6}</style>
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

// A new-order notification: { title, body, url, tag } from place-order.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "طلب جديد", {
      body: msg.body || "",
      icon: "/admin-app/icon-192.png",
      tag: msg.tag || undefined,
      renotify: Boolean(msg.tag),
      lang: "ar",
      dir: "rtl",
      data: { url: msg.url || "/admin" },
    }),
  );
});

// Tapping it opens that order in the admin app (the open window if there is one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/admin", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.location.origin + "/admin"));
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

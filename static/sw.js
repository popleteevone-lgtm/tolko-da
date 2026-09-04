/* Service worker: принимает web push и показывает системное уведомление */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = { title: "Только Да", body: "Новый ответ", url: "/" };
  try { d = Object.assign(d, e.data.json()); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/static/icon.svg", badge: "/static/icon.svg", data: { url: d.url }, tag: "tolko-da", renotify: true }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.includes(url.split("?")[0]) && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

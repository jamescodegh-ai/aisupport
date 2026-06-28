// Service Worker — handles push notifications for agent dashboard
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "AI Support", body: event.data.text() }; }

  const options = {
    body: payload.body || "",
    icon: "/logo192.png",
    badge: "/logo192.png",
    tag: payload.data?.conversation_id || "aisupport",
    renotify: true,
    requireInteraction: payload.type === "escalation",
    data: payload.data || {},
    actions: [{ action: "open", title: "Open Dashboard" }],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(payload.title || "AI Support", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = event.notification.data?.conversation_id;
  const url = convId ? `/dashboard?conv=${convId}` : "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/dashboard") && "focus" in client) {
          client.postMessage({ type: "OPEN_CONVERSATION", conversation_id: convId });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

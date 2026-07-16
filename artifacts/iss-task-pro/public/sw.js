/* Service worker for background push notifications (Management Task Pro). */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "Management Task Pro", body: "You have a new notification.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "favicon.svg",
      badge: "favicon.svg",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Focus an existing app tab if one is open; otherwise open a new one at the
  // app's own base path (the SW scope), so path-prefixed deployments work too.
  const target = new URL(self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.url.startsWith(target) && "focus" in tab) return tab.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

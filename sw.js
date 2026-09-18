// sw.js — runs in the background, independent of any open tab.
// Handles incoming push messages and notification clicks.

self.addEventListener("push", event => {
  let payload = { title: "Task Log", body: "You have a task update." };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) {
    // Fall back to default payload above if the push body isn't JSON.
  }

  const options = {
    body: payload.body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: payload.url || "./" },
    tag: payload.tag || "task-log-notification"
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "./";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

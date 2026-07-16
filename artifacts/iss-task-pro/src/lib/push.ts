import { getVapidPublicKey, subscribePush, unsubscribePush } from "@workspace/api-client-react";

/**
 * Background web-push subscription management. Complements the in-page
 * desktop popups: once subscribed, the browser shows notifications even
 * when the app tab is closed (as long as the browser itself is running).
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // BASE_URL always ends with a slash; the SW must live at the app's own path
  // so its scope covers the whole app (works for path-prefixed deployments).
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  const reg = await navigator.serviceWorker.register(swUrl);
  await navigator.serviceWorker.ready;
  return reg;
}

/** Subscribe this browser to web push and register it on the server. */
export async function enableBackgroundPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await getVapidPublicKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch (err) {
    console.warn("Background push setup failed:", err);
    return false;
  }
}

/** Unsubscribe this browser and remove it from the server. */
export async function disableBackgroundPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await unsubscribePush({ endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch (err) {
    console.warn("Background push teardown failed:", err);
  }
}

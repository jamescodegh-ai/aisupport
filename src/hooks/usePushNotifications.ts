/**
 * usePushNotifications — registers service worker + VAPID push subscription
 * Call once in the dashboard after agent is authenticated.
 */
import { useEffect, useRef, useState } from "react";

export type NotifPermission = "default" | "granted" | "denied";

export function usePushNotifications(authToken: string | null) {
  const [permission, setPermission] = useState<NotifPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const registered = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPermission(Notification.permission as NotifPermission);
  }, []);

  async function subscribe() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("[Push] Not supported in this browser");
      return;
    }

    // Request permission
    const perm = await Notification.requestPermission();
    setPermission(perm as NotifPermission);
    if (perm !== "granted") return;

    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // Get VAPID public key from server
      const keyRes = await fetch("/api/push");
      const { vapidPublicKey } = await keyRes.json();
      if (!vapidPublicKey) {
        console.warn("[Push] VAPID_PUBLIC_KEY not set on server — skipping subscription");
        return;
      }

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array( vapidPublicKey) as unknown as string,
      });

      // Send subscription to server
      await fetch("/api/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }),
      });

      setSubscribed(true);
      registered.current = true;
      console.log("[Push] Subscribed successfully");
    } catch (e) {
      console.error("[Push] Subscribe failed:", e);
    }
  }

  // Listen for messages from SW (notification click → open conversation)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "OPEN_CONVERSATION") {
        // Dispatch a custom event that dashboard.tsx can listen to
        window.dispatchEvent(new CustomEvent("push:open_conversation", {
          detail: { conversation_id: event.data.conversation_id },
        }));
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  return { permission, subscribed, subscribe };
}

// Helper: convert VAPID base64 key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

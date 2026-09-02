"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/actions/auth";

export function PushAwareLogout() {
  const [pushEndpoint, setPushEndpoint] = useState("");

  useEffect(() => {
    let cancelled = false;
    void navigator.serviceWorker?.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (!cancelled && subscription) setPushEndpoint(subscription.endpoint);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return (
    <form action={logoutAction}>
      <input type="hidden" name="push_endpoint" value={pushEndpoint} />
      <button type="submit" className="button button--ghost button--wide logout-button"><LogOut aria-hidden="true" /> Log ud</button>
    </form>
  );
}

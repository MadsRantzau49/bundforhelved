"use client";

import { Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import { useConnectionStatus } from "@/lib/connection-status";

export function ConnectionStatus() {
  const online = useConnectionStatus();
  return (
    <span
      className={clsx("online-pill", !online && "is-offline")}
      title={online ? "Forbindelsen til appen virker" : "Appen kan ikke nå serveren"}
      role="status"
    >
      {online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      {online ? "Live" : "Offline"}
    </span>
  );
}

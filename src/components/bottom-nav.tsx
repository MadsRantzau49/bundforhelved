"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, ScanSearch, TimerReset, Trophy } from "lucide-react";
import clsx from "clsx";
import { useConnectionStatus } from "@/lib/connection-status";

const links = [
  { href: "/timer", label: "Tag tid", icon: TimerReset },
  { href: "/rangliste", label: "Resultater", icon: Trophy },
  { href: "/peer-review", label: "Godkend tider", icon: ScanSearch },
  { href: "/profil", label: "Stats", icon: CircleUserRound },
];

export function BottomNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  const online = useConnectionStatus();

  return (
    <nav className="bottom-nav" aria-label="Hovednavigation">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            href={href}
            key={href}
            className={clsx("bottom-nav__item", active && "is-active")}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (online) return;
              event.preventDefault();
              window.location.assign(new URL("/offline-static.html", window.location.origin).toString());
            }}
          >
            <span className="bottom-nav__icon">
              <Icon aria-hidden="true" />
              {href === "/peer-review" && reviewCount > 0 && (
                <span className="bottom-nav__badge" aria-label={`${reviewCount} tider venter på godkendelse`}>
                  {reviewCount > 9 ? "9+" : reviewCount}
                </span>
              )}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

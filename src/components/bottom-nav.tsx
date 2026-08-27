"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, CircleUserRound, Handshake, TimerReset, Trophy, UsersRound } from "lucide-react";
import clsx from "clsx";
import { useConnectionStatus } from "@/lib/connection-status";

const links = [
  { href: "/timer", label: "Timer", icon: TimerReset },
  { href: "/rangliste", label: "Toppen", icon: Trophy },
  { href: "/klaner", label: "Klaner", icon: UsersRound },
  { href: "/venner", label: "Venner", icon: Handshake },
  { href: "/guide", label: "Guide", icon: BookOpenText },
  { href: "/profil", label: "Mig", icon: CircleUserRound },
];

export function BottomNav() {
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
            <span className="bottom-nav__icon"><Icon aria-hidden="true" /></span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

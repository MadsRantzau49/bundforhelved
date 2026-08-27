import { UsersRound } from "lucide-react";
import { clanImageUrl } from "@/lib/format";

export function ClanImage({ name, path, className }: { name: string; path: string | null; className?: string }) {
  const url = clanImageUrl(path);
  return (
    <span
      className={className}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
      role="img"
      aria-label={`${name} profilbillede`}
    >
      {!url && <UsersRound aria-hidden="true" />}
    </span>
  );
}

import clsx from "clsx";
import { avatarUrl, initials } from "@/lib/format";

export function Avatar({
  username,
  path,
  size = "medium",
  rank,
}: {
  username: string;
  path: string | null;
  size?: "small" | "medium" | "large" | "hero";
  rank?: number;
}) {
  const url = avatarUrl(path);

  return (
    <span
      className={clsx("avatar", `avatar--${size}`, rank && `avatar--rank-${rank}`)}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
      role="img"
      aria-label={`Profilbillede for ${username}`}
    >
      {!url && <span>{initials(username)}</span>}
    </span>
  );
}

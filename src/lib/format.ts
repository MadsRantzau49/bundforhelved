export function formatTime(milliseconds: number) {
  const safeValue = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeValue / 60_000);
  const seconds = Math.floor((safeValue % 60_000) / 1_000);
  const hundredths = Math.floor((safeValue % 1_000) / 10);

  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths
      .toString()
      .padStart(2, "0")}`;
  }

  return `${seconds}.${hundredths.toString().padStart(2, "0")}`;
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(date));
}

export function initials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

export function avatarUrl(path: string | null) {
  if (!path) return null;
  return `/api/avatars/${path.split("/").map(encodeURIComponent).join("/")}`;
}

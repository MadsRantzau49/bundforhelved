const achievementMediaPattern = /^[a-z0-9][a-z0-9-]{0,79}\/image-\d{10,17}\.(?:jpe?g|png|webp|gif)$/i;

export function achievementMediaUrl(path: string | null) {
  if (!path || !achievementMediaPattern.test(path)) return null;
  return `/api/achievement-media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

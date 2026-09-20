const rankMediaPattern = /^[0-9a-f-]{36}\/image-\d{10,17}\.(?:jpe?g|png|webp|gif)$/i;

export function rankMediaUrl(path: string | null) {
  if (!path || !rankMediaPattern.test(path)) return null;
  return `/api/rank-media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

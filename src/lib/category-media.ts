const categoryMediaPattern = /^[0-9a-f-]{36}\/(?:image|guide|demo)-\d{10,17}\.(?:jpe?g|png|webp|gif|mp4|webm|mov|qt)$/i;

export function categoryMediaUrl(path: string | null) {
  if (!path || !categoryMediaPattern.test(path)) return null;
  return `/api/category-media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

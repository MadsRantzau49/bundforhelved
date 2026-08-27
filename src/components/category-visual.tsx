import clsx from "clsx";
import { CategoryIcon } from "@/components/category-icon";
import { categoryMediaUrl } from "@/lib/category-media";

export function CategoryVisual({
  iconKey,
  imagePath,
  name,
  className,
}: {
  iconKey: string;
  imagePath: string | null;
  name: string;
  className?: string;
}) {
  const url = categoryMediaUrl(imagePath);
  if (!url) return <CategoryIcon iconKey={iconKey} className={className} />;

  return (
    <span
      className={clsx("category-visual", className)}
      style={{ backgroundImage: `url("${url}")` }}
      role="img"
      aria-label={`Billede af ${name}`}
    />
  );
}

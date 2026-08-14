import { Beer, CupSoda, GlassWater, Package, Wine } from "lucide-react";
import clsx from "clsx";

export function CategoryIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const props = { "aria-hidden": true, strokeWidth: 1.8 } as const;
  const icon = {
    bottle: <Wine {...props} />,
    can: <Package {...props} />,
    cup: <Beer {...props} />,
    glass: <GlassWater {...props} />,
    pint: <Beer {...props} />,
    soda: <CupSoda {...props} />,
  }[iconKey] ?? <Beer {...props} />;

  return <span className={clsx("category-icon", className)}>{icon}</span>;
}

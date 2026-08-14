import Link from "next/link";
import clsx from "clsx";

export function Brand({ compact = false, link = true }: { compact?: boolean; link?: boolean }) {
  const content = (
    <span className={clsx("brand", compact && "brand--compact")} aria-label="bund forhelved">
      <span className="brand__glass" aria-hidden="true">
        <span className="brand__foam" />
        <span className="brand__beer" />
      </span>
      <span className="brand__words">
        <strong>bund</strong>
        <span>forhelved</span>
      </span>
    </span>
  );

  return link ? <Link href="/timer">{content}</Link> : content;
}

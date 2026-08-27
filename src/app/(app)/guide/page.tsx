import type { Metadata } from "next";
import { BookOpenText, Film, PlayCircle } from "lucide-react";
import { CategoryVisual } from "@/components/category-visual";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { categoryMediaUrl } from "@/lib/category-media";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category } from "@/types/app";

export const metadata: Metadata = { title: "Guide" };

export default async function GuidePage() {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (error) throw new Error("Guiden kunne ikke hentes.");
  const categories = (data ?? []) as Category[];

  return (
    <div className="page page--guide">
      <PageHeader
        eyebrow="Teknik før tempo"
        title="Guide"
        description="Se reglerne og teknikken til hvert våben, før uret starter."
        action={<span className="header-trophy"><BookOpenText aria-hidden="true" /></span>}
      />
      <div className="guide-grid">
        {categories.map((category) => {
          const guideVideo = categoryMediaUrl(category.guide_video_path);
          const demoVideo = categoryMediaUrl(category.demo_video_path);
          return (
            <article
              className="guide-card"
              key={category.id}
              style={{ "--category-color": category.accent_color } as React.CSSProperties}
            >
              <header className="guide-card__header">
                <CategoryVisual iconKey={category.icon_key} imagePath={category.image_path} name={category.name} />
                <div><p className="eyebrow">Våben</p><h2>{category.name}</h2><span>{category.description || "Ingen kort beskrivelse endnu."}</span></div>
              </header>
              <div className="guide-card__instructions">
                <strong><BookOpenText aria-hidden="true" /> Sådan gør du</strong>
                <p>{category.guide_text || "Der er endnu ikke tilføjet en detaljeret guide til denne kategori."}</p>
              </div>
              {(guideVideo || demoVideo) ? (
                <div className="guide-card__videos">
                  {guideVideo && <div><strong><PlayCircle aria-hidden="true" /> Instruktion</strong><video src={guideVideo} controls playsInline preload="metadata" /></div>}
                  {demoVideo && <div><strong><Film aria-hidden="true" /> Demonstration</strong><video src={demoVideo} controls playsInline preload="metadata" /></div>}
                </div>
              ) : <p className="guide-card__empty"><Film aria-hidden="true" /> Ingen videoer endnu.</p>}
            </article>
          );
        })}
        {!categories.length && <div className="inline-empty">Der er ingen aktive kategorier at vise.</div>}
      </div>
    </div>
  );
}

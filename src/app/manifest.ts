import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "bund forhelved",
    short_name: "bund",
    description: "Sæt tiden. Bund øllen. Tag toppen.",
    id: "/",
    start_url: "/timer",
    scope: "/",
    display: "standalone",
    background_color: "#17110d",
    theme_color: "#17110d",
    orientation: "portrait",
    lang: "da",
    categories: ["sports", "social"],
    shortcuts: [
      {
        name: "Start timer",
        short_name: "Timer",
        description: "Vælg spiller og start en ny tid.",
        url: "/timer",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Se toppen",
        short_name: "Toppen",
        description: "Åbn de globale og private ranglister.",
        url: "/rangliste",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

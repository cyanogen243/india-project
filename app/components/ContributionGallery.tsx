"use client";

import { useState } from "react";
import Image from "next/image";
import type { Language } from "@/app/lib/content";
import type { PublicContribution } from "@/app/lib/database";

// Writing tiles are coloured from the palette rather than at random, so a poem
// keeps the same tile every visit.
const TILE_COLOURS = ["#e21f26", "#0d47a1", "#3b1361", "#176845", "#8a5b00"];

function tileColour(id: string) {
  let total = 0;
  for (const character of id) total += character.charCodeAt(0);
  return TILE_COLOURS[total % TILE_COLOURS.length];
}

function excerpt(body: string) {
  const trimmed = body.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed;
}

export function ContributionGallery({
  items,
  language,
}: {
  items: PublicContribution[];
  language: Language;
}) {
  const hindi = language === "hi";
  const [filter, setFilter] = useState<"all" | "image" | "writing">("all");
  const visible = items.filter((item) => filter === "all" || item.kind === filter);

  const filters = [
    ["all", hindi ? "सब" : "All"],
    ["image", hindi ? "पोस्टर" : "Posters"],
    ["writing", hindi ? "लेखन" : "Writing"],
  ] as const;

  const shareText = hindi ? "द इंडिया प्रोजेक्ट से" : "From The India Project";

  return (
    <>
      <div className="gallery-filters" role="group" aria-label={hindi ? "छाँटें" : "Filter"}>
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`gallery-filter ${filter === value ? "active" : ""}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="gallery-empty">
          {hindi
            ? "अभी यहाँ कुछ नहीं है। पहला योगदान आपका हो सकता है।"
            : "Nothing here yet. The first contribution could be yours."}
        </p>
      ) : (
        <div className="gallery-grid">
          {visible.map((item) => {
            const fileUrl = `/api/contributions/${item.id}/file`;
            const pageUrl =
              typeof window === "undefined"
                ? ""
                : `${window.location.origin}${hindi ? "/hi/kit" : "/kit"}`;
            return (
              <article key={item.id} className="gallery-card">
                {item.kind === "image" ? (
                  <Image
                    src={`${fileUrl}?variant=social`}
                    alt={item.title}
                    width={item.width ?? 800}
                    height={item.height ?? 1000}
                    unoptimized
                  />
                ) : (
                  <div className="gallery-writing" style={{ background: tileColour(item.id) }}>
                    <h3>{item.title}</h3>
                    <p>{excerpt(item.body)}</p>
                  </div>
                )}

                <div className="gallery-meta">
                  {item.kind === "image" && <h3>{item.title}</h3>}
                  <small>
                    {item.credit || (hindi ? "गुमनाम" : "Anonymous")}
                    {item.kind === "image" && item.width && item.height
                      ? ` · ${item.width}×${item.height}`
                      : ""}
                  </small>
                  <small>CC BY-NC-SA 4.0</small>
                </div>

                <div className="gallery-actions">
                  {item.kind === "image" && (
                    <>
                      <a className="button" href={`${fileUrl}?download=1`} download>
                        {hindi ? "प्रिंट" : "Print size"}
                      </a>
                      <a className="button" href={`${fileUrl}?variant=social&download=1`} download>
                        {hindi ? "सोशल" : "Social size"}
                      </a>
                    </>
                  )}
                  {/* Plain intent links, so no third-party share widget or
                      tracker is loaded into the page. */}
                  <a
                    className="button"
                    href={`https://wa.me/?text=${encodeURIComponent(`${item.title} — ${shareText} ${pageUrl}`)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    WhatsApp
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

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
  return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
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

  return (
    <>
      <div className="gallery-toolbar">
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
        <p className="gallery-licence">
          {hindi
            ? "सब कुछ मुफ़्त है · ग़ैर-व्यावसायिक उपयोग · CC BY-NC-SA 4.0"
            : "Everything is free · non-commercial use · CC BY-NC-SA 4.0"}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="gallery-empty">
          {hindi
            ? "अभी यहाँ कुछ नहीं है। पहला योगदान आपका हो सकता है।"
            : "Nothing here yet. The first contribution could be yours."}
        </p>
      ) : (
        <div className="gallery-wall">
          {visible.map((item) => {
            const fileUrl = `/api/contributions/${item.id}/file`;
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
                <div className="gallery-caption">
                  <div>
                    {item.kind === "image" && <strong>{item.title}</strong>}
                    <small>{item.credit || (hindi ? "गुमनाम" : "Anonymous")}</small>
                  </div>
                  {item.kind === "image" && (
                    <div className="gallery-downloads">
                      <a href={`${fileUrl}?download=1`} download>
                        {hindi ? "प्रिंट" : "Print"}
                      </a>
                      <a href={`${fileUrl}?variant=social&download=1`} download>
                        {hindi ? "सोशल" : "Social"}
                      </a>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

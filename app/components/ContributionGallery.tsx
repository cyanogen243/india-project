"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Language } from "@/app/lib/content";
import type { PublicContribution } from "@/app/lib/database";

// A poem at or under this length is shown whole; longer poems cut here and
// hand off to their read page. Mirrors POEM_TILE_LIMIT server-side.
const POEM_TILE_LIMIT = 600;

// A character count over-measures Devanagari, where one visible letter can be
// several code units, so the line count is what actually decides: anything
// over POEM_TILE_LINES shows its first POEM_TEASER_LINES, a clean break for
// couplet forms. The character limit only catches prose-shaped poems.
const POEM_TILE_LINES = 12;
const POEM_TEASER_LINES = 8;

// Essay tiles open with the first words of the piece, per the approved mockup.
// Paragraph breaks collapse to an em dash so a salutation reads inline
// ("DEAR COMRADES — Our movement is passing…"); the CSS line clamp trims the
// rest, so this only bounds how much text the clamp works with.
const ESSAY_TEASER_LIMIT = 240;

// Cutting by code unit can orphan a combining mark or split a surrogate pair,
// which renders as a broken glyph. Segmenting first cuts on real characters.
function cutGraphemes(value: string, limit: number) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out: string[] = [];
  for (const { segment } of segmenter.segment(value)) {
    if (out.length >= limit) break;
    out.push(segment);
  }
  return out.join("");
}

function essayTeaser(body: string) {
  return cutGraphemes(body, ESSAY_TEASER_LIMIT * 2)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" — ");
}

// Writing tiles are coloured from the palette rather than at random, so a poem
// keeps the same tile every visit.
const TILE_COLOURS = ["#e21f26", "#0d47a1", "#3b1361", "#176845", "#8a5b00"];

function tileColour(id: string) {
  let total = 0;
  for (const character of id) total += character.charCodeAt(0);
  return TILE_COLOURS[total % TILE_COLOURS.length];
}

const KIND_GLYPHS: Record<PublicContribution["kind"], React.ReactNode> = {
  poster: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="3" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="1.4" r="1.1" fill="currentColor" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1" y="3.5" width="10" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="7" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.2 3.5 5.1 1.9 h1.8 L7.8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  poem: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M11 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.6 6.4 C4.2 6.4 2.6 7.4 2 10 C4.6 9.4 5.6 7.8 5.6 6.4 Z" fill="currentColor" />
    </svg>
  ),
  essay: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="4.2" y="1" width="3.6" height="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.4" y="4.8" width="9.2" height="5" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.6 7.3 h4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

const KIND_LABELS: Record<PublicContribution["kind"], { en: string; hi: string }> = {
  poster: { en: "Poster", hi: "पोस्टर" },
  image: { en: "Image", hi: "चित्र" },
  poem: { en: "Poem", hi: "कविता" },
  essay: { en: "Essay", hi: "लेख" },
};

function KindTag({ kind, hindi }: { kind: PublicContribution["kind"]; hindi: boolean }) {
  return (
    <span className={`tag tag-${kind}`}>
      {KIND_GLYPHS[kind]}
      {KIND_LABELS[kind][hindi ? "hi" : "en"]}
    </span>
  );
}

function Licence({ item, hindi }: { item: PublicContribution; hindi: boolean }) {
  // Nobody can release someone else's work under CC, so a passed-on
  // public-domain piece says what it actually is.
  if (item.provenance === "public_domain") {
    return <>{hindi ? "सार्वजनिक डोमेन" : "Public domain"}</>;
  }
  return <>CC BY-NC-SA 4.0</>;
}

function Credit({ item, hindi }: { item: PublicContribution; hindi: boolean }) {
  if (item.creditAccount) {
    // Only https profile links become anchors; bare handles stay text so the
    // page never links to an attacker-chosen scheme.
    if (item.creditAccount.startsWith("https://")) {
      return (
        <a href={item.creditAccount} target="_blank" rel="noreferrer noopener">
          {item.creditAccount.replace(/^https:\/\/(www\.)?/, "")}
        </a>
      );
    }
    return <>{item.creditAccount}</>;
  }
  return <>{item.credit || (hindi ? "गुमनाम" : "Anonymous")}</>;
}

function wordCount(body: string) {
  return body.trim().split(/\s+/).length;
}

export function ContributionGallery({
  items,
  language,
}: {
  items: PublicContribution[];
  language: Language;
}) {
  const hindi = language === "hi";
  const [filter, setFilter] = useState<"all" | PublicContribution["kind"]>("all");
  const visible = items.filter((item) => filter === "all" || item.kind === filter);

  // Posters and images have no page of their own, so the full view and the
  // details that would otherwise clutter every tile — licence, source,
  // dimensions — live in a lightbox opened from the artwork.
  const [openItem, setOpenItem] = useState<PublicContribution | null>(null);
  const lightbox = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = lightbox.current;
    if (!dialog) return;
    if (openItem && !dialog.open) dialog.showModal();
    if (!openItem && dialog.open) dialog.close();
  }, [openItem]);

  const filters = [
    ["all", hindi ? "सब" : "All"],
    ["poster", hindi ? "पोस्टर" : "Posters"],
    ["image", hindi ? "चित्र" : "Images"],
    ["poem", hindi ? "कविताएँ" : "Poems"],
    ["essay", hindi ? "लेख" : "Essays"],
  ] as const;

  const readHref = (id: string) => (hindi ? `/hi/art/${id}` : `/art/${id}`);

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
            ? "सब कुछ मुफ़्त है · ग़ैर-व्यावसायिक उपयोग · हर काम की शर्तें उसके साथ"
            : "Everything is free · non-commercial use · terms shown on each work"}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="gallery-empty">
          {items.length === 0
            ? hindi
              ? "अभी यहाँ कुछ नहीं है। पहला योगदान आपका हो सकता है।"
              : "Nothing here yet. The first contribution could be yours."
            : hindi
              ? "इस श्रेणी में अभी कुछ नहीं है।"
              : "Nothing in this category yet."}
        </p>
      ) : (
        <div className="gallery-wall">
          {visible.map((item) => {
            const fileUrl = `/api/contributions/${item.id}/file`;
            const isFile = item.kind === "poster" || item.kind === "image";
            const poemLines = item.kind === "poem" ? item.body.split("\n") : [];
            const poemIsCut =
              item.kind === "poem" &&
              (item.body.length > POEM_TILE_LIMIT || poemLines.length > POEM_TILE_LINES);
            return (
              <article key={item.id} className="gallery-card" data-kind={item.kind}>
                {isFile && (
                  <button
                    type="button"
                    className="gallery-art"
                    onClick={() => setOpenItem(item)}
                    aria-label={
                      hindi ? `${item.title} — बड़ा करके देखें` : `${item.title} — view larger`
                    }
                  >
                    <Image
                      src={`${fileUrl}?variant=social`}
                      alt={item.title}
                      width={item.width ?? 800}
                      height={item.height ?? 1000}
                      unoptimized
                    />
                  </button>
                )}

                {item.kind === "poem" && (
                  <div className="gallery-tile" style={{ background: tileColour(item.id) }}>
                    <h3>{item.title}</h3>
                    {item.subtitle && <p className="tile-sub">{item.subtitle}</p>}
                    <p className={poemIsCut ? "tile-teaser" : undefined}>
                      {poemIsCut
                        ? cutGraphemes(
                            poemLines.slice(0, POEM_TEASER_LINES).join("\n"),
                            POEM_TILE_LIMIT,
                          )
                        : item.body}
                    </p>
                    {poemIsCut && (
                      <Link className="tile-more" href={readHref(item.id)}>
                        {hindi ? "पूरी कविता पढ़ें →" : "Read the full poem →"}
                      </Link>
                    )}
                  </div>
                )}

                {item.kind === "essay" && (
                  <div className="gallery-essay">
                    <h3>{item.title}</h3>
                    {item.subtitle && <p className="tile-sub">{item.subtitle}</p>}
                    <p className="tile-teaser">{essayTeaser(item.body)}</p>
                    <Link className="tile-more" href={readHref(item.id)}>
                      {hindi ? "पूरा लेख पढ़ें →" : "Read the full essay →"}
                    </Link>
                  </div>
                )}

                <div className="gallery-caption">
                  <div>
                    {isFile && <strong>{item.title}</strong>}
                    <span className="meta-row">
                      <KindTag kind={item.kind} hindi={hindi} />
                      <small>
                        <Credit item={item} hindi={hindi} />
                        {isFile && item.width && item.height
                          ? ` · ${item.width}×${item.height}`
                          : ""}
                        {item.kind === "essay"
                          ? ` · ${wordCount(item.body).toLocaleString()} ${hindi ? "शब्द" : "words"}`
                          : ""}
                      </small>
                    </span>
                  </div>
                  {isFile && (
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

      <dialog
        ref={lightbox}
        className="art-lightbox"
        onClose={() => setOpenItem(null)}
        onClick={(event) => {
          if (event.target === lightbox.current) lightbox.current?.close();
        }}
      >
        {openItem && (
          <div className="art-lightbox-panel">
            <button
              type="button"
              className="art-lightbox-close"
              onClick={() => lightbox.current?.close()}
              aria-label={hindi ? "बंद करें" : "Close"}
            >
              ×
            </button>
            <Image
              src={`/api/contributions/${openItem.id}/file?variant=social`}
              alt={openItem.title}
              width={openItem.width ?? 800}
              height={openItem.height ?? 1000}
              unoptimized
            />
            <div className="art-lightbox-detail">
              <h3>{openItem.title}</h3>
              {openItem.subtitle && <p className="tile-sub">{openItem.subtitle}</p>}
              <p>
                <Credit item={openItem} hindi={hindi} />
                {openItem.width && openItem.height ? ` · ${openItem.width}×${openItem.height}` : ""}
              </p>
              <p className="art-lightbox-licence">
                <Licence item={openItem} hindi={hindi} />
                {openItem.provenance === "public_domain" && openItem.sourceUrl ? (
                  <>
                    {" · "}
                    <a href={openItem.sourceUrl} target="_blank" rel="noreferrer noopener">
                      {hindi ? "मूल स्रोत" : "Original source"}
                    </a>
                  </>
                ) : null}
              </p>
              <div className="gallery-downloads">
                <a href={`/api/contributions/${openItem.id}/file?download=1`} download>
                  {hindi ? "प्रिंट" : "Print"}
                </a>
                <a
                  href={`/api/contributions/${openItem.id}/file?variant=social&download=1`}
                  download
                >
                  {hindi ? "सोशल" : "Social"}
                </a>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

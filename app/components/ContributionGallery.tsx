"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Language } from "@/app/lib/content";
import type { PublicContribution } from "@/app/lib/database";

// A poem at or under this length is shown whole; longer poems cut here and
// hand off to their read page. Mirrors POEM_TILE_LIMIT server-side.
const POEM_TILE_LIMIT = 600;

// Character count under-measures Devanagari (each visible letter is several
// codepoints), so a poem also cuts by height: anything over POEM_TILE_LINES
// lines shows the first POEM_TEASER_LINES — a clean break for couplet forms.
const POEM_TILE_LINES = 12;
const POEM_TEASER_LINES = 8;

// Essay tiles open with the first words of the piece, per the approved mockup.
// Paragraph breaks collapse to an em dash so a salutation reads inline
// ("DEAR COMRADES — Our movement is passing…"); the CSS line clamp trims the
// rest, so this only bounds how much text the clamp works with.
const ESSAY_TEASER_LIMIT = 240;

function essayTeaser(body: string) {
  return body
    .slice(0, ESSAY_TEASER_LIMIT * 2)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" — ")
    .slice(0, ESSAY_TEASER_LIMIT);
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

  const [openPoem, setOpenPoem] = useState<PublicContribution | null>(null);
  const poemDialog = useRef<HTMLDialogElement>(null);

  // The native dialog brings focus trapping, Esc and ::backdrop for free;
  // state only drives it open and closed.
  useEffect(() => {
    const dialog = poemDialog.current;
    if (!dialog) return;
    if (openPoem && !dialog.open) dialog.showModal();
    if (!openPoem && dialog.open) dialog.close();
  }, [openPoem]);

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
            const isFile = item.kind === "poster" || item.kind === "image";
            const poemLines = item.kind === "poem" ? item.body.split("\n") : [];
            const poemIsCut =
              item.kind === "poem" &&
              (item.body.length > POEM_TILE_LIMIT || poemLines.length > POEM_TILE_LINES);
            return (
              <article key={item.id} className="gallery-card" data-kind={item.kind}>
                {isFile && (
                  <div className="gallery-art">
                    <Image
                      src={`${fileUrl}?variant=social`}
                      alt={item.title}
                      width={item.width ?? 800}
                      height={item.height ?? 1000}
                      unoptimized
                    />
                  </div>
                )}

                {item.kind === "poem" && (
                  <div className="gallery-tile" style={{ background: tileColour(item.id) }}>
                    <h3>{item.title}</h3>
                    {item.subtitle && <p className="tile-sub">{item.subtitle}</p>}
                    <p className={poemIsCut ? "tile-teaser" : undefined}>
                      {poemIsCut
                        ? poemLines.slice(0, POEM_TEASER_LINES).join("\n").slice(0, POEM_TILE_LIMIT)
                        : item.body}
                    </p>
                    {poemIsCut && (
                      <Link
                        className="tile-more"
                        href={readHref(item.id)}
                        onClick={(event) => {
                          // A plain click reads the poem in place; modified
                          // clicks keep their open-elsewhere meaning and use
                          // the poem's own page.
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                            return;
                          event.preventDefault();
                          setOpenPoem(item);
                        }}
                      >
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
        ref={poemDialog}
        className="poem-modal"
        onClose={() => setOpenPoem(null)}
        onClick={(event) => {
          if (event.target === poemDialog.current) poemDialog.current?.close();
        }}
      >
        {openPoem && (
          <div
            className="gallery-tile poem-modal-panel"
            style={{ background: tileColour(openPoem.id) }}
          >
            <button
              type="button"
              className="poem-modal-close"
              onClick={() => poemDialog.current?.close()}
              aria-label={hindi ? "बंद करें" : "Close"}
            >
              ×
            </button>
            <h3>{openPoem.title}</h3>
            {openPoem.subtitle && <p className="tile-sub">{openPoem.subtitle}</p>}
            <p>{openPoem.body}</p>
            <div className="poem-modal-foot">
              <small>
                <Credit item={openPoem} hindi={hindi} /> · CC BY-NC-SA 4.0
              </small>
              <Link href={readHref(openPoem.id)} onClick={() => poemDialog.current?.close()}>
                {hindi ? "इसका अपना पन्ना →" : "Open its own page →"}
              </Link>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

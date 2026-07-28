import Link from "next/link";
import { notFound } from "next/navigation";
import type { Language } from "@/app/lib/content";
import { loadApprovedText } from "@/app/lib/database";
import { SiteShell } from "./SiteShell";

/**
 * Full text of an approved poem or essay. Only approved text kinds resolve
 * here — pending, declined and withdrawn work stays invisible, and image kinds
 * have nothing to read.
 */
export async function ContributionReadPage({
  id,
  language,
}: {
  id: string;
  language: Language;
}) {
  const item = await loadApprovedText(id);
  if (!item) notFound();
  const hindi = language === "hi";
  const kindLabel =
    item.kind === "poem" ? (hindi ? "कविता" : "Poem") : hindi ? "लेख" : "Essay";

  return (
    <SiteShell language={language}>
      <div className="page-shell">
        <article className="read-page">
          <p className="eyebrow">{kindLabel}</p>
          <h1>{item.title}</h1>
          {item.subtitle && <p className="dek">{item.subtitle}</p>}
          <p className="read-credit">
            {item.creditAccount.startsWith("https://") ? (
              <a href={item.creditAccount} target="_blank" rel="noreferrer noopener">
                {item.creditAccount.replace(/^https:\/\/(www\.)?/, "")}
              </a>
            ) : (
              item.creditAccount || item.credit || (hindi ? "गुमनाम" : "Anonymous")
            )}
          </p>
          <div className="read-body">{item.body}</div>
          <footer className="read-footer">
            <small>
              {item.provenance === "public_domain"
                ? hindi
                  ? "सार्वजनिक डोमेन · साझा करने के लिए स्वतंत्र"
                  : "Public domain · free to share"
                : `CC BY-NC-SA 4.0 · ${hindi ? "साझा करने के लिए स्वतंत्र" : "free to share"}`}
            </small>
            {item.provenance === "public_domain" && item.sourceUrl && (
              <small>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">
                  {hindi ? "मूल स्रोत" : "Original source"}
                </a>
              </small>
            )}
            <Link href={hindi ? "/hi/art" : "/art"}>
              {hindi ? "← दीवार पर वापस" : "← Back to the wall"}
            </Link>
          </footer>
        </article>
      </div>
    </SiteShell>
  );
}

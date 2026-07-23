"use client";

import { useCallback, useEffect, useState } from "react";
import type { Language } from "@/app/lib/content";

type ScanItem = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  discoveredBy: "Google News" | "PIB";
  verification: "unreviewed";
};

type ScanResponse = {
  checkedAt: string;
  status: "fresh" | "partial" | "unavailable";
  sourcesChecked: string[];
  items: ScanItem[];
  warnings: string[];
  editorialStatus: string;
};

export function FreshSourceScan({ language }: { language: Language }) {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const hindi = language === "hi";

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/source-scan?visit=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("source scan unavailable");
      setData((await response.json()) as ScanResponse);
    } catch {
      setData({
        checkedAt: new Date().toISOString(),
        status: "unavailable",
        sourcesChecked: ["Google News India", "Press Information Bureau"],
        items: [],
        warnings: ["All current-source checks failed"],
        editorialStatus:
          "Previously verified updates remain available below. Retry the live source scan before relying on freshness.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialScan = window.setTimeout(scan, 0);
    const interval = window.setInterval(scan, 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initialScan);
      window.clearInterval(interval);
    };
  }, [scan]);

  const copy = hindi
    ? {
        eyebrow: "पेज-विज़िट स्रोत जाँच",
        title: "नए स्रोत अभी जाँचे जा रहे हैं",
        checked: "अंतिम स्रोत जाँच",
        loading: "Google News India और प्रेस सूचना ब्यूरो जाँचे जा रहे हैं…",
        retry: "फिर जाँचें",
        unreviewed: "समीक्षा बाकी",
        empty: "इस जाँच में कोई नया प्रासंगिक शीर्षक नहीं मिला।",
        note: "ये नए स्रोत संकेत हैं, सत्यापित अपडेट नहीं। प्रकाशन से पहले संपादकीय समीक्षा आवश्यक है।",
      }
    : {
        eyebrow: "On-visit source check",
        title: "New sources checked now",
        checked: "Last source check",
        loading: "Checking Google News India and the Press Information Bureau…",
        retry: "Check again",
        unreviewed: "review pending",
        empty: "No new relevant headlines were found in this scan.",
        note: "These are newly discovered source leads, not verified updates. Editorial review is required before promotion.",
      };

  return (
    <section className="source-scan" aria-labelledby="source-scan-title">
      <div className="source-scan-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id="source-scan-title">{copy.title}</h2>
          <p className="refresh-note" aria-live="polite">
            <span
              className={`signal ${data?.status === "fresh" ? "signal-live" : ""}`}
            />
            {loading
              ? copy.loading
              : data
                ? `${copy.checked} ${new Intl.DateTimeFormat(
                    hindi ? "hi-IN" : "en-IN",
                    { dateStyle: "medium", timeStyle: "medium" },
                  ).format(new Date(data.checkedAt))}`
                : copy.loading}
          </p>
        </div>
        <button
          className="scan-button"
          disabled={loading}
          onClick={scan}
          type="button"
        >
          {loading ? "…" : `↻ ${copy.retry}`}
        </button>
      </div>
      {data?.warnings.length ? (
        <p className="scan-warning">{data.warnings.join(" · ")}</p>
      ) : null}
      {data?.items.length ? (
        <div className="source-leads">
          {data.items.slice(0, 8).map((item) => (
            <article key={item.id}>
              <div>
                <span className="badge badge-reported">{copy.unreviewed}</span>
                <span className="source-origin">
                  {item.publisher} · {item.discoveredBy}
                </span>
              </div>
              <h3>
                <a href={item.url} rel="noreferrer">
                  {item.title}
                </a>
              </h3>
              {item.publishedAt ? (
                <time dateTime={item.publishedAt}>
                  {new Intl.DateTimeFormat(hindi ? "hi-IN" : "en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.publishedAt))}
                </time>
              ) : null}
            </article>
          ))}
        </div>
      ) : data && !loading ? (
        <p className="scan-empty">{copy.empty}</p>
      ) : (
        <div className="scan-loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      <p className="source-scan-note">{copy.note}</p>
    </section>
  );
}

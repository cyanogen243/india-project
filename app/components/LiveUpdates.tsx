"use client";

import { useEffect, useState } from "react";
import type { Language, Update } from "@/app/lib/content";
import { ShareReceipt } from "./ShareReceipt";

type Feed = {
  generatedAt: string;
  updates: Update[];
};

export function LiveUpdates({
  language,
  initial,
}: {
  language: Language;
  initial: Update[];
}) {
  const [records, setRecords] = useState(initial);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch(`/feed/updates.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("feed unavailable");
        const feed = (await response.json()) as Feed;
        if (!active) return;
        setRecords(
          feed.updates
            .filter((item) => item.language === language)
            .sort(
              (a, b) =>
                new Date(b.publishedAt).getTime() -
                new Date(a.publishedAt).getTime(),
            ),
        );
        setRefreshedAt(feed.generatedAt);
        setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [language]);

  const copy =
    language === "hi"
      ? {
          live: "लाइव सत्यापित फ़ीड",
          cached: "कैश की गई प्रति",
          refreshed: "अंतिम जाँच",
          source: "स्रोत",
          stale: "समय-सीमा समाप्त",
          event: "घटना",
          published: "प्रकाशित",
        }
      : {
          live: "Live verified feed",
          cached: "Cached copy",
          refreshed: "Last checked",
          source: "Source",
          stale: "Expired",
          event: "Event",
          published: "Published",
        };

  return (
    <section aria-labelledby="updates-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow" id="updates-heading">
            {copy.live}
          </p>
          <p className="refresh-note" aria-live="polite">
            <span className={connected ? "signal signal-live" : "signal"} />
            {connected ? copy.live : copy.cached}
            {refreshedAt
              ? ` · ${copy.refreshed} ${new Intl.DateTimeFormat(
                  language === "hi" ? "hi-IN" : "en-IN",
                  { timeStyle: "short" },
                ).format(new Date(refreshedAt))}`
              : ""}
          </p>
        </div>
        <a className="text-link" href={language === "hi" ? "/hi/updates" : "/updates"}>
          {language === "hi" ? "सभी अपडेट" : "All updates"} →
        </a>
      </div>
      <div className="update-list">
        {records.slice(0, 5).map((update) => {
          const stale =
            update.expiresAt &&
            refreshedAt &&
            new Date(update.expiresAt).getTime() <
              new Date(refreshedAt).getTime();
          return (
            <article className="update-row" key={`${update.language}-${update.id}`}>
              <div className="update-status-column">
                <span className={`badge badge-${update.status}`}>
                  {update.status}
                </span>
                {stale ? <span className="stale">{copy.stale}</span> : null}
              </div>
              <div>
                <h3>{update.title}</h3>
                <p>{update.summary}</p>
                <dl className="metadata">
                  <div>
                    <dt>{copy.event}</dt>
                    <dd>{new Date(update.eventTime).toLocaleString(language === "hi" ? "hi-IN" : "en-IN")}</dd>
                  </div>
                  <div>
                    <dt>{copy.published}</dt>
                    <dd>{new Date(update.publishedAt).toLocaleString(language === "hi" ? "hi-IN" : "en-IN")}</dd>
                  </div>
                  <div>
                    <dt>{copy.source}</dt>
                    <dd className="source-links">
                      {update.sources.map((source) =>
                        source.url ? (
                          <a href={source.url} key={source.label} rel="noreferrer">
                            {source.label} [{source.tier}]
                          </a>
                        ) : (
                          <span key={source.label}>{source.label} [{source.tier}]</span>
                        ),
                      )}
                    </dd>
                  </div>
                </dl>
                <ShareReceipt
                  language={language}
                  title={update.title}
                  summary={update.summary}
                  status={update.status}
                  publishedAt={update.publishedAt}
                  source={update.sources[0].label}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

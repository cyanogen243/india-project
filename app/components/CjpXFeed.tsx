"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/app/lib/content";

declare global {
  interface Window {
    twttr?: {
      widgets: {
        load: (element?: HTMLElement) => Promise<void>;
      };
    };
  }
}

const CJP_X_HANDLE = "Cockroachisback";
const CJP_X_URL = `https://x.com/${CJP_X_HANDLE}`;
const X_WIDGET_SCRIPT = "https://platform.twitter.com/widgets.js";

export function CjpXFeed({ language }: { language: Language }) {
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const hindi = language === "hi";

  useEffect(() => {
    if (!requested || !feedRef.current) return;

    const renderTimeline = () => {
      if (!window.twttr || !feedRef.current) return;
      window.twttr.widgets.load(feedRef.current).catch(() => setFailed(true));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${X_WIDGET_SCRIPT}"]`,
    );
    if (existing) {
      if (window.twttr) renderTimeline();
      else existing.addEventListener("load", renderTimeline, { once: true });
      existing.addEventListener("error", () => setFailed(true), { once: true });
      return () => existing.removeEventListener("load", renderTimeline);
    }

    const script = document.createElement("script");
    script.src = X_WIDGET_SCRIPT;
    script.async = true;
    script.charset = "utf-8";
    script.addEventListener("load", renderTimeline, { once: true });
    script.addEventListener("error", () => setFailed(true), { once: true });
    document.body.appendChild(script);
  }, [requested]);

  const copy = hindi
    ? {
        eyebrow: "CJP का लाइव X फ़ीड",
        title: `@${CJP_X_HANDLE} से अपडेट`,
        note: "CJP का मूल @cockroachjanta अकाउंट निलंबित है। यह पैनल घोषित वैकल्पिक हैंडल दिखाता है। X पोस्ट असमीक्षित स्रोत सामग्री हैं—सत्यापित अपडेट नहीं।",
        privacy:
          "लाइव फ़ीड लोड करने पर आपका ब्राउज़र X से जुड़ेगा और X की गोपनीयता शर्तें लागू होंगी।",
        load: "लाइव X फ़ीड लोड करें",
        open: "X पर सीधे खोलें",
        failed: "X फ़ीड यहाँ लोड नहीं हो सका। हैंडल को सीधे X पर खोलें।",
      }
    : {
        eyebrow: "CJP live on X",
        title: `Updates from @${CJP_X_HANDLE}`,
        note: "CJP’s original @cockroachjanta account is suspended. This panel follows the announced replacement handle. X posts are unreviewed source material—not verified updates.",
        privacy:
          "Loading the live feed connects your browser to X and is subject to X’s privacy practices.",
        load: "Load live X feed",
        open: "Open directly on X",
        failed:
          "X could not load the timeline here. Open the handle directly on X.",
      };

  return (
    <section className="x-feed" aria-labelledby="cjp-x-title">
      <div className="x-feed-intro">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id="cjp-x-title">{copy.title}</h2>
          <p>{copy.note}</p>
        </div>
        <a className="x-link" href={CJP_X_URL} rel="noreferrer">
          {copy.open} ↗
        </a>
      </div>

      {requested ? (
        <div className="x-timeline-shell" ref={feedRef}>
          {failed ? <p className="scan-warning">{copy.failed}</p> : null}
          <a
            className="twitter-timeline"
            data-chrome="noheader nofooter noborders transparent"
            data-dnt="true"
            data-height="640"
            data-theme="light"
            href={`https://twitter.com/${CJP_X_HANDLE}`}
          >
            {copy.open}: @{CJP_X_HANDLE}
          </a>
        </div>
      ) : (
        <div className="x-feed-consent">
          <p>{copy.privacy}</p>
          <button
            className="button button-primary"
            onClick={() => setRequested(true)}
            type="button"
          >
            {copy.load}
          </button>
        </div>
      )}
    </section>
  );
}

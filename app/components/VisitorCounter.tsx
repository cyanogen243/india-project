"use client";

import { useEffect, useState } from "react";
import type { Language } from "@/app/lib/content";

export function VisitorCounter({ language }: { language: Language }) {
  const [total, setTotal] = useState<number | null>(null);
  const hindi = language === "hi";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/visitor-count", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) throw new Error("Counter unavailable");
        return result.json() as Promise<{ total: number }>;
      })
      .then((value) => setTotal(value.total))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const formatted =
    total === null
      ? "—"
      : new Intl.NumberFormat(hindi ? "hi-IN" : "en-IN").format(total);

  return (
    <div className="visitor-counter" aria-live="polite">
      <span className="visitor-counter-kicker">
        {hindi ? "लोगों की पहुँच" : "People-powered reach"}
      </span>
      <strong>{formatted}</strong>
      <span>{hindi ? "विज़िट दर्ज की गईं" : "visits counted"}</span>
      <small>
        {hindi
          ? "हर नेटवर्क को दिन में एक बार · कोई कुकी नहीं"
          : "Each network once per day · no cookies"}
      </small>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Language, UpdateStatus } from "@/app/lib/content";

export function ShareReceipt({
  language,
  title,
  summary,
  status,
  publishedAt,
  source,
}: {
  language: Language;
  title: string;
  summary: string;
  status: UpdateStatus;
  publishedAt: string;
  source: string;
}) {
  const [result, setResult] = useState<"idle" | "shared" | "copied">("idle");
  const hindi = language === "hi";
  const text = [
    `THE INDIA PROJECT · ${status.toUpperCase()}`,
    title,
    summary,
    `${hindi ? "स्रोत" : "Source"}: ${source}`,
    `${hindi ? "प्रकाशित" : "Published"}: ${new Date(publishedAt).toLocaleString(
      hindi ? "hi-IN" : "en-IN",
    )}`,
    "#TheIndiaProject #VerifyBeforeYouAmplify",
  ].join("\n\n");

  async function share() {
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setResult("shared");
        return;
      }
      await navigator.clipboard.writeText(`${text}\n\n${url}`);
      setResult("copied");
    } catch {
      // A cancelled native share sheet should leave the button ready to retry.
      setResult("idle");
    }
  }

  const label =
    result === "shared"
      ? hindi
        ? "साझा किया"
        : "Shared"
      : result === "copied"
        ? hindi
          ? "रसीद कॉपी की गई"
          : "Receipt copied"
        : hindi
          ? "सत्यापित रसीद साझा करें"
          : "Share verified receipt";

  return (
    <button className="share-button" type="button" onClick={share}>
      <span aria-hidden="true">↗</span> {label}
    </button>
  );
}

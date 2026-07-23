"use client";

import { useState } from "react";
import type { Language, UpdateStatus } from "@/app/lib/content";

type ShareResult = "idle" | "shared" | "copied" | "manual";

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
  const [result, setResult] = useState<ShareResult>("idle");
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

  function receiptText() {
    return `${text}\n\n${window.location.href}`;
  }

  async function copyToClipboard(value: string) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to the browser-compatible selection copy below.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  async function copyReceipt() {
    const copied = await copyToClipboard(receiptText());
    setResult(copied ? "copied" : "manual");
  }

  async function shareReceipt() {
    const url = window.location.href;
    const payload = { title, text, url };
    const canShare =
      typeof navigator.canShare !== "function" || navigator.canShare(payload);

    if (typeof navigator.share === "function" && canShare) {
      try {
        await navigator.share(payload);
        setResult("shared");
        return;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError"
        ) {
          setResult("idle");
          return;
        }
      }
    }

    await copyReceipt();
  }

  const shareLabel =
    result === "shared"
      ? hindi
        ? "साझा किया"
        : "Shared"
      : hindi
        ? "सत्यापित रसीद साझा करें"
        : "Share verified receipt";
  const copyLabel =
    result === "copied"
      ? hindi
        ? "रसीद कॉपी की गई"
        : "Receipt copied"
      : hindi
        ? "रसीद कॉपी करें"
        : "Copy receipt";
  const fullReceipt = `${text}\n\n${typeof window === "undefined" ? "" : window.location.href}`;

  return (
    <div className="share-actions">
      <div className="share-action-buttons">
        <button className="share-button" type="button" onClick={shareReceipt}>
          <span aria-hidden="true">↗</span> {shareLabel}
        </button>
        <button
          className="copy-receipt-button"
          type="button"
          onClick={copyReceipt}
        >
          {copyLabel}
        </button>
      </div>
      <p className="share-feedback" aria-live="polite">
        {result === "copied"
          ? hindi
            ? "स्रोत और लिंक सहित रसीद कॉपी की गई।"
            : "Receipt copied with its source and link."
          : result === "manual"
            ? hindi
              ? "नीचे दी गई रसीद चुनें और कॉपी करें।"
              : "Select and copy the receipt below."
            : ""}
      </p>
      {result === "manual" ? (
        <textarea
          className="manual-receipt"
          aria-label={
            hindi ? "मैन्युअल रूप से कॉपी करने के लिए रसीद" : "Receipt to copy manually"
          }
          readOnly
          value={fullReceipt}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}

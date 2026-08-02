"use client";

import { useState } from "react";
import type { Language } from "@/app/lib/content";

type Submission = {
  // Present only once the work is approved and therefore public.
  id: string | null;
  kind: "poster" | "image" | "poem" | "essay";
  title: string;
  status: string;
  declineReason: string | null;
  createdAt: string;
};

const statusLabels: Record<string, { en: string; hi: string }> = {
  pending: { en: "Received — waiting for review", hi: "मिल गया — समीक्षा बाकी" },
  approved: { en: "Published to the gallery", hi: "गैलरी में प्रकाशित" },
  declined: { en: "Not accepted", hi: "स्वीकार नहीं किया गया" },
  withdrawn: { en: "You removed this", hi: "आपने इसे हटा दिया" },
};

const reasonLabels: Record<string, { en: string; hi: string }> = {
  off_topic: { en: "Not related to the movement", hi: "आंदोलन से संबंधित नहीं" },
  not_public_domain: {
    en: "This is not actually free to share",
    hi: "यह वाक़ई साझा करने के लिए स्वतंत्र नहीं है",
  },
  not_own_work: { en: "Appears to be someone else's work", hi: "यह किसी और का काम लगता है" },
  identifying_info: {
    en: "Contains information that could identify people",
    hi: "इसमें ऐसी जानकारी है जिससे लोगों की पहचान हो सकती है",
  },
  low_quality: { en: "Resolution too low to be usable", hi: "रिज़ॉल्यूशन बहुत कम है" },
  duplicate: { en: "Already in the collection", hi: "यह पहले से संग्रह में है" },
  other: { en: "Other", hi: "अन्य" },
};

/**
 * The server ignores case and punctuation when it reads a code, so a code
 * written down as "a7x9-b2mz" names the same submission as "A7X9B2MZ". The
 * field keeps what was typed; this is what identifies the submission.
 */
function asCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function RecoveryCodeLookup({ language }: { language: Language }) {
  const hindi = language === "hi";
  const [code, setCode] = useState("");
  // What the server said about a code, filed under the code that was asked.
  const [answer, setAnswer] = useState<{ code: string; submission: Submission } | null>(null);
  // How the last action ended, in words. Kept apart from the card because a
  // withdrawal has already happened on the server by the time this is set: it
  // is reported whatever the field says next, or an irreversible erasure would
  // go unmentioned.
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  const wanted = asCode(code);
  // The card is shown only while the field still asks about its code, so a
  // reply that lands after the field has moved on cannot appear beside a
  // newer code — or beside the button that takes work down for good.
  const submission = answer?.code === wanted ? answer.submission : null;

  function editCode(value: string) {
    // Case only: changing the length here would move the caret mid-word.
    setCode(value.toUpperCase());
    setNotice(null);
    // A card is not kept for a code the field has left. Retyping that code
    // has to ask the server again rather than restore what it said earlier,
    // which may since have been moderated — or withdrawn from another device.
    if (asCode(value) !== answer?.code) setAnswer(null);
  }

  async function send(action: "status" | "withdraw") {
    // The card is on screen only while it is the code in the field, so both
    // actions carry that code and cannot reach different submissions.
    const target = wanted;
    if (!target) return;
    setChecking(true);
    setNotice(null);
    try {
      const response = await fetch("/api/contributions/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: target, action }),
      });
      // A proxy refusing the request answers in HTML, not JSON — as can a
      // captive portal with a 200, so an unreadable body is a failure too.
      const value = await response.json().catch(() => null);
      if (!response.ok || !value) {
        throw new Error(value?.error ?? (hindi ? "कुछ गड़बड़ हुई।" : "Something went wrong."));
      }
      if (action === "withdraw") {
        if (submission) setAnswer({ code: target, submission: { ...submission, status: "withdrawn" } });
        setNotice({
          text: hindi ? "आपका योगदान हटा दिया गया।" : "Your contribution has been removed.",
          failed: false,
        });
      } else {
        if (!value.submission) throw new Error(hindi ? "कुछ गड़बड़ हुई।" : "Something went wrong.");
        setAnswer({ code: target, submission: value.submission });
      }
    } catch (error) {
      // The card stays: a failed withdrawal changed nothing, and the message
      // asks the reader to try the button again.
      setNotice({
        text:
          error instanceof Error
            ? error.message
            : hindi ? "कुछ गड़बड़ हुई।" : "Something went wrong.",
        failed: true,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="lookup-panel">
      <form
        className="lookup-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send("status");
        }}
      >
        <label>
          {hindi ? "अपना 8-अक्षर कोड डालें" : "Enter your 8-character code"}
          <input
            className="lookup-code-input"
            value={code}
            onChange={(event) => editCode(event.target.value)}
            placeholder="A7X9B2MZ"
            maxLength={16}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={checking}>
          {checking
            ? hindi ? "देखा जा रहा है…" : "Checking…"
            : hindi ? "स्थिति देखें" : "Check status"}
        </button>
      </form>

      <p aria-live="polite" className={notice?.failed ? "admin-banner error" : ""}>
        {notice?.text ?? ""}
      </p>

      {submission && (
        <article className="lookup-result">
          <h3>{submission.title}</h3>
          <p>
            <span className={`badge badge-${submission.status}`}>
              {statusLabels[submission.status]?.[hindi ? "hi" : "en"] ?? submission.status}
            </span>
          </p>
          {submission.status === "approved" && (
            <p>
              {/* Only poems and essays have a page of their own; a poster or
                  image lives on the wall itself. */}
              <a
                className="text-link"
                href={
                  submission.id && (submission.kind === "poem" || submission.kind === "essay")
                    ? `${hindi ? "/hi/art" : "/art"}/${submission.id}`
                    : hindi ? "/hi/art" : "/art"
                }
              >
                {hindi ? "दीवार पर देखें →" : "See it on the wall →"}
              </a>
            </p>
          )}
          {submission.status === "declined" && submission.declineReason && (
            <p>
              <strong>{hindi ? "कारण: " : "Reason: "}</strong>
              {reasonLabels[submission.declineReason]?.[hindi ? "hi" : "en"] ??
                submission.declineReason}
            </p>
          )}
          <p>
            <small>
              {hindi ? "भेजा गया: " : "Sent: "}
              {new Date(submission.createdAt).toLocaleDateString(hindi ? "hi-IN" : "en-IN")}
            </small>
          </p>
          {submission.status !== "withdrawn" && (
            <button
              className="button button-danger"
              type="button"
              disabled={checking}
              onClick={() => {
                const confirmed = window.confirm(
                  hindi
                    ? "अपना योगदान हटाएँ? यह वापस नहीं आएगा।"
                    : "Remove your contribution? This cannot be undone.",
                );
                if (confirmed) void send("withdraw");
              }}
            >
              {hindi ? "मेरा योगदान हटाएँ" : "Take my contribution down"}
            </button>
          )}
        </article>
      )}
    </div>
  );
}

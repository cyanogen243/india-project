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

export function RecoveryCodeLookup({ language }: { language: Language }) {
  const hindi = language === "hi";
  const [code, setCode] = useState("");
  // A submission is held together with the code that fetched it, so the
  // withdraw button acts on the card it sits in rather than on whatever the
  // field happens to say when it is pressed. Withdrawal is irreversible: a
  // contributor who looked up one code and then typed another — checking a
  // second submission — was erasing the work they were not looking at, and
  // being told it had worked under the title of the one they were.
  //
  // The field clears this on every keystroke, so the two cannot drift apart in
  // the first place. Pairing them here as well means the button cannot target
  // the wrong record even if that ever stops being true.
  const [result, setResult] = useState<{ code: string; submission: Submission } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const submission = result?.submission ?? null;

  async function send(action: "status" | "withdraw") {
    // Withdrawal acts on the submission on screen; a status check acts on
    // whatever has been typed.
    const target = action === "withdraw" ? result?.code : code;
    if (!target) return;
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/contributions/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: target, action }),
      });
      // A proxy refusing the request answers in HTML, not JSON. Parsing
      // unguarded showed the contributor a syntax error from the parser.
      const value = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(value?.error ?? (hindi ? "कुछ गड़बड़ हुई।" : "Something went wrong."));
      }
      if (action === "withdraw") {
        setResult((current) =>
          current
            ? { ...current, submission: { ...current.submission, status: "withdrawn" } }
            : null,
        );
        setMessage(hindi ? "आपका योगदान हटा दिया गया।" : "Your contribution has been removed.");
      } else {
        setResult(value?.submission ? { code: target, submission: value.submission } : null);
      }
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : hindi ? "कुछ गड़बड़ हुई।" : "Something went wrong.",
      );
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
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              // The card below belongs to the code that fetched it. Once the
              // field says something else the two no longer agree, and a
              // result card carries a button that erases work for good — so
              // it goes rather than waiting beside a code it does not match.
              setResult(null);
              setMessage("");
            }}
            placeholder="A7X9B2MZ"
            maxLength={16}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={state === "loading"}>
          {state === "loading"
            ? hindi ? "देखा जा रहा है…" : "Checking…"
            : hindi ? "स्थिति देखें" : "Check status"}
        </button>
      </form>

      <p aria-live="polite" className={state === "error" ? "admin-banner error" : ""}>
        {message}
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

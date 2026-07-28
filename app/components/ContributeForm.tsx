"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Language } from "@/app/lib/content";

const MAX_BYTES = 4 * 1024 * 1024;

type Kind = "poster" | "image" | "poem" | "essay";

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ContributeForm({ language }: { language: Language }) {
  const hindi = language === "hi";
  const startedAt = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>("poster");
  const [credited, setCredited] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [copied, setCopied] = useState(false);

  const isFileKind = kind === "poster" || kind === "image";

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Object URLs hold the file in memory until they are released.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage(
        hindi
          ? `यह फ़ाइल ${formatBytes(file.size)} की है। अधिकतम 4 MB।`
          : `That file is ${formatBytes(file.size)}. The limit is 4 MB.`,
      );
      return;
    }
    setState("idle");
    setMessage("");
    setPreview({ url: URL.createObjectURL(file), name: file.name, size: file.size });
  }

  if (state === "sent") {
    return (
      <div className="contribute-receipt" role="status">
        <p className="eyebrow">{hindi ? "मिल गया" : "Received"}</p>
        <h2>{hindi ? "आपका योगदान कतार में है" : "Your contribution is in the queue"}</h2>
        <p>
          {hindi
            ? "एक स्वयंसेवक इसकी समीक्षा करेगा। मंज़ूरी मिलने तक यह सार्वजनिक नहीं होगा।"
            : "A volunteer will review it. Nothing appears publicly until it is approved."}
        </p>

        <div className="contribute-code-block">
          <p className="contribute-code-label">
            {hindi ? "यह कोड अभी सहेजें" : "Save this code now"}
          </p>
          <code className="contribute-code">{recoveryCode}</code>
          <button
            type="button"
            className="button"
            onClick={() => {
              void navigator.clipboard.writeText(recoveryCode);
              setCopied(true);
            }}
          >
            {copied ? (hindi ? "कॉपी हो गया" : "Copied") : hindi ? "कॉपी करें" : "Copy"}
          </button>
        </div>

        <p className="contribute-warning">
          {hindi
            ? "यह दोबारा नहीं दिखाया जाएगा। हम आपका नाम या ईमेल नहीं रखते, इसलिए कोड खोने पर उसे वापस नहीं पाया जा सकता।"
            : "This will not be shown again. We hold no name or email for you, so a lost code cannot be recovered."}
        </p>
        <p>
          {hindi
            ? "इस कोड से आप स्थिति देख सकते हैं या अपना योगदान हटा सकते हैं।"
            : "Use it to check the status of your contribution, or to take it down."}
        </p>
      </div>
    );
  }

  const kinds: [Kind, string, string][] = [
    ["poster", hindi ? "पोस्टर" : "Poster", hindi ? "छापने और थामने के लिए" : "Made to print and carry"],
    ["image", hindi ? "चित्र" : "Image", hindi ? "कलाकृति, चित्रण, फ़ोटो" : "Artwork, illustration, photo"],
    ["poem", hindi ? "कविता" : "Poem", hindi ? "पूरी दिखती है · लंबी कविता का अपना पन्ना" : "Shown in full · longer poems get their own page"],
    ["essay", hindi ? "लेख" : "Essay", hindi ? "दीवार पर शुरुआती पंक्तियाँ · पूरा लेख अपने पन्ने पर" : "Opening lines on the wall · full essay on its own page"],
  ];

  return (
    <form
      className="contribute-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (isFileKind && !preview) {
          setState("error");
          setMessage(hindi ? "एक तस्वीर चुनें।" : "Choose an image to share.");
          return;
        }
        setState("sending");
        setMessage("");
        form.set("kind", kind);
        form.set("language", language);
        form.set("startedAt", String(startedAt.current));
        if (!isFileKind) form.delete("file");
        // One credit mode at a time.
        if (credited) form.set("credit", "");
        else form.set("creditAccount", "");
        try {
          const response = await fetch("/api/contributions", { method: "POST", body: form });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? "Submission failed");
          setRecoveryCode(String(value.recoveryCode ?? ""));
          setState("sent");
        } catch (error) {
          setState("error");
          setMessage(
            error instanceof Error
              ? error.message
              : hindi
                ? "अभी फ़ॉर्म जमा नहीं हो सका।"
                : "The form could not be submitted.",
          );
        }
      }}
    >
      <fieldset className="contribute-kind">
        <legend>{hindi ? "आप क्या साझा कर रहे हैं?" : "What are you sharing?"}</legend>
        <div className="contribute-kind-grid">
          {kinds.map(([value, label, hint]) => (
            <label key={value} className={`contribute-kind-card ${kind === value ? "selected" : ""}`}>
              <input
                type="radio"
                name="kindChoice"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              <strong>{label}</strong>
              <small>{hint}</small>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Stated before the file picker rather than as fine print at the end.
          Whether the work is the contributor's own is the single most common
          reason a submission is declined, so it should be read first. */}
      <aside className="contribute-terms">
        <h3>{hindi ? "भेजने से पहले" : "Before you send"}</h3>
        <ul>
          <li>{hindi ? "केवल अपना बनाया हुआ काम भेजें।" : "Only send work you made yourself."}</li>
          <li>
            {hindi
              ? "स्वीकृत काम CC BY-NC-SA 4.0 के तहत जारी होगा: कोई भी इसे मुफ़्त साझा और रीमिक्स कर सकता है, पर बेच नहीं सकता।"
              : "Approved work is released under CC BY-NC-SA 4.0 — anyone may share and remix it freely, but nobody may sell it."}
          </li>
          <li>
            {hindi
              ? "ऐसा कुछ न भेजें जिससे किसी की पहचान हो सके।"
              : "Do not send anything that could identify a person."}
          </li>
        </ul>
      </aside>

      <div className="form-grid">
        <label>
          {hindi ? "शीर्षक" : "Title"}
          <input name="title" required minLength={2} maxLength={120} />
        </label>
        {!isFileKind && (
          <label>
            {hindi ? "उपशीर्षक (वैकल्पिक)" : "Subtitle (optional)"}
            <input
              name="subtitle"
              maxLength={120}
              placeholder={hindi ? "शीर्षक के नीचे एक पंक्ति" : "A line under the title"}
            />
          </label>
        )}
      </div>

      <fieldset className="contribute-kind">
        <legend>{hindi ? "श्रेय" : "Credit"}</legend>
        <div className="contribute-kind-grid">
          <label className={`contribute-kind-card ${credited ? "" : "selected"}`}>
            <input
              type="radio"
              name="creditChoice"
              checked={!credited}
              onChange={() => setCredited(false)}
            />
            <strong>{hindi ? "गुमनाम" : "Anonymous"}</strong>
            <small>{hindi ? "आपके बारे में कुछ नहीं रखा जाता" : "Nothing about you is stored"}</small>
          </label>
          <label className={`contribute-kind-card ${credited ? "selected" : ""}`}>
            <input
              type="radio"
              name="creditChoice"
              checked={credited}
              onChange={() => setCredited(true)}
            />
            <strong>{hindi ? "सार्वजनिक श्रेय दें" : "Credit me publicly"}</strong>
            <small>{hindi ? "एक सार्वजनिक खाता, दीवार पर दिखेगा" : "A public account, shown on the wall"}</small>
          </label>
        </div>
        {credited ? (
          <label className="contribute-credit-field">
            {hindi ? "सार्वजनिक खाता" : "Public account"}
            <input
              name="creditAccount"
              maxLength={120}
              placeholder={hindi ? "@हैंडल — X, Instagram या Bluesky" : "@handle — X, Instagram or Bluesky"}
            />
          </label>
        ) : (
          <label className="contribute-credit-field">
            {hindi ? "नाम या उपनाम (वैकल्पिक)" : "Name or alias (optional)"}
            <input
              name="credit"
              maxLength={80}
              placeholder={hindi ? "खाली छोड़ने पर 'गुमनाम' दिखेगा" : "Left blank, the wall shows “Anonymous”"}
            />
          </label>
        )}
      </fieldset>

      {isFileKind ? (
        <div
          className={`contribute-dropzone ${dragging ? "dragging" : ""} ${preview ? "filled" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file && fileInput.current) {
              const transfer = new DataTransfer();
              transfer.items.add(file);
              fileInput.current.files = transfer.files;
              acceptFile(file);
            }
          }}
        >
          {preview ? (
            <div className="contribute-preview">
              <Image
                src={preview.url}
                alt={hindi ? "चुनी गई तस्वीर" : "Selected image"}
                width={280}
                height={350}
                unoptimized
              />
              <div>
                <p><strong>{preview.name}</strong></p>
                <p>{formatBytes(preview.size)}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setPreview(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  {hindi ? "बदलें" : "Change"}
                </button>
              </div>
            </div>
          ) : (
            <p>{hindi ? "तस्वीर यहाँ छोड़ें" : "Drop your image here"}</p>
          )}

          {/* A drop zone alone is unusable on touch and with assistive tech, so
              the input stays a real, labelled, keyboard-reachable control. */}
          <label className="contribute-browse">
            <span>
              {preview
                ? hindi ? "दूसरी फ़ाइल चुनें" : "Choose a different file"
                : hindi ? "या फ़ाइल चुनें" : "or browse for a file"}
            </span>
            <input
              ref={fileInput}
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => acceptFile(event.target.files?.[0])}
            />
          </label>
          <small>{hindi ? "PNG, JPEG या WebP · अधिकतम 4 MB" : "PNG, JPEG or WebP · 4 MB maximum"}</small>
        </div>
      ) : (
        <label>
          {kind === "poem" ? (hindi ? "आपकी कविता" : "Your poem") : hindi ? "आपका लेख" : "Your essay"}
          <textarea
            name="body"
            rows={12}
            minLength={4}
            maxLength={kind === "poem" ? 8000 : 40000}
            required
          />
        </label>
      )}

      {isFileKind && (
        <p className="contribute-privacy">
          <strong>{hindi ? "हम फ़ाइल दोबारा बनाते हैं।" : "We rebuild the file."}</strong>{" "}
          {hindi
            ? "इससे उसमें छिपी जानकारी हट जाती है — जैसे कैमरे का दर्ज किया हुआ स्थान, या डिज़ाइन सॉफ़्टवेयर का लिखा आपका नाम।"
            : "That removes hidden information it may carry — the location a camera recorded, or your name written in by design software."}
        </p>
      )}

      {/* Left empty by people and filled in by bots. */}
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      <label className="consent-row">
        <input name="consent" type="checkbox" value="yes" required />
        <span>
          {hindi
            ? "यह काम मेरा अपना है, और मैं इसे CC BY-NC-SA 4.0 के तहत जारी करता/करती हूँ।"
            : "This work is my own, and I release it under CC BY-NC-SA 4.0."}
        </span>
      </label>

      <p aria-live="polite" className={state === "error" ? "admin-banner error" : "visually-hidden"}>
        {state === "error"
          ? message
          : state === "sending"
            ? hindi ? "भेजा जा रहा है" : "Sending"
            : ""}
      </p>

      <button className="button button-primary" type="submit" disabled={state === "sending"}>
        {state === "sending"
          ? hindi ? "भेजा जा रहा है…" : "Sending…"
          : hindi ? "योगदान भेजें" : "Send contribution"}
      </button>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/app/lib/content";

const skillOptions = {
  en: [
    ["translation", "Translation"],
    ["source-review", "Source and timestamp review"],
    ["accessibility", "Accessibility and low-bandwidth support"],
    ["editorial", "Editorial support"],
    ["tech-team", "Join the tech team"],
  ],
  hi: [
    ["translation", "अनुवाद"],
    ["source-review", "स्रोत और समय की समीक्षा"],
    ["accessibility", "सुगम्यता और कम-बैंडविड्थ सहायता"],
    ["editorial", "संपादकीय सहायता"],
    ["tech-team", "टेक टीम से जुड़ें"],
  ],
} as const;

export function VolunteerForm({ language }: { language: Language }) {
  const hindi = language === "hi";
  const startedAt = useRef(0);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  if (state === "sent") {
    return (
      <div className="volunteer-success" role="status">
        <span aria-hidden="true">✓</span>
        <h2>{hindi ? "आपकी जानकारी सुरक्षित रूप से मिली" : "Your details were received securely"}</h2>
        <p>{hindi ? "हमारी टीम जरूरत और क्षमता के आधार पर संपर्क करेगी। कृपया संवेदनशील या सटीक स्थान की जानकारी न भेजें।" : "Our team will follow up when a suitable need matches your skills. Please do not send sensitive information or precise locations."}</p>
      </div>
    );
  }

  return (
    <form
      className="volunteer-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setState("sending");
        setMessage("");
        const form = new FormData(event.currentTarget);
        const payload = {
          name: form.get("name"),
          email: form.get("email"),
          contactPlatform: form.get("contactPlatform"),
          contactHandle: form.get("contactHandle"),
          skills: form.getAll("skills"),
          languages: String(form.get("languages") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
          availability: form.get("availability"),
          note: form.get("note"),
          language,
          consent: form.get("consent") === "yes",
          website: form.get("website"),
          startedAt: startedAt.current,
        };
        try {
          const response = await fetch("/api/volunteers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? "Submission failed");
          setState("sent");
        } catch (error) {
          setState("error");
          setMessage(error instanceof Error ? error.message : hindi ? "अभी फ़ॉर्म जमा नहीं हो सका।" : "The form could not be submitted.");
        }
      }}
    >
      <div className="form-grid">
        <label>{hindi ? "नाम या उपनाम" : "Name or alias"}<input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label>
        <label>{hindi ? "ईमेल" : "Email"}<input name="email" type="email" autoComplete="email" maxLength={240} required /></label>
      </div>
      <div className="form-grid">
        <label>
          {hindi ? "संपर्क मंच" : "Contact platform"}
          <select name="contactPlatform" defaultValue="" required>
            <option value="" disabled>{hindi ? "एक विकल्प चुनें" : "Choose one"}</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="discord">Discord</option>
          </select>
        </label>
        <label>
          {hindi ? "हैंडल या उपयोगकर्ता नाम" : "Handle or username"}
          <input
            name="contactHandle"
            autoComplete="off"
            minLength={2}
            maxLength={100}
            placeholder={hindi ? "@आपकाहैंडल" : "@yourhandle"}
            required
          />
        </label>
      </div>
      <fieldset>
        <legend>{hindi ? "आप किस तरह मदद कर सकते हैं?" : "How can you help?"}</legend>
        <div className="checkbox-grid">
          {skillOptions[language].map(([value, label]) => (
            <label key={value}><input name="skills" type="checkbox" value={value} /><span>{label}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <label>{hindi ? "भाषाएँ, कॉमा से अलग करें" : "Languages, separated by commas"}<input name="languages" placeholder={hindi ? "हिंदी, अंग्रेज़ी" : "English, Hindi"} required /></label>
        <label>{hindi ? "उपलब्धता" : "Availability"}<input name="availability" placeholder={hindi ? "जैसे, सप्ताह में 3 घंटे" : "For example, 3 hours a week"} required /></label>
      </div>
      <label>{hindi ? "अनुभव और प्रेरणा" : "Experience and motivation"}<textarea name="note" minLength={20} maxLength={1500} rows={6} placeholder={hindi ? "संक्षेप में बताएँ कि आप क्या योगदान देना चाहते हैं। संवेदनशील जानकारी न दें।" : "Briefly tell us what you would like to contribute. Do not include sensitive information."} required /></label>
      <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="consent-row"><input name="consent" type="checkbox" value="yes" required /><span>{hindi ? "मैं सहमत हूँ कि द इंडिया प्रोजेक्ट स्वयंसेवा के बारे में मुझसे संपर्क करने के लिए यह जानकारी सुरक्षित रूप से रख सकता है।" : "I consent to The India Project securely storing this information to contact me about volunteering."}</span></label>
      <p className="privacy-note">{hindi ? "प्लेटफ़ॉर्म हैंडल दें—फ़ोन नंबर, पहचान पत्र, फ़ाइल या सटीक स्थान न भेजें। अस्वीकृत या संग्रहित रिकॉर्ड 180 दिनों के बाद हटाने योग्य हो जाते हैं।" : "Use a platform handle—do not send a phone number, identity document, file, or precise location. Declined or archived records become eligible for deletion after 180 days."}</p>
      {state === "error" && <p className="form-error" role="alert">{message}</p>}
      <button className="button button-primary" type="submit" disabled={state === "sending"}>{state === "sending" ? (hindi ? "भेजा जा रहा है…" : "Sending…") : (hindi ? "स्वयंसेवा की जानकारी भेजें" : "Send volunteer details")}</button>
    </form>
  );
}

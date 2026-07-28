"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/app/lib/content";
import {
  volunteerCapabilities,
  volunteerCapabilityLabel,
} from "@/app/lib/volunteers";

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
          city: form.get("city"),
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
      <div className="form-grid">
        <label>
          {hindi ? "आप किस शहर में हैं?" : "Which city are you based in?"}
          <input
            name="city"
            autoComplete="address-level2"
            minLength={2}
            maxLength={80}
            placeholder={hindi ? "जैसे, नई दिल्ली" : "For example, New Delhi"}
            required
          />
        </label>
        <label>{hindi ? "भाषाएँ, कॉमा से अलग करें" : "Languages, separated by commas"}<input name="languages" minLength={2} maxLength={320} placeholder={hindi ? "हिंदी, अंग्रेज़ी" : "English, Hindi"} required /></label>
      </div>
      <fieldset>
        <legend>{hindi ? "आप किस तरह मदद कर सकते हैं?" : "How can you help?"}</legend>
        <p className="field-hint">
          {hindi
            ? "जितने चाहें उतने विकल्प चुनें। टीम बाद में आपके उत्तरों के आधार पर तय की जाएगी।"
            : "Choose as many as apply. We match you to a team from your answers, so there is no need to pick one."}
        </p>
        <div className="checkbox-grid">
          {volunteerCapabilities.map((capability) => (
            <label key={capability}>
              <input name="skills" type="checkbox" value={capability} />
              <span>{volunteerCapabilityLabel(capability, language)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>{hindi ? "उपलब्धता" : "Availability"}<input name="availability" minLength={2} maxLength={160} placeholder={hindi ? "जैसे, सप्ताह में 3 घंटे" : "For example, 3 hours a week"} required /></label>
      <label>{hindi ? "अनुभव और प्रेरणा" : "Experience and motivation"}<textarea name="note" minLength={20} maxLength={1500} rows={6} placeholder={hindi ? "संक्षेप में बताएँ कि आप क्या योगदान देना चाहते हैं। संवेदनशील जानकारी न दें।" : "Briefly tell us what you would like to contribute. Do not include sensitive information."} required /></label>
      <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="consent-row"><input name="consent" type="checkbox" value="yes" required /><span>{hindi ? "मैं सहमत हूँ कि द इंडिया प्रोजेक्ट स्वयंसेवा के बारे में मुझसे संपर्क करने के लिए यह जानकारी सुरक्षित रूप से रख सकता है।" : "I consent to The India Project securely storing this information to contact me about volunteering."}</span></label>
      <p className="privacy-note">{hindi ? "प्लेटफ़ॉर्म हैंडल और केवल अपना शहर दें—फ़ोन नंबर, पहचान पत्र, फ़ाइल, पता या सटीक स्थान न भेजें। अस्वीकृत या संग्रहित रिकॉर्ड 180 दिनों के बाद हटाने योग्य हो जाते हैं।" : "Use a platform handle, and name your city only—do not send a phone number, identity document, file, street address, or precise location. Declined or archived records become eligible for deletion after 180 days."}</p>
      {state === "error" && <p className="form-error" role="alert">{message}</p>}
      <button className="button button-primary" type="submit" disabled={state === "sending"}>{state === "sending" ? (hindi ? "भेजा जा रहा है…" : "Sending…") : (hindi ? "स्वयंसेवा की जानकारी भेजें" : "Send volunteer details")}</button>
    </form>
  );
}

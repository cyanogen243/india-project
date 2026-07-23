import type { Language } from "@/app/lib/content";
import Link from "next/link";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

const nav = {
  en: [
    ["Updates", "/updates"],
    ["Demands", "/demands"],
    ["Timeline", "/timeline"],
    ["Safety", "/safety"],
    ["Legal", "/legal"],
    ["Share receipts", "/receipts"],
    ["Reading room", "/reading-room"],
  ],
  hi: [
    ["अपडेट", "/hi/updates"],
    ["माँगें", "/hi/demands"],
    ["समयरेखा", "/hi/timeline"],
    ["सुरक्षा", "/hi/safety"],
    ["कानूनी", "/hi/legal"],
    ["रसीद साझा करें", "/hi/receipts"],
    ["पठन कक्ष", "/hi/reading-room"],
  ],
} satisfies Record<Language, string[][]>;

export function SiteShell({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  const hindi = language === "hi";
  return (
    <>
      <a className="skip-link" href="#main">
        {hindi ? "मुख्य सामग्री पर जाएँ" : "Skip to main content"}
      </a>
      <header className="site-header">
        <div className="utility-bar">
          <p>
            <span className="signal signal-live" />
            {hindi
              ? "सत्यापित सार्वजनिक सूचना · कोई लाइव स्थान ट्रैकिंग नहीं"
              : "Verified public information · No live location tracking"}
          </p>
          <div className="utility-links">
            <a href={hindi ? "/hi/text" : "/text"}>
              {hindi ? "केवल पाठ" : "Text only"}
            </a>
            <Link href="/offline">{hindi ? "ऑफलाइन" : "Offline"}</Link>
            <a
              href={hindi ? "/" : "/hi"}
              hrefLang={hindi ? "en" : "hi"}
              lang={hindi ? "en" : "hi"}
            >
              {hindi ? "English" : "हिंदी"}
            </a>
          </div>
        </div>
        <div className="masthead">
          <a className="brand" href={hindi ? "/hi" : "/"}>
            <span className="brand-mark">S</span>
            <span>
              <strong>The India Project</strong>
              <small>{hindi ? "सत्यापित छात्र जनहित अभिलेख" : "Verified student public-interest record"}</small>
            </span>
          </a>
          <nav aria-label={hindi ? "मुख्य नेविगेशन" : "Main navigation"}>
            {nav[language].map(([label, href]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer>
        <div>
          <p className="footer-brand">The India Project</p>
          <p>
            {hindi
              ? "सार्वजनिक हित के लिए सत्यापित सूचना, सुरक्षा और दस्तावेज़ीकरण।"
              : "Verified information, safety, and documentation in the public interest."}
          </p>
        </div>
        <div className="footer-links">
          <a href={hindi ? "/hi/corrections" : "/corrections"}>
            {hindi ? "सुधार लॉग" : "Correction log"}
          </a>
          <a href={hindi ? "/hi/evidence" : "/evidence"}>
            {hindi ? "साक्ष्य नीति" : "Evidence policy"}
          </a>
          <a href={hindi ? "/hi/editorial-standard" : "/editorial-standard"}>
            {hindi ? "संपादकीय मानक" : "Editorial standard"}
          </a>
        </div>
        <p className="footer-note">
          {hindi
            ? "कोई विश्लेषिकी, कुकी, खाता या सार्वजनिक अपलोड नहीं।"
            : "No analytics, cookies, accounts, or public uploads."}
        </p>
      </footer>
      <ServiceWorkerRegister />
    </>
  );
}

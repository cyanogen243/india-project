import {
  corrections,
  demands,
  forLanguage,
  formatDate,
  governmentResponses,
  media,
  readingRoom,
  timeline,
  updates,
  type Language,
} from "@/app/lib/content";
import { LiveUpdates } from "./LiveUpdates";
import { ShareReceipt } from "./ShareReceipt";
import { SiteShell } from "./SiteShell";

export type PageKind =
  | "home"
  | "updates"
  | "demands"
  | "timeline"
  | "safety"
  | "legal"
  | "reading-room"
  | "corrections"
  | "evidence"
  | "text"
  | "offline"
  | "hall-of-shame"
  | "receipts"
  | "editorial-standard";

const titles: Record<Language, Record<PageKind, string>> = {
  en: {
    home: "Verified student public-interest information",
    updates: "Verified updates",
    demands: "Demands and responses",
    timeline: "Movement timeline",
    safety: "Safety information",
    legal: "Legal information",
    "reading-room": "Reading room",
    corrections: "Corrections and retractions",
    evidence: "Sensitive evidence intake",
    text: "Low-bandwidth summary",
    offline: "Offline access",
    "hall-of-shame": "Hall of Shame",
    receipts: "Share the receipts",
    "editorial-standard": "Editorial and verification standard",
  },
  hi: {
    home: "सत्यापित छात्र जनहित सूचना",
    updates: "सत्यापित अपडेट",
    demands: "माँगें और प्रतिक्रियाएँ",
    timeline: "आंदोलन समयरेखा",
    safety: "सुरक्षा सूचना",
    legal: "कानूनी सूचना",
    "reading-room": "पठन कक्ष",
    corrections: "सुधार और वापसी",
    evidence: "संवेदनशील साक्ष्य जमा करना",
    text: "कम-बैंडविड्थ सारांश",
    offline: "ऑफलाइन पहुँच",
    "hall-of-shame": "हॉल ऑफ शेम",
    receipts: "सत्यापित रसीदें साझा करें",
    "editorial-standard": "संपादकीय और सत्यापन मानक",
  },
};

function PageHeader({
  language,
  kind,
  intro,
}: {
  language: Language;
  kind: PageKind;
  intro: string;
}) {
  return (
    <header className="page-header">
      <p className="eyebrow">{language === "hi" ? "जनहित अभिलेख" : "Public-interest record"}</p>
      <h1>{titles[language][kind]}</h1>
      <p className="dek">{intro}</p>
    </header>
  );
}

function StatusKey({ language }: { language: Language }) {
  return (
    <div className="status-key" aria-label={language === "hi" ? "स्थिति संकेत" : "Status key"}>
      {["reported", "corroborating", "verified", "disputed", "retracted"].map(
        (status) => (
          <span className={`badge badge-${status}`} key={status}>
            {status}
          </span>
        ),
      )}
    </div>
  );
}

function Home({ language }: { language: Language }) {
  const hindi = language === "hi";
  const records = forLanguage(updates, language);
  const demandItems = forLanguage(demands, language);
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            {hindi ? "वर्तमान सत्यापित स्थिति" : "Current verified status"}
          </p>
          <h1>{hindi ? "परीक्षा जवाबदेही आंदोलन जारी" : "The exam-accountability movement continues"}</h1>
          <p className="dek">
            {hindi
              ? "नई दिल्ली में युवा-नेतृत्व वाला धरना जारी है। हम केवल सत्यापित सार्वजनिक अपडेट, व्यापक क्षेत्र, सरकारी प्रतिक्रिया और स्रोत दस्तावेज़ प्रकाशित करते हैं।"
              : "A youth-led sit-in continues in New Delhi. We publish only reviewed public updates, broad zones, government responses, and source documents."}
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={hindi ? "/hi/updates" : "/updates"}>
              {hindi ? "सत्यापित अपडेट देखें" : "Read verified updates"}
            </a>
            <a className="button" href={hindi ? "/offline-pack/field-pack-hi.pdf" : "/offline-pack/field-pack-en.pdf"}>
              {hindi ? "ऑफलाइन फील्ड पैक" : "Offline field pack"}
            </a>
          </div>
        </div>
        <aside className="status-panel" aria-label={hindi ? "सेवा स्थिति" : "Service status"}>
          <p className="status-label">{hindi ? "सेवा स्थिति" : "Service status"}</p>
          <p className="status-value"><span className="signal signal-live" /> {hindi ? "ऑनलाइन" : "Online"}</p>
          <dl>
            <div><dt>{hindi ? "फ़ीड जाँच" : "Feed check"}</dt><dd>{hindi ? "हर 30 सेकंड" : "Every 30 seconds"}</dd></div>
            <div><dt>{hindi ? "स्थान नीति" : "Location policy"}</dt><dd>{hindi ? "केवल व्यापक क्षेत्र" : "Broad zones only"}</dd></div>
            <div><dt>{hindi ? "सार्वजनिक अपलोड" : "Public uploads"}</dt><dd>{hindi ? "बंद" : "Disabled"}</dd></div>
          </dl>
        </aside>
      </section>
      <section className="alert-band">
        <div>
          <p className="eyebrow">{hindi ? "सुरक्षा सूचना" : "Safety notice"}</p>
          <strong>{hindi ? "हमारी डेस्क ने अभी कोई सक्रिय सुरक्षा अलर्ट प्रकाशित नहीं किया है।" : "Our desk has not published an active safety alert."}</strong>
        </div>
        <a href={hindi ? "/hi/safety" : "/safety"}>{hindi ? "समीक्षित सुरक्षा गाइड" : "Reviewed safety guide"} →</a>
      </section>
      <LiveUpdates language={language} initial={records} />
      <section className="two-column">
        <div>
          <div className="section-heading">
            <p className="eyebrow">{hindi ? "मुख्य माँगें" : "Core demands"}</p>
            <a className="text-link" href={hindi ? "/hi/demands" : "/demands"}>{hindi ? "ट्रैकर खोलें" : "Open tracker"} →</a>
          </div>
          {demandItems.map((demand, index) => (
            <article className="lined-item" key={demand.id}>
              <span className="index">{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{demand.text}</h3><p>{hindi ? "संस्करण" : "Version"} {demand.version} · {formatDate(demand.approvedAt, language)}</p></div>
            </article>
          ))}
        </div>
        <div className="quick-links">
          <p className="eyebrow">{hindi ? "त्वरित पहुँच" : "Quick access"}</p>
          <a href={hindi ? "/hi/legal" : "/legal"}><span>{hindi ? "कानूनी तैयारी" : "Legal preparation"}</span><strong>→</strong></a>
          <a href={hindi ? "/hi/hall-of-shame" : "/hall-of-shame"}><span>{hindi ? "जवाबदेही अभिलेख" : "Accountability archive"}</span><strong>→</strong></a>
          <a href={hindi ? "/hi/receipts" : "/receipts"}><span>{hindi ? "सत्यापित रसीदें साझा करें" : "Share verified receipts"}</span><strong>→</strong></a>
          <a href={hindi ? "/hi/evidence" : "/evidence"}><span>{hindi ? "साक्ष्य नीति" : "Evidence policy"}</span><strong>→</strong></a>
          <a href={hindi ? "/hi/corrections" : "/corrections"}><span>{hindi ? "सुधार लॉग" : "Correction log"}</span><strong>→</strong></a>
        </div>
      </section>
    </>
  );
}

function UpdatesPage({ language }: { language: Language }) {
  return (
    <>
      <PageHeader language={language} kind="updates" intro={language === "hi" ? "प्रकाशन, घटना और समाप्ति समय के साथ स्रोतयुक्त रिकॉर्ड। लाइव फ़ीड हर 30 सेकंड में नई प्रकाशित प्रति जाँचती है।" : "Sourced records with event, publication, and expiry times. The live feed checks for a newly published copy every 30 seconds."} />
      <StatusKey language={language} />
      <LiveUpdates language={language} initial={forLanguage(updates, language)} />
    </>
  );
}

function DemandsPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="demands" intro={hindi ? "केवल आयोजक-स्वीकृत माँगें और उनके स्रोत यहाँ प्रकाशित होते हैं।" : "Only organiser-approved demands and their sources are published here."} />
      <div className="stack">
        {forLanguage(demands, language).map((demand) => (
          <article className="record" key={demand.id}>
            <p className="eyebrow">{hindi ? "माँग" : "Demand"} · {demand.version}</p>
            <h2>{demand.text}</h2>
            <dl className="metadata"><div><dt>{hindi ? "स्वीकृतकर्ता" : "Approved by"}</dt><dd>{demand.approvedBy}</dd></div><div><dt>{hindi ? "तारीख" : "Date"}</dt><dd>{formatDate(demand.approvedAt, language)}</dd></div><div><dt>{hindi ? "स्रोत" : "Source"}</dt><dd>{demand.sources[0].label} [{demand.sources[0].tier}]</dd></div></dl>
          </article>
        ))}
      </div>
      <section className="responses-section">
        <p className="eyebrow">{hindi ? "सरकारी प्रतिक्रियाएँ" : "Government responses"}</p>
        <div className="stack">
          {forLanguage(governmentResponses, language).map((response) => (
            <article className="record response-record" key={response.id}>
              <span className="badge badge-corroborating">{hindi ? "प्रतिक्रिया" : "response"}</span>
              <h2>{response.title}</h2>
              <p>{response.summary}</p>
              <dl className="metadata">
                <div><dt>{hindi ? "प्राधिकरण" : "Authority"}</dt><dd>{response.authority}</dd></div>
                <div><dt>{hindi ? "जारी" : "Issued"}</dt><dd>{formatDate(response.issuedAt, language)}</dd></div>
                <div><dt>{hindi ? "स्रोत" : "Source"}</dt><dd><a href={response.source.url}>{response.source.label} [{response.source.tier}]</a></dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function TimelinePage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="timeline" intro={hindi ? "राय या अनुमान के बिना सत्यापित घटनाओं का क्रम।" : "A factual sequence of verified events, without opinion or speculation."} />
      <ol className="timeline">
        {forLanguage(timeline, language).map((item) => (
          <li key={item.id}><time>{formatDate(item.date, language)}</time><div><span className={`badge badge-${item.status}`}>{item.status}</span><h2>{item.title}</h2><p>{item.summary}</p><small>{item.sources[0].label} [{item.sources[0].tier}]</small></div></li>
        ))}
      </ol>
    </>
  );
}

function SafetyPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  const items = hindi
    ? [
        ["जाने से पहले", "किसी विश्वसनीय व्यक्ति को अपनी योजना बताएँ, आवश्यक दवाएँ और पानी रखें, और पहचान साझा करने के जोखिम पर विचार करें।"],
        ["सूचना की जाँच", "फॉरवर्ड किए गए संदेश पर अकेले भरोसा न करें। समय, स्रोत और सुधार लॉग की जाँच करें।"],
        ["यदि स्थिति बदलती है", "अपनी सुरक्षा को प्राथमिकता दें। लाइव भीड़ या पुलिस की स्थिति इस साइट पर साझा न करें।"],
        ["मीडिया और सहमति", "घायल, हिरासत में लिए गए या नाबालिग लोगों की पहचान बिना स्पष्ट अनुमति प्रकाशित न करें।"],
      ]
    : [
        ["Before you go", "Tell a trusted person your plan, carry essential medication and water, and consider the risks of sharing identifying information."],
        ["Check information", "Do not rely on a forwarded message alone. Check its time, source tier, and the correction log."],
        ["If conditions change", "Prioritise your safety. Do not post live crowd or police positions to this site."],
        ["Media and consent", "Do not publish the identities of injured, detained, or under-age people without explicit approval."],
      ];
  return (
    <>
      <PageHeader language={language} kind="safety" intro={hindi ? "सामान्य तैयारी सूचना; चिकित्सा या कानूनी सलाह नहीं। अंतिम संपादकीय समीक्षा: 23 जुलाई 2026। पुनः समीक्षा: 23 अगस्त 2026।" : "General preparation information, not medical or legal advice. Last editorial review: 23 July 2026. Review again by: 23 August 2026."} />
      <div className="guide-grid">{items.map(([title, body], i) => <article className="guide" key={title}><span>{String(i + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{body}</p></article>)}</div>
      <div className="notice">{hindi ? "तत्काल खतरे में स्थानीय आपातकालीन सेवाओं से संपर्क करें। इस साइट पर किसी व्यक्ति का सटीक स्थान न भेजें।" : "In immediate danger, contact local emergency services. Do not send anyone’s precise location to this site."}</div>
    </>
  );
}

function LegalPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="legal" intro={hindi ? "शहर-विशिष्ट कानूनी सहायता को प्रकाशन से पहले स्थानीय वकील द्वारा सत्यापित किया जाना चाहिए। यह नमूना कानूनी सलाह नहीं है।" : "City-specific legal support must be verified by a local lawyer before publication. This demonstration is not legal advice."} />
      <div className="record">
        <p className="eyebrow">{hindi ? "प्रकाशन जाँच-सूची" : "Publication checklist"}</p>
        <h2>{hindi ? "किसी कानूनी संसाधन को जोड़ने से पहले" : "Before adding a legal resource"}</h2>
        <ul className="check-list">
          <li>{hindi ? "वकील या आधिकारिक संस्था का नाम और अधिकार क्षेत्र सत्यापित करें।" : "Verify the lawyer or official body and its jurisdiction."}</li>
          <li>{hindi ? "स्रोत, समीक्षा तिथि और समाप्ति तिथि दर्ज करें।" : "Record the source, review date, and expiry date."}</li>
          <li>{hindi ? "केवल सार्वजनिक और स्वीकृत संपर्क विवरण प्रकाशित करें।" : "Publish only public, approved contact details."}</li>
          <li>{hindi ? "पुरानी या विवादित सलाह को तुरंत चिह्नित करें।" : "Flag outdated or disputed guidance immediately."}</li>
        </ul>
      </div>
    </>
  );
}

function ReadingRoomPage({ language }: { language: Language }) {
  return (
    <>
      <PageHeader language={language} kind="reading-room" intro={language === "hi" ? "मूल दस्तावेज़, आधिकारिक नोटिस और स्पष्ट रूप से लेबल की गई टिप्पणी।" : "Original documents, official notices, and clearly labelled commentary."} />
      <div className="stack">{forLanguage(readingRoom, language).map((item) => <a className="document-row" href={item.href} key={item.id}><span className="document-kind">{item.kind}</span><span><strong>{item.title}</strong><small>{item.summary}</small></span><b>→</b></a>)}</div>
    </>
  );
}

function CorrectionsPage({ language }: { language: Language }) {
  const records = forLanguage(corrections, language);
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="corrections" intro={hindi ? "दावों में हर महत्वपूर्ण परिवर्तन का दृश्यमान, स्थायी रिकॉर्ड।" : "A visible, permanent record of material changes to published claims."} />
      {records.length ? records.map((item) => <article className="record" key={item.id}><h2>{item.targetId}</h2><p>{item.reason}</p></article>) : <div className="empty-state"><span>0</span><h2>{hindi ? "अभी तक कोई सुधार या वापसी नहीं" : "No corrections or retractions yet"}</h2><p>{hindi ? "पहला स्वीकृत सुधार यहाँ समय और कारण के साथ दिखाई देगा।" : "The first approved correction will appear here with its time and reason."}</p></div>}
    </>
  );
}

function EvidencePage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="evidence" intro={hindi ? "v1 में संवेदनशील साक्ष्य जमा करने की सुविधा उपलब्ध नहीं है।" : "Sensitive evidence intake is not available in v1."} />
      <div className="evidence-block">
        <span className="lock-mark" aria-hidden="true">×</span>
        <div><h2>{hindi ? "यहाँ कोई फ़ाइल अपलोड नहीं की जा सकती" : "No files can be uploaded here"}</h2><p>{hindi ? "भविष्य की साक्ष्य प्रणाली सार्वजनिक वेबसाइट से अलग होनी चाहिए। कोई भी इंटरनेट प्रणाली पूर्ण गुमनामी की गारंटी नहीं दे सकती। मूल साक्ष्य को पहचान-मुक्त सार्वजनिक प्रतियों से अलग सुरक्षित रखें।" : "Any future evidence system must be separate from the public website. No internet submission system can guarantee complete anonymity. Preserve original evidence separately from redacted public copies."}</p></div>
      </div>
    </>
  );
}

function OfflinePage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="offline" intro={hindi ? "पहली यात्रा के बाद आवश्यक पृष्ठों की एक प्रति इस उपकरण पर रखी जाती है।" : "After a first visit, a copy of essential pages is kept on this device."} />
      <div className="download-grid">
        <a className="download" href="/offline-pack/field-pack-en.pdf"><span>PDF · EN</span><strong>Field pack — English</strong><small>Safety, verification, and documentation checklist</small></a>
        <a className="download" href="/offline-pack/field-pack-hi.pdf"><span>PDF · HI</span><strong>फील्ड पैक — हिंदी</strong><small>सुरक्षा, सत्यापन और दस्तावेज़ीकरण जाँच-सूची</small></a>
      </div>
      <div className="notice">{hindi ? "ऑफलाइन प्रति पुरानी हो सकती है। उपयोग करने से पहले “अंतिम जाँच” समय देखें।" : "An offline copy can become stale. Check the “last checked” time before relying on it."}</div>
    </>
  );
}

function HallOfShamePage({ language }: { language: Language }) {
  const hindi = language === "hi";
  const records = forLanguage(media, language);
  return (
    <>
      <PageHeader language={language} kind="hall-of-shame" intro={hindi ? "सत्यापित, पहचान-मुक्त और कानूनी रूप से समीक्षित सार्वजनिक मीडिया का जवाबदेही अभिलेख। यह लाइव घटना फ़ीड नहीं है।" : "An accountability archive for verified, redacted, and legally reviewed public media. This is not a live incident feed."} />
      <div className="archive-rules">
        <p className="eyebrow">{hindi ? "प्रकाशन सीमा" : "Publication threshold"}</p>
        <ul className="check-list">
          <li>{hindi ? "मूल फ़ाइल निजी अभिलेख में सुरक्षित है।" : "The original file is preserved in a private archive."}</li>
          <li>{hindi ? "चेहरे, नंबर प्लेट और संवेदनशील पहचान हटाई गई हैं।" : "Faces, number plates, and sensitive identifiers are redacted."}</li>
          <li>{hindi ? "तारीख और व्यापक क्षेत्र कम से कम दो स्रोतों से सत्यापित हैं।" : "Date and broad zone are corroborated by at least two sources."}</li>
          <li>{hindi ? "कानूनी समीक्षा और दो संपादकीय स्वीकृतियाँ दर्ज हैं।" : "Legal review and two editorial approvals are recorded."}</li>
        </ul>
      </div>
      {records.length ? <div className="media-grid">{records.map((item) => <article className="media-record" key={item.id}><video controls preload="metadata" poster={item.poster}><source src={item.file} /></video><span className={`badge badge-${item.status}`}>{item.status}</span><h2>{item.title}</h2><p>{item.summary}</p><small>{item.broadZone} · {formatDate(item.date, language)}</small></article>)}</div> : <div className="empty-state"><span>0</span><h2>{hindi ? "अभी कोई सार्वजनिक मीडिया रिकॉर्ड नहीं" : "No public media records yet"}</h2><p>{hindi ? "आपके निजी ड्राइव के वीडियो को सीधे सार्वजनिक नहीं किया जाएगा। पहले निजी आयात, सत्यापन, पहचान-मुक्ति और कानूनी समीक्षा होगी।" : "Videos from your private drive will not be published directly. They first go through private import, verification, redaction, and legal review."}</p></div>}
      <div className="process-strip"><span>1. {hindi ? "निजी आयात" : "Private import"}</span><span>2. {hindi ? "सत्यापन" : "Verify"}</span><span>3. {hindi ? "पहचान हटाएँ" : "Redact"}</span><span>4. {hindi ? "समीक्षा" : "Review"}</span><span>5. {hindi ? "प्रकाशित" : "Publish"}</span></div>
    </>
  );
}

function ReceiptsPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  const records = forLanguage(updates, language).slice(0, 3);
  return (
    <>
      <PageHeader
        language={language}
        kind="receipts"
        intro={
          hindi
            ? "छोटे, स्रोतयुक्त तथ्य कार्ड साझा करें। हर रसीद में स्थिति, समय और स्रोत रहता है—न कोई लाइव स्थान, न भड़काऊ अपुष्ट दावा।"
            : "Share compact, sourced fact cards. Every receipt keeps its status, time, and source—without live locations or inflammatory unverified claims."
        }
      />
      <div className="viral-note">
        <p className="eyebrow">{hindi ? "वायरल, लेकिन सत्यापित" : "Viral, but verifiable"}</p>
        <h2>{hindi ? "दावे को नहीं, रसीद को बढ़ाएँ।" : "Amplify the receipt, not just the claim."}</h2>
        <p>{hindi ? "साझा बटन मोबाइल शेयर शीट खोलता है; अन्य उपकरणों पर स्रोतयुक्त पाठ कॉपी करता है।" : "The share button opens the mobile share sheet; on other devices it copies a source-rich text receipt."}</p>
      </div>
      <div className="receipt-grid">
        {records.map((item) => (
          <article className="receipt-card" key={item.id}>
            <div className="receipt-topline">
              <span>THE INDIA PROJECT</span>
              <span className={`badge badge-${item.status}`}>{item.status}</span>
            </div>
            <h2>{item.title}</h2>
            <p>{item.summary}</p>
            <dl>
              <div><dt>{hindi ? "प्रकाशित" : "Published"}</dt><dd>{formatDate(item.publishedAt, language)}</dd></div>
              <div><dt>{hindi ? "स्रोत" : "Source"}</dt><dd>{item.sources[0].label}</dd></div>
            </dl>
            <ShareReceipt
              language={language}
              title={item.title}
              summary={item.summary}
              status={item.status}
              publishedAt={item.publishedAt}
              source={item.sources[0].label}
            />
          </article>
        ))}
      </div>
    </>
  );
}

function EditorialStandardPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <>
      <PageHeader language={language} kind="editorial-standard" intro={hindi ? "यह मानक हर प्रकाशित दावे और मीडिया रिकॉर्ड पर लागू होता है।" : "This standard applies to every published claim and media record."} />
      <div className="standard-grid">
        {[
          [hindi ? "A" : "A", hindi ? "अदालत, सरकार, आधिकारिक आयोजक या मूल दस्तावेज़" : "Court, government, official organiser, or original document"],
          ["B", hindi ? "प्रतिष्ठित समाचार संस्था या नामित पत्रकार" : "Reputable news organisation or named journalist"],
          ["C", hindi ? "स्वीकृत स्वयंसेवक, वकील, डॉक्टर या पर्यवेक्षक" : "Approved volunteer, lawyer, doctor, or observer"],
          ["D", hindi ? "गुमनाम सार्वजनिक रिपोर्ट" : "Anonymous public report"],
          ["E", hindi ? "वायरल पोस्ट या फॉरवर्ड संदेश" : "Viral post or forwarded message"],
        ].map(([tier, text]) => <article key={tier}><strong>{tier}</strong><p>{text}</p></article>)}
      </div>
      <div className="notice">{hindi ? "उच्च संवेदनशीलता वाले रिकॉर्ड के लिए कम से कम दो समीक्षक आवश्यक हैं। D या E स्रोत अकेले किसी रिकॉर्ड को सत्यापित नहीं बना सकता।" : "High-sensitivity records require at least two reviewers. A tier D or E source cannot independently make a record verified."}</div>
    </>
  );
}

function TextPage({ language }: { language: Language }) {
  const hindi = language === "hi";
  return (
    <div className="text-only">
      <h1>{titles[language].text}</h1>
      <p>{hindi ? "स्थिति: परीक्षा जवाबदेही आंदोलन जारी; केवल सत्यापित व्यापक-क्षेत्र अपडेट।" : "Status: exam-accountability movement continues; verified broad-zone updates only."}</p>
      <h2>{hindi ? "नवीनतम अपडेट" : "Latest updates"}</h2>
      {forLanguage(updates, language).map((item) => <article key={item.id}><h3>{item.title}</h3><p>{item.summary}</p><p>{item.status} · {item.city} · {formatDate(item.publishedAt, language)}</p></article>)}
      <p><a href={hindi ? "/hi" : "/"}>{hindi ? "पूर्ण साइट पर लौटें" : "Return to full site"}</a></p>
    </div>
  );
}

export function PublicPage({
  language,
  kind,
}: {
  language: Language;
  kind: PageKind;
}) {
  if (kind === "text") return <TextPage language={language} />;

  let content: React.ReactNode;
  switch (kind) {
    case "home": content = <Home language={language} />; break;
    case "updates": content = <UpdatesPage language={language} />; break;
    case "demands": content = <DemandsPage language={language} />; break;
    case "timeline": content = <TimelinePage language={language} />; break;
    case "safety": content = <SafetyPage language={language} />; break;
    case "legal": content = <LegalPage language={language} />; break;
    case "reading-room": content = <ReadingRoomPage language={language} />; break;
    case "corrections": content = <CorrectionsPage language={language} />; break;
    case "evidence": content = <EvidencePage language={language} />; break;
    case "offline": content = <OfflinePage language={language} />; break;
    case "hall-of-shame": content = <HallOfShamePage language={language} />; break;
    case "receipts": content = <ReceiptsPage language={language} />; break;
    case "editorial-standard": content = <EditorialStandardPage language={language} />; break;
  }
  return <SiteShell language={language}><div className="page-shell">{content}</div></SiteShell>;
}

// Broad capabilities, deliberately phrased as what somebody can do rather than
// which team they join. Volunteers pick as many as apply; assigning a team from
// these answers is an editorial decision made later in the admin workspace.
export const volunteerCapabilities = [
  "translation",
  "writing",
  "research",
  "design",
  "technical",
  "outreach",
  "accessibility",
  "legal",
  "medical",
  "wellbeing",
  "on-ground",
  "funding",
] as const;

export type VolunteerCapability = (typeof volunteerCapabilities)[number];

export const volunteerCapabilityLabels: Record<
  string,
  { en: string; hi: string }
> = {
  translation: { en: "Translation and interpreting", hi: "अनुवाद और दुभाषिया" },
  writing: { en: "Writing and editing", hi: "लेखन और संपादन" },
  research: { en: "Research and fact-checking", hi: "शोध और तथ्य-जाँच" },
  design: { en: "Design and illustration", hi: "डिज़ाइन और चित्रांकन" },
  technical: { en: "Software, data, and security", hi: "सॉफ़्टवेयर, डेटा और सुरक्षा" },
  outreach: { en: "Social media and outreach", hi: "सोशल मीडिया और प्रचार" },
  accessibility: {
    en: "Accessibility and low-bandwidth support",
    hi: "सुगम्यता और कम-बैंडविड्थ सहायता",
  },
  legal: { en: "Legal knowledge", hi: "कानूनी जानकारी" },
  medical: { en: "Medical or first-aid training", hi: "चिकित्सा या प्राथमिक उपचार प्रशिक्षण" },
  wellbeing: { en: "Counselling and peer support", hi: "परामर्श और साथी सहयोग" },
  "on-ground": { en: "On-the-ground help in my city", hi: "मेरे शहर में ज़मीनी मदद" },
  funding: { en: "Funding or material support", hi: "आर्थिक या सामग्री सहायता" },
  // Retained so that records captured before the capability list was broadened
  // still read correctly in the admin workspace.
  "source-review": { en: "Source and timestamp review", hi: "स्रोत और समय की समीक्षा" },
  editorial: { en: "Editorial support", hi: "संपादकीय सहायता" },
  "tech-team": { en: "Join the tech team", hi: "टेक टीम से जुड़ें" },
};

export function volunteerCapabilityLabel(
  capability: string,
  language: "en" | "hi" = "en",
) {
  return volunteerCapabilityLabels[capability]?.[language] ?? capability;
}

// Volunteer teams mirror the roles used in the organising Discord. Nothing on
// the public form asks for one; they are assigned from the capabilities above.
export const volunteerTeams = [
  "comms",
  "tech",
  "field",
  "designers",
  "writers",
  "researchers",
  "legal",
  "medical",
  "mental-health",
  "donor",
] as const;

export type VolunteerTeam = (typeof volunteerTeams)[number];

export const volunteerTeamLabels: Record<
  VolunteerTeam,
  { en: string; hi: string; emoji: string }
> = {
  comms: { en: "Comms", hi: "संचार", emoji: "📢" },
  tech: { en: "Tech", hi: "तकनीक", emoji: "💻" },
  field: { en: "Field", hi: "फ़ील्ड", emoji: "🌊" },
  designers: { en: "Designers", hi: "डिज़ाइनर", emoji: "🎨" },
  writers: { en: "Writers", hi: "लेखक", emoji: "✍️" },
  researchers: { en: "Researchers", hi: "शोधकर्ता", emoji: "👀" },
  legal: { en: "Legal", hi: "कानूनी", emoji: "⚖️" },
  medical: { en: "Medical", hi: "चिकित्सा", emoji: "🩺" },
  "mental-health": { en: "Mental health", hi: "मानसिक स्वास्थ्य", emoji: "💗" },
  donor: { en: "Donor", hi: "दानदाता", emoji: "🎁" },
};

export function volunteerTeamLabel(team: string, language: "en" | "hi" = "en") {
  const entry = volunteerTeamLabels[team as VolunteerTeam];
  return entry ? `${entry.emoji} ${entry[language]}` : team;
}

import { volunteerTeams } from "../lib/volunteers";

export type VolunteerFilterRecord = {
  name: string;
  email: string;
  contactPlatform: string;
  contactHandle: string;
  city: string;
  team: string;
  skills: string[];
  languages: string[];
  availability: string;
  note: string;
  internalNotes: string;
  language: string;
  status: string;
  createdAt: string;
};

export type VolunteerFilterState = {
  query: string;
  status: string;
  platform: string;
  team: string;
  city: string;
  skill: string;
  spokenLanguage: string;
  formLanguage: string;
  sort: string;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterVolunteers<T extends VolunteerFilterRecord>(
  volunteers: T[],
  filters: VolunteerFilterState,
) {
  const normalizedQuery = normalizeSearchValue(filters.query);

  const matches = volunteers.filter((volunteer) => {
    if (filters.status !== "all" && volunteer.status !== filters.status) return false;
    if (
      filters.platform !== "all" &&
      volunteer.contactPlatform !== filters.platform
    ) {
      return false;
    }
    if (filters.team !== "all" && volunteer.team !== filters.team) return false;
    if (filters.city !== "all" && volunteer.city !== filters.city) return false;
    if (filters.skill !== "all" && !volunteer.skills.includes(filters.skill)) {
      return false;
    }
    if (
      filters.spokenLanguage !== "all" &&
      !volunteer.languages.includes(filters.spokenLanguage)
    ) {
      return false;
    }
    if (
      filters.formLanguage !== "all" &&
      volunteer.language !== filters.formLanguage
    ) {
      return false;
    }

    const searchableText = [
      volunteer.name,
      volunteer.email,
      volunteer.contactPlatform,
      volunteer.contactHandle,
      volunteer.city,
      volunteer.team,
      ...volunteer.skills,
      ...volunteer.languages,
      volunteer.availability,
      volunteer.note,
      volunteer.internalNotes,
    ]
      .map(normalizeSearchValue)
      .join(" ");

    return !normalizedQuery || searchableText.includes(normalizedQuery);
  });

  const text = (value: string) => value ?? "";
  const teamRank = (team: string) => {
    const index = volunteerTeams.indexOf(team as (typeof volunteerTeams)[number]);
    return index === -1 ? volunteerTeams.length : index;
  };
  const statusOrder = ["new", "contacted", "accepted", "declined", "archived"];
  const compare: Record<string, (a: T, b: T) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    "name-asc": (a, b) => text(a.name).localeCompare(text(b.name)),
    "name-desc": (a, b) => text(b.name).localeCompare(text(a.name)),
    "email-asc": (a, b) => text(a.email).localeCompare(text(b.email)),
    "email-desc": (a, b) => text(b.email).localeCompare(text(a.email)),
    "city-asc": (a, b) => text(a.city).localeCompare(text(b.city)),
    "team-asc": (a, b) => teamRank(a.team) - teamRank(b.team),
    "availability-asc": (a, b) =>
      text(a.availability).localeCompare(text(b.availability)),
    "platform-asc": (a, b) =>
      text(a.contactPlatform).localeCompare(text(b.contactPlatform)),
    status: (a, b) =>
      statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status),
  };

  return [...matches].sort(compare[filters.sort] ?? compare.newest);
}

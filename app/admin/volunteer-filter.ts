export type VolunteerFilterRecord = {
  name: string;
  email: string;
  contactPlatform: string;
  contactHandle: string;
  skills: string[];
  languages: string[];
  availability: string;
  note: string;
  internalNotes: string;
  status: string;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterVolunteers<T extends VolunteerFilterRecord>(
  volunteers: T[],
  query: string,
  status: string,
) {
  const normalizedQuery = normalizeSearchValue(query);

  return volunteers.filter((volunteer) => {
    if (status !== "all" && volunteer.status !== status) return false;
    if (!normalizedQuery) return true;

    const searchableText = [
      volunteer.name,
      volunteer.email,
      volunteer.contactPlatform,
      volunteer.contactHandle,
      ...volunteer.skills,
      ...volunteer.languages,
      volunteer.availability,
      volunteer.note,
      volunteer.internalNotes,
    ]
      .map(normalizeSearchValue)
      .join(" ");

    return searchableText.includes(normalizedQuery);
  });
}

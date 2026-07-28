import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterVolunteers,
  type VolunteerFilterRecord,
  type VolunteerFilterState,
} from "../app/admin/volunteer-filter";

type TestVolunteer = VolunteerFilterRecord & { id: string };

const volunteers: TestVolunteer[] = [
  {
    id: "new",
    name: "Asha Rao",
    email: "asha@example.test",
    contactPlatform: "telegram",
    contactHandle: "@asha",
    city: "Bengaluru",
    team: "",
    skills: ["source-review", "research"],
    languages: ["English", "Hindi"],
    availability: "Tuesday evenings",
    note: "Can review public records.",
    internalNotes: "Follow up after orientation.",
    language: "en",
    status: "new",
    createdAt: "2026-07-28T05:00:00.000Z",
  },
  {
    id: "contacted",
    name: "Bilal Khan",
    email: "bilal@example.test",
    contactPlatform: "whatsapp",
    contactHandle: "+91 555 0102",
    city: "New Delhi",
    team: "comms",
    skills: ["translation"],
    languages: ["Urdu"],
    availability: "Weekends",
    note: "Experienced community translator.",
    internalNotes: "Sent the onboarding guide.",
    language: "hi",
    status: "contacted",
    createdAt: "2026-07-28T04:00:00.000Z",
  },
  {
    id: "accepted",
    name: "Chitra Menon",
    email: "chitra@example.test",
    contactPlatform: "discord",
    contactHandle: "chitra_dev",
    city: "Kochi",
    team: "tech",
    skills: ["tech-team", "technical"],
    languages: ["Malayalam"],
    availability: "Four hours weekly",
    note: "Frontend accessibility experience.",
    internalNotes: "Accepted for the web team.",
    language: "en",
    status: "accepted",
    createdAt: "2026-07-28T03:00:00.000Z",
  },
  {
    id: "declined",
    name: "Dev Patel",
    email: "dev@example.test",
    contactPlatform: "telegram",
    contactHandle: "@dev",
    city: "Ahmedabad",
    team: "designers",
    skills: ["design"],
    languages: ["Gujarati"],
    availability: "Mornings",
    note: "Can prepare social graphics.",
    internalNotes: "No current design opening.",
    language: "en",
    status: "declined",
    createdAt: "2026-07-28T02:00:00.000Z",
  },
  {
    id: "archived",
    name: "Esha Singh",
    email: "esha@example.test",
    contactPlatform: "whatsapp",
    contactHandle: "+91 555 0105",
    city: "Chandigarh",
    team: "legal",
    skills: ["legal-review", "legal"],
    languages: ["Punjabi"],
    availability: "Monthly",
    note: "Offers legal source review.",
    internalNotes: "Archived after retention review.",
    language: "hi",
    status: "archived",
    createdAt: "2026-07-28T01:00:00.000Z",
  },
];

const defaultFilters: VolunteerFilterState = {
  query: "",
  status: "all",
  platform: "all",
  team: "all",
  city: "all",
  skill: "all",
  spokenLanguage: "all",
  formLanguage: "all",
  sort: "newest",
};

function ids(filters: Partial<VolunteerFilterState> = {}) {
  return filterVolunteers(volunteers, { ...defaultFilters, ...filters }).map(
    (volunteer) => volunteer.id,
  );
}

test("searches every administrator-visible volunteer field", () => {
  const cases = [
    ["Asha Rao", "new"],
    ["bilal@example.test", "contacted"],
    ["discord", "accepted"],
    ["chitra_dev", "accepted"],
    ["Bengaluru", "new"],
    ["comms", "contacted"],
    ["source-review", "new"],
    ["Malayalam", "accepted"],
    ["Tuesday evenings", "new"],
    ["community translator", "contacted"],
    ["retention review", "archived"],
  ];

  for (const [query, expectedId] of cases) {
    assert.deepEqual(ids({ query }), [expectedId], query);
  }
});

test("normalizes query casing and surrounding whitespace", () => {
  assert.deepEqual(ids({ query: "   ASHA   " }), ["new"]);
  assert.deepEqual(ids({ query: "  FRONTEND ACCESSIBILITY  " }), ["accepted"]);
});

test("combines every fixed filter", () => {
  assert.deepEqual(
    ids({
      status: "contacted",
      platform: "whatsapp",
      team: "comms",
      city: "New Delhi",
      skill: "translation",
      spokenLanguage: "Urdu",
      formLanguage: "hi",
    }),
    ["contacted"],
  );
  assert.deepEqual(ids({ city: "New Delhi", skill: "technical" }), []);
});

test("keeps legacy capabilities searchable and filterable", () => {
  assert.deepEqual(ids({ skill: "source-review" }), ["new"]);
  assert.deepEqual(ids({ skill: "tech-team" }), ["accepted"]);
});

test("sorts dates, text fields, teams, and status pipeline order", () => {
  assert.deepEqual(ids({ sort: "oldest" }), [
    "archived",
    "declined",
    "accepted",
    "contacted",
    "new",
  ]);
  assert.deepEqual(ids({ sort: "name-desc" }), [
    "archived",
    "declined",
    "accepted",
    "contacted",
    "new",
  ]);
  assert.deepEqual(ids({ sort: "city-asc" }), [
    "declined",
    "new",
    "archived",
    "accepted",
    "contacted",
  ]);
  assert.deepEqual(ids({ sort: "team-asc" }), [
    "contacted",
    "accepted",
    "declined",
    "archived",
    "new",
  ]);
  assert.deepEqual(ids({ sort: "status" }), [
    "new",
    "contacted",
    "accepted",
    "declined",
    "archived",
  ]);
});

test("returns no matches for an unknown query", () => {
  assert.deepEqual(ids({ query: "no such volunteer" }), []);
});

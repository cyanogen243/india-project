import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterVolunteers,
  type VolunteerFilterRecord,
} from "../app/admin/volunteer-filter";

type TestVolunteer = VolunteerFilterRecord & { id: string };

const volunteers: TestVolunteer[] = [
  {
    id: "new",
    name: "Asha Rao",
    email: "asha@example.test",
    contactPlatform: "telegram",
    contactHandle: "@asha",
    skills: ["source-review"],
    languages: ["English", "Hindi"],
    availability: "Tuesday evenings",
    note: "Can review public records.",
    internalNotes: "Follow up after orientation.",
    status: "new",
  },
  {
    id: "contacted",
    name: "Bilal Khan",
    email: "bilal@example.test",
    contactPlatform: "whatsapp",
    contactHandle: "+91 555 0102",
    skills: ["translation"],
    languages: ["Urdu"],
    availability: "Weekends",
    note: "Experienced community translator.",
    internalNotes: "Sent the onboarding guide.",
    status: "contacted",
  },
  {
    id: "accepted",
    name: "Chitra Menon",
    email: "chitra@example.test",
    contactPlatform: "discord",
    contactHandle: "chitra_dev",
    skills: ["tech-team"],
    languages: ["Malayalam"],
    availability: "Four hours weekly",
    note: "Frontend accessibility experience.",
    internalNotes: "Accepted for the web team.",
    status: "accepted",
  },
  {
    id: "declined",
    name: "Dev Patel",
    email: "dev@example.test",
    contactPlatform: "telegram",
    contactHandle: "@dev",
    skills: ["design"],
    languages: ["Gujarati"],
    availability: "Mornings",
    note: "Can prepare social graphics.",
    internalNotes: "No current design opening.",
    status: "declined",
  },
  {
    id: "archived",
    name: "Esha Singh",
    email: "esha@example.test",
    contactPlatform: "whatsapp",
    contactHandle: "+91 555 0105",
    skills: ["legal-review"],
    languages: ["Punjabi"],
    availability: "Monthly",
    note: "Offers legal source review.",
    internalNotes: "Archived after retention review.",
    status: "archived",
  },
];

function ids(query = "", status = "all") {
  return filterVolunteers(volunteers, query, status).map(
    (volunteer) => volunteer.id,
  );
}

test("searches every administrator-visible volunteer field", () => {
  const cases = [
    ["Asha Rao", "new"],
    ["bilal@example.test", "contacted"],
    ["discord", "accepted"],
    ["chitra_dev", "accepted"],
    ["source-review", "new"],
    ["Malayalam", "accepted"],
    ["Tuesday evenings", "new"],
    ["community translator", "contacted"],
    ["retention review", "archived"],
  ];

  for (const [query, expectedId] of cases) {
    assert.deepEqual(ids(query), [expectedId], query);
  }
});

test("normalizes query casing and surrounding whitespace", () => {
  assert.deepEqual(ids("   ASHA   "), ["new"]);
  assert.deepEqual(ids("  FRONTEND ACCESSIBILITY  "), ["accepted"]);
});

test("filters every supported status exactly", () => {
  for (const status of ["new", "contacted", "accepted", "declined", "archived"]) {
    assert.deepEqual(ids("", status), [status], status);
  }
});

test("combines search and status filters", () => {
  assert.deepEqual(ids("telegram", "new"), ["new"]);
  assert.deepEqual(ids("telegram", "declined"), ["declined"]);
  assert.deepEqual(ids("telegram", "accepted"), []);
});

test("returns no matches for an unknown query", () => {
  assert.deepEqual(ids("no such volunteer"), []);
});

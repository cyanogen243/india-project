# RCA: Admin volunteer search and status filter

**Date:** 2026-07-28

**Status:** Resolved locally and verified

**Affected area:** Protected admin workspace, Volunteers tab

## Summary

Administrators reported that volunteer search and status filtering did not
visibly update the volunteer list. The latest implementation performed all
matching inline in the React component, covered only a subset of the
administrator-visible fields, relied on implicit option values, and provided no
result count or empty state.

The API and database path were not the source of the issue. The admin API
returned the required volunteer fields, and the existing isolated integration
suite passed. The defect escaped because existing tests covered volunteer
creation, retrieval, and updates but did not exercise the search or status
controls.

## Root cause

The search/filter behavior had no explicit, testable contract. Matching logic
was embedded in the component and was not covered by unit or browser
interaction tests. The UI also gave no confirmation when filtering produced a
smaller or empty result set, making correct zero-result behavior
indistinguishable from a non-responsive control.

## Resolution

- Extracted volunteer matching into a dedicated helper.
- Normalized trimmed, case-insensitive queries.
- Expanded search to every volunteer field visible to administrators.
- Made status option values explicit and preserved exact status matching.
- Added combined search-and-status behavior, result counts, and a no-match
  state.
- Added unit coverage for all searchable fields, every supported status,
  normalization, combined filters, and no-match results.

## Verification and prevention

- The production build, TypeScript check, lint, five new unit tests, and six
  existing integration tests pass.
- The protected workflow was verified in a browser with synthetic volunteer
  records stored in a temporary local SQLite database.
- No production database credentials were loaded, and no production database,
  migration, API schema, or deployment was changed.
- Future volunteer search/filter changes must update the dedicated unit tests
  and retain visible result feedback.

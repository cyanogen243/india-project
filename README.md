# The India Project

The India Project is a bilingual, public-interest information hub for verified
student-movement and civic information in India.

**Safe. Verified. People Powered.**

The public site combines reviewed updates, demands, government responses,
timelines, safety material, corrections, trusted resources, offline packs, a
signed feed, and a privacy-conscious volunteer form. It does not publish live
locations, accept evidence files, or expose the private admin workspace.

## Local setup

Requirements: Node.js 24 and npm.

```sh
npm ci
copy .env.example .env.local
npm run db:setup
npm run admin:bootstrap
npm run dev
```

Open `http://localhost:3000`. The public site is at `/`, volunteer intake is at
`/volunteer`, and the protected workspace is at `/admin`.

`npm run dev` runs the idempotent database setup automatically. The standalone
default is `file:./data/the-india-project.db`; database files and secrets are
ignored.

The first `npm run admin:bootstrap` command prompts for a super-admin email,
display name, and password. It refuses to create a second initial super-admin.
The super-admin can create admins or additional super-admins in `/admin`.
Generated one-time passwords expire after 24 hours and must be changed at first
sign-in.

## Database and production configuration

The schema is defined in `db/schema.ts` and checked-in SQL migrations live in
`db/migrations/`. Runtime setup and content seeding are idempotent.

For hosted Turso/libSQL, set:

```text
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=...
SESSION_SECRET=...
RATE_LIMIT_SECRET=...
FEED_SIGNING_PRIVATE_KEY=...
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Use a different high-entropy value for each secret. Rotate a session secret by
replacing it and revoking sessions; rotate the rate-limit secret independently.
Changing the Ed25519 feed key changes the public verification identity, so
publish the corresponding new public key deliberately.

The editable database is seeded from the repository’s bilingual JSON records
and reviewed resource list. This makes a fresh clone useful without a cloud
account while allowing the same code to use hosted libSQL.

## Admin roles and workflows

- **Admin:** view and manage volunteer records; draft, edit, delete, and publish
  editorial collections.
- **Super-admin:** all admin permissions plus create, reset, enable, and disable
  users. The last active super-admin and the current user cannot be disabled.

All mutations create append-only audit events. Sessions are revocable, HttpOnly,
SameSite-strict cookies. Mutations require a session-bound CSRF token. Passwords
use salted PBKDF2-HMAC-SHA256 with 600,000 iterations, failed logins perform the
same derivation work for known and unknown accounts, and attempts are throttled.

Volunteer intake collects only a name or alias, email, skills, languages,
availability, a short note, and consent. It deliberately omits phone numbers,
IDs, files, and precise locations. Declined and archived records become cleanup
eligible after 180 days and can be explicitly deleted by an admin.

Editorial content is saved as drafts and published per collection. Existing
source tiers, bilingual parity, timestamps, reviewer requirements, unsafe HTML,
and precise-location restrictions are enforced again at publication.

Publishing the updates collection atomically creates a canonical Ed25519-signed
feed release. These stable interfaces remain available:

- `/feed/updates.json`
- `/feed/updates.sig`
- `/feed/public-key.txt`

Place a local signing key at `.private/feed-private.pem`, or set
`FEED_SIGNING_PRIVATE_KEY`. The committed static feed remains the read-only
fallback until a database release is published.

## Content freshness and external services

Every homepage and updates-page visit calls `/api/source-scan` without caching.
The browser repeats the scan every five minutes. Discovered headlines stay
labelled `review pending`; they never enter the verified feed automatically.

The CJP X timeline remains click-to-load and never enters the signed feed
automatically. The resources directory distinguishes official, established,
and community-built links. The Shutdown Kit is explicitly labelled as an
external community toolkit rather than a verified TIP service.

## Brand system

The supplied source guide is committed at
`docs/brand/TIP Brand Guidelines.pdf`. Approved logos are in `public/brand/`.
Anton and Inter are bundled through the open-source Fontsource packages, so no
runtime font request is made to Google.

Regenerate app icons from the approved primary mark with:

```sh
npm run build:brand
```

## Validation

```sh
npm run db:setup
npm run validate:content
npm run check:security
npm run typecheck
npm run lint
npm test
npm run test:sites
```

Deployment targets remain separate:

```sh
npm run build          # standard Next.js / Vercel
npm run build:sites    # OpenAI Sites / vinext
```

No deployment or push is part of the local review workflow.

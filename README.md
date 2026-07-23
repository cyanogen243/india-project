# The India Project

A bilingual, static-first public-interest information hub for verified student
movement updates in India. It publishes broad-zone updates, demands, government
responses, a factual timeline, safety material, source documents, corrections,
offline packs, signed feeds, and a reviewed-media archive.

The public site intentionally has no accounts, comments, analytics, cookies,
precise live-location tracking, tactical maps, or public evidence uploader.

## Run locally

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Validate and build

```sh
npm run validate:content
npm run build:feed
npm run check:security
npm run build
npm test
```

The build validates source tiers, timestamps, language parity, high-sensitivity
reviewer requirements, unsafe HTML, precise-location fields, and media review
metadata. It then verifies the committed Ed25519-signed feed in `public/feed/`.

Authorized editors can place the existing key at
`.private/feed-private.pem` or set `FEED_SIGNING_PRIVATE_KEY` to regenerate the
feed. The private directory is ignored by Git. Changing the key changes the
public verification identity.

## Editorial workflow

1. Edit structured records in `content/`.
2. Use broad zones only. Never add coordinates, precise addresses, or live
   positions of protesters, police, medics, organisers, or shelters.
3. Link every public claim to a source and access time.
4. Give high-sensitivity records at least two reviewers.
5. Add a correction record whenever a material published claim changes.
6. Run the complete build before review and publication.

The current records use publicly available reporting from the Associated Press,
Human Rights Watch, Akashvani News, NDTV, and The Indian Express. These records
must continue to be reviewed and expired as the situation changes.

## Private media review workflow

There is currently no public media-archive route or navigation entry.

Do not publish directly from a private Drive folder.

1. Import originals into a separate restricted archive.
2. Preserve originals and record custody metadata.
3. Verify date and broad zone using independent sources.
4. Redact faces, number plates, identifying audio, and sensitive details.
5. Obtain legal review and two editorial approvals.
6. Put only the approved public derivative in `public/media/`.
7. Add its metadata to `content/media.json`.

`public/media/README.md` documents the required fields. The public evidence page
remains a non-uploading placeholder.

## Share the receipts

`/receipts` turns verified updates into compact source-and-timestamp cards.
Mobile devices use the system share sheet; other browsers copy a text receipt
with `#TheIndiaProject` and `#VerifyBeforeYouAmplify`.

## On-visit source freshness

Every homepage and updates-page visit calls `/api/source-scan` with caching
disabled. The server searches Google News India for recent student-protest,
university-protest, examination-protest, and paper-leak reporting, and checks
the Government of India Press Information Bureau feed for new official
education responses. The browser repeats the scan every five minutes while the
page remains open and shows the exact check time and any source failure.

Newly discovered headlines are deliberately labelled `review pending`. They do
not enter the signed verified feed until an editor opens the underlying report,
checks its claims and sourcing, creates a structured bilingual record, and runs
the validation pipeline. This keeps discovery fresh without automatically
turning an unreviewed headline into a verified claim.

## CJP live X feed

The homepage and updates page include an X timeline for CJP's announced
replacement handle, `@Cockroachisback`. The original `@cockroachjanta` account
is currently suspended. Because X embeds contact a third party, the timeline is
click-to-load, uses X's do-not-track setting, and always includes a direct-profile
fallback. Social posts are labelled as unreviewed source material and never
enter the signed verified feed automatically.

## Netlify deployment

Netlify uses the dedicated `build:netlify` command and
`vite.netlify.config.ts`. Vinext's supported Nitro adapter emits public assets
to `dist` and a Netlify server function, preserving server-rendered routes and the
live `/api/source-scan` endpoint. Repository-level settings live in
`netlify.toml`, which also sets `NETLIFY_NEXT_PLUGIN_SKIP=true` so an existing
UI-installed `@netlify/plugin-nextjs` plugin is bypassed. The plugin can be
removed from the Netlify UI later, but it no longer blocks the build.

## Standalone repository

A fresh clone contains every public resource required to build and run the
site: bilingual content, PDFs, PWA files, social artwork, the signed public
feed, its signature and public key, Netlify configuration, and the Cloudflare
worker target. Run `npm ci`, then `npm run build` or
`npm run build:netlify`.

No secret is required for an ordinary build. Without the private signing key,
the build verifies that the committed feed is authentic and matches the source
content. Authorized publishers can set `FEED_SIGNING_PRIVATE_KEY` to regenerate
the feed after editorial changes. The private key, original evidence, and
unredacted media must never be committed.

Runtime source discovery still depends on Google News India and the Press
Information Bureau. The optional CJP timeline connects to X only after a
visitor chooses to load it.

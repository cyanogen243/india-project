# The India Project

A bilingual, static-first public-interest information hub for verified student
movement updates in India. It publishes broad-zone updates, demands, government
responses, a factual timeline, safety material, source documents, corrections,
offline packs, signed feeds, and a reviewed-media archive.

The public site intentionally has no accounts, comments, analytics, cookies,
precise live-location tracking, tactical maps, or public evidence uploader.

## Run locally

```sh
npm install
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
metadata. It then creates an Ed25519-signed feed in `public/feed/`.

On the first local build, a signing key is generated at
`.private/feed-private.pem`. That directory is ignored by Git. Back up the key
securely and set `FEED_SIGNING_PRIVATE_KEY` in production; changing the key
changes the public verification key.

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

## Hall of Shame media workflow

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

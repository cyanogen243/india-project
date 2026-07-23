export const dynamic = "force-dynamic";

type ScanItem = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  discoveredBy: "Google News" | "PIB";
  verification: "unreviewed";
};

const GOOGLE_NEWS_URL = new URL("https://news.google.com/rss/search");
GOOGLE_NEWS_URL.searchParams.set(
  "q",
  'India ("student protest" OR "university protest" OR "exam protest" OR "paper leak")',
);
GOOGLE_NEWS_URL.searchParams.set("hl", "en-IN");
GOOGLE_NEWS_URL.searchParams.set("gl", "IN");
GOOGLE_NEWS_URL.searchParams.set("ceid", "IN:en");

const PIB_URL =
  "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3";

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normaliseTitle(value: string) {
  return value
    .toLocaleLowerCase("en-IN")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .trim();
}

function makeId(title: string, publisher: string) {
  let hash = 2166136261;
  for (const character of `${title}|${publisher}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `scan-${(hash >>> 0).toString(16)}`;
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function readXmlTag(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

async function fetchGoogleNews(): Promise<ScanItem[]> {
  const response = await fetch(GOOGLE_NEWS_URL, {
    cache: "no-store",
    headers: { accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);

  const xml = await response.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks.flatMap((block) => {
    const title = readXmlTag(block, "title");
    const url = safeHttpsUrl(readXmlTag(block, "link"));
    const publisher = readXmlTag(block, "source") || "Google News publisher";
    const dateValue = readXmlTag(block, "pubDate");
    const date = dateValue ? new Date(dateValue) : null;
    if (!title || !url) return [];

    return [
      {
        id: makeId(title, publisher),
        title,
        url,
        publisher,
        publishedAt:
          date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
        discoveredBy: "Google News" as const,
        verification: "unreviewed" as const,
      },
    ];
  });
}

async function fetchPib(): Promise<ScanItem[]> {
  const response = await fetch(PIB_URL, {
    cache: "no-store",
    headers: { accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok) throw new Error(`PIB returned ${response.status}`);

  const xml = await response.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const relevant =
    /student|education|examination|exam\b|university|college|neet|jee|paper[\s-]?leak|protest/i;

  return itemBlocks.flatMap((block) => {
    const title = readXmlTag(block, "title");
    const description = readXmlTag(block, "description");
    const url = safeHttpsUrl(readXmlTag(block, "link"));
    const dateValue = readXmlTag(block, "pubDate");
    const date = dateValue ? new Date(dateValue) : null;
    if (!title || !url || !relevant.test(`${title} ${description}`)) return [];

    return [
      {
        id: makeId(title, "Press Information Bureau"),
        title,
        url,
        publisher: "Press Information Bureau",
        publishedAt:
          date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
        discoveredBy: "PIB" as const,
        verification: "unreviewed" as const,
      },
    ];
  });
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled([fetchGoogleNews(), fetchPib()]);
  const warnings: string[] = [];
  const discovered = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    warnings.push(
      `${index === 0 ? "Google News" : "Press Information Bureau"} source check failed`,
    );
    return [];
  });

  const deduplicated = Array.from(
    new Map(
      discovered.map((item) => [
        `${normaliseTitle(item.title)}|${item.publisher.toLowerCase()}`,
        item,
      ]),
    ).values(),
  )
    .sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 12);

  return Response.json(
    {
      checkedAt,
      status:
        results.every((result) => result.status === "fulfilled")
          ? "fresh"
          : results.some((result) => result.status === "fulfilled")
            ? "partial"
            : "unavailable",
      sourcesChecked: ["Google News India", "Press Information Bureau"],
      items: deduplicated,
      warnings,
      editorialStatus:
        "Source discovery only. Headlines are not verified updates until an editor reviews the underlying reporting.",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}

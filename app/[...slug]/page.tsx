import { notFound } from "next/navigation";
import { PublicPage, type PageKind } from "@/app/components/PublicPage";

const kinds = [
  "updates",
  "demands",
  "timeline",
  "safety",
  "legal",
  "reading-room",
  "corrections",
  "evidence",
  "text",
  "offline",
  "receipts",
  "editorial-standard",
] satisfies PageKind[];

export const dynamic = "force-static";

export function generateStaticParams() {
  return [
    { slug: ["hi"] },
    ...kinds.map((kind) => ({ slug: [kind] })),
    ...kinds
      .filter((kind) => kind !== "offline")
      .map((kind) => ({ slug: ["hi", kind] })),
  ];
}

export default async function CatchAllPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const language = slug[0] === "hi" ? "hi" : "en";
  const pagePart = language === "hi" ? slug[1] : slug[0];
  const kind = (language === "hi" && slug.length === 1
    ? "home"
    : pagePart) as PageKind;

  if (
    kind !== "home" &&
    !(kinds as readonly PageKind[]).includes(kind)
  ) {
    notFound();
  }
  if (language === "hi" && kind === "offline") notFound();

  return <PublicPage language={language} kind={kind} />;
}

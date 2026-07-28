import { ContributionReadPage } from "@/app/components/ContributionReadPage";

export const dynamic = "force-dynamic";

export default async function ArtReadPageHindi({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContributionReadPage id={id} language="hi" />;
}

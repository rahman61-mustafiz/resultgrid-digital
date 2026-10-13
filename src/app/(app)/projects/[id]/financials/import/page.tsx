import { ImportClient } from "@/app/(app)/projects/[id]/financials/import/import-client"

export default async function FinancialsImportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold">Import financial records (CSV)</h1>
      <ImportClient projectId={id} />
    </div>
  )
}

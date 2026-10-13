/**
 * H01/H08: an approved export package is named
 * `ResultGrid-Digital_{client}_{project}_{YYYY-MM-DD}_vNN`. The date is the
 * generation date in the workspace's timezone (B08). Names are reduced to
 * ASCII letters, digits and hyphens so the result is a safe file name
 * everywhere.
 */

export function sanitizeNamePart(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  return cleaned || fallback
}

export function exportDate(generatedAtIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(generatedAtIso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

export function versionLabel(version: number): string {
  return `v${String(version).padStart(2, "0")}`
}

export function exportPackageName(input: {
  clientName: string
  projectName: string
  generatedAtIso: string
  version: number
  timeZone: string
}): string {
  return [
    "ResultGrid-Digital",
    sanitizeNamePart(input.clientName, "Client"),
    sanitizeNamePart(input.projectName, "Project"),
    exportDate(input.generatedAtIso, input.timeZone),
    versionLabel(input.version),
  ].join("_")
}

const PACKAGE_NAME = /^ResultGrid-Digital_[A-Za-z0-9-]+_[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}_v\d{2,}$/

/** The package name recorded in an export's manifest, when it has the current format. */
export function packageNameFromManifest(manifest: string): string | null {
  const match = /^- Package: (.+)$/m.exec(manifest)
  const name = match?.[1].trim()
  return name && PACKAGE_NAME.test(name) ? name : null
}

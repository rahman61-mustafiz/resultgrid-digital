/** Full current IANA time zone list, from the runtime's own tz database. */
export function getTimezoneOptions(): string[] {
  return Intl.supportedValuesOf("timeZone")
}

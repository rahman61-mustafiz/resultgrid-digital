import { expect, test } from "@playwright/test"

import { MIN_CRON_SECRET_LENGTH, isCronAuthorized } from "@/lib/auth/cron-auth"

const SECRET = "s".repeat(MIN_CRON_SECRET_LENGTH)

test.describe("scheduled-job authorization (CRON_SECRET)", () => {
  test("only the exact bearer token is accepted", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(isCronAuthorized(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false)
    expect(isCronAuthorized(SECRET, SECRET), "the Bearer prefix is required").toBe(false)
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false)
    expect(isCronAuthorized(null, SECRET)).toBe(false)
    expect(isCronAuthorized("", SECRET)).toBe(false)
  })

  test("a missing or short secret authorizes nothing, not even an empty token", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false)
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false)
    const short = "s".repeat(MIN_CRON_SECRET_LENGTH - 1)
    expect(isCronAuthorized(`Bearer ${short}`, short)).toBe(false)
  })
})

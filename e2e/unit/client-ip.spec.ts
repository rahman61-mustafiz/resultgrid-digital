import { expect, test } from "@playwright/test"

import { clientIp } from "@/lib/auth/client-ip"

test.describe("client IP for the security log (x-forwarded-for)", () => {
  test("a single address is kept", () => {
    expect(clientIp("203.0.113.7")).toBe("203.0.113.7")
    expect(clientIp("2a09:bac5:49c:25d7::3c5:d")).toBe("2a09:bac5:49c:25d7::3c5:d")
  })

  test("a proxy chain gives the first (client) address", () => {
    expect(clientIp("2a09:bac5:49c:25d7::3c5:d, 2a09:bac5:49c:25d7::3c5:d,2a09:bac5:49c:25d7::3c5:d")).toBe(
      "2a09:bac5:49c:25d7::3c5:d"
    )
    expect(clientIp(" 198.51.100.1 , 10.0.0.1")).toBe("198.51.100.1")
  })

  test("missing or malformed values become null instead of failing the insert", () => {
    expect(clientIp(null)).toBeNull()
    expect(clientIp(undefined)).toBeNull()
    expect(clientIp("")).toBeNull()
    expect(clientIp("unknown")).toBeNull()
    expect(clientIp("1.2.3.4:5678")).toBeNull()
  })
})

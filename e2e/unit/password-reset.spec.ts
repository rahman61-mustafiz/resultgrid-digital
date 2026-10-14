import { expect, test } from "@playwright/test"

import { isRecentPasswordReset } from "@/lib/auth/amr"

const NOW = 1_800_000_000
const WINDOW = 15 * 60
const at = (method: string, secondsAgo: number) => ({ method, timestamp: NOW - secondsAgo })

test.describe("forgot-password gate (signed amr claims)", () => {
  test("a reset link followed by the TOTP code, both recent, qualifies", () => {
    expect(isRecentPasswordReset([at("recovery", 120), at("totp", 60)], NOW, WINDOW)).toBe(true)
    expect(isRecentPasswordReset([at("otp", 120), at("totp", 60)], NOW, WINDOW)).toBe(true)
  })

  test("a normal password + TOTP session never qualifies", () => {
    expect(isRecentPasswordReset([at("password", 30), at("totp", 20)], NOW, WINDOW)).toBe(false)
  })

  test("the link alone, without the TOTP code, does not qualify", () => {
    expect(isRecentPasswordReset([at("recovery", 30)], NOW, WINDOW)).toBe(false)
  })

  test("a TOTP code from before the link does not count", () => {
    expect(isRecentPasswordReset([at("totp", 300), at("recovery", 60)], NOW, WINDOW)).toBe(false)
  })

  test("either step older than the window does not qualify", () => {
    expect(isRecentPasswordReset([at("recovery", WINDOW + 5), at("totp", 30)], NOW, WINDOW)).toBe(false)
    expect(isRecentPasswordReset([at("recovery", WINDOW + 60), at("totp", WINDOW + 5)], NOW, WINDOW)).toBe(false)
  })

  test("timestamps far in the future are rejected", () => {
    expect(isRecentPasswordReset([at("recovery", -3600), at("totp", -3600)], NOW, WINDOW)).toBe(false)
  })
})

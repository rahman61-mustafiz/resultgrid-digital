import { expect, test } from "@playwright/test"

import { totpIssuer } from "@/lib/auth/totp-issuer"

test("each environment's authenticator entry has its own name", () => {
  expect(totpIssuer("http://localhost:3000")).toBe("ResultGrid (dev)")
  expect(totpIssuer("http://127.0.0.1:3000")).toBe("ResultGrid (dev)")
  expect(totpIssuer("https://resultgrid-digital-staging.vercel.app")).toBe("ResultGrid (staging)")
  expect(totpIssuer("https://pukita.resultgriddigital.com")).toBe("ResultGrid Pukita")
  expect(totpIssuer("https://example.org")).toBe("ResultGrid (example.org)")
  expect(totpIssuer("not a url")).toBe("ResultGrid")
})

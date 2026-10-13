import { expect, test } from "@playwright/test"

import { isMobileDevice, isMobileWritablePath, isReadMethod } from "@/lib/device"

function h(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null }
}

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
}

test.describe("mobile detection (spec A07/I08)", () => {
  test("the Sec-CH-UA-Mobile client hint decides when present", () => {
    expect(isMobileDevice(h({ "sec-ch-ua-mobile": "?1", "user-agent": UA.windowsChrome }))).toBe(true)
    expect(isMobileDevice(h({ "sec-ch-ua-mobile": "?0", "user-agent": UA.androidChrome }))).toBe(false)
  })

  test("phones are mobile by User-Agent when there's no hint", () => {
    for (const ua of [UA.androidChrome, UA.iphoneSafari, UA.firefoxAndroid]) {
      expect(isMobileDevice(h({ "user-agent": ua })), ua).toBe(true)
    }
  })

  test("desktop browsers and tablets with a desktop User-Agent are not", () => {
    for (const ua of [UA.windowsChrome, UA.windowsEdge, UA.ipadDesktopMode, UA.androidTablet]) {
      expect(isMobileDevice(h({ "user-agent": ua })), ua).toBe(false)
    }
    expect(isMobileDevice(h({}))).toBe(false)
  })

  test("only sign-in, TOTP, unlock, recovery, sign-out and the share PIN are writable on a phone", () => {
    for (const p of ["/login", "/login/verify", "/setup/totp", "/lock", "/recovery", "/recovery/callback", "/share/abc123", "/auth/sign-out"]) {
      expect(isMobileWritablePath(p), p).toBe(true)
    }
    for (const p of ["/dashboard", "/projects/1/questionnaire", "/clients/new", "/settings", "/loginx", "/sharex", "/auth/callback", "/"]) {
      expect(isMobileWritablePath(p), p).toBe(false)
    }
  })

  test("read methods", () => {
    expect(["GET", "HEAD", "OPTIONS"].every(isReadMethod)).toBe(true)
    expect(["POST", "PUT", "PATCH", "DELETE"].some(isReadMethod)).toBe(false)
  })
})

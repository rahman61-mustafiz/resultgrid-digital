import type { NextConfig } from "next";

// Sent on every response. The CSP only sets directives that don't depend on
// script nonces: no framing (clickjacking), no <base> or plugin injection,
// and forms may only post back to this app. Referrer-Policy keeps share-link
// tokens in /share/... URLs from leaking to other sites through Referer.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Browsers ignore this over plain HTTP, so local development is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  // A private workspace: nothing here should appear in search results.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { Metadata } from "next";

// Self-hosted fonts (npm @fontsource): no fetch from Google at build time,
// which next/font/google needs and which failed on the production host.
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/ibm-plex-mono/400.css";

import { TechBackdrop } from "@/components/tech-backdrop";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResultGrid Digital",
  description: "ResultGrid Digital marketing operations workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <TechBackdrop />
        {children}
      </body>
    </html>
  );
}

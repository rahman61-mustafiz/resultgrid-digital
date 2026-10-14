import type { Metadata } from "next";

// Self-hosted fonts (npm @fontsource): no fetch from Google at build time,
// which next/font/google needs and which failed on the production host.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";

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

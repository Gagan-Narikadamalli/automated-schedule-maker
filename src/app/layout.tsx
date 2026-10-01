import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./management.css";
import "./auth.css";
import "./navigation.css";

export const metadata: Metadata = {
  title: "SOS Automated Schedule Maker",
  description:
    "Success On The Spectrum multi-location staff and client scheduling application.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

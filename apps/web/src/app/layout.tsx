import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: "ManyHands",
  description: "Visual orchestration workspace for multi-agent software development."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en" data-theme="light" data-scroll-behavior="smooth">
      <body>
        <div className="mh-shell">
          <AppNav />
          <main className="mh-container py-8 md:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}

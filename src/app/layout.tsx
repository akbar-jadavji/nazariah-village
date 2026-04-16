import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Generative Village",
  description: "A fantasy village where AI agents live autonomous lives",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-gray-900">{children}</body>
    </html>
  );
}

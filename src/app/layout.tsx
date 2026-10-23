import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RewardLoop — Earn the purchase",
  description:
    "A PayPal AI Hackathon sandbox demo for turning progress into a positive reward.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

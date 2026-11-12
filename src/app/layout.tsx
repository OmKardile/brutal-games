import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BRUTAL//GAMES — free browser arcade: ARENA + STACK",
  description:
    "Two free browser games in one brutal arcade: ARENA (twin-stick wave shooter — draft upgrades, chain killstreaks, kill the Brute) and STACK (one-tap tower stacker — chain perfect drops, grow the tower). No download. A fan-made tribute to BRUTAL by ahwoo.",
  keywords: [
    "BRUTAL",
    "arena shooter",
    "stack game",
    "one tap game",
    "browser game",
    "free game",
    "wave survival",
    "hyper casual",
    "ahwoo",
    "top-down shooter",
    "tower stacker",
  ],
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.svg`,
  },
  openGraph: {
    title: "BRUTAL//GAMES — stop reading, start playing",
    description:
      "Two free browser games: a twin-stick wave shooter and a one-tap tower stacker. No download.",
    images: [`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/images/arena_bg.jpg`],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

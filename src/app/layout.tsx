import type { Metadata } from "next";
import { Anton, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/lib/theme";
import { ConsentBanner } from "@/components/portal/ConsentBanner";
import { SITE_URL } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  // resolves relative canonicals/OG images to absolute URLs
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: "BRUTAL//GAMES — 5 free browser games. pick your poison.",
  description:
    "Five free browser games in one brutal arcade: ARENA (twin-stick wave shooter), STACK (one-tap tower), REFLEX (timing strike), DODGE (one-button gauntlet) and MERGE (drop-merge chaos). Night and day modes, gamepad support, global leaderboards. No download.",
  authors: [{ name: "Omkar Kardile", url: "https://omkardile.is-a.dev/" }],
  creator: "Omkar Kardile",
  keywords: [
    "BRUTAL",
    "browser games",
    "arena shooter",
    "stack game",
    "reflex game",
    "one button game",
    "merge game",
    "suika style",
    "free game",
    "wave survival",
    "hyper casual",
    "gamepad support",
    "ahwoo",
  ],
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.svg`,
  },
  openGraph: {
    title: "BRUTAL//GAMES — stop reading, start playing",
    description:
      "Five free browser games: a twin-stick shooter, a one-tap tower, a timing strike, a one-button gauntlet and a drop-merge pit. No download.",
    images: [`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/og/site.png`],
    type: "website",
  },
};

// Applies the saved theme before first paint so day-mode never flashes black.
const themeInit = `(function(){try{var t=localStorage.getItem('brutal.theme');if(t==='day'||t==='night'){document.documentElement.dataset.theme=t}else{document.documentElement.dataset.theme='night'}}catch(e){document.documentElement.dataset.theme='night'}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="night" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <ConsentBanner />
        <Toaster />
      </body>
    </html>
  );
}

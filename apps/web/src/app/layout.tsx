import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans-face", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono-face", subsets: ["latin"] });
// Display only: logo, big titles, the world nameplate. Never body text.
const display = Pixelify_Sans({ variable: "--font-display-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HubMine",
  description: "Crie seu mundo Minecraft. O HubMine cuida do resto.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

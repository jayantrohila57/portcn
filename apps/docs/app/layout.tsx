import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';

const sans = Instrument_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
});
const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const metadataBase = new URL(deploymentHost ? `https://${deploymentHost}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: 'portcn — Know what’s running.',
    template: '%s | portcn',
  },
  description:
    'An open-source, developer-first CLI for discovering, inspecting, monitoring, and managing application ports and local services.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: 'dark', enableSystem: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}

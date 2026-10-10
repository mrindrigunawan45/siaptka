import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Simulasi TKA 2026',
  description: 'Platform Simulasi Ujian TKA berbasis AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
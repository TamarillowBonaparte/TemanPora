import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Teman Pora — Siapkan berkas SIPORA POLIJE',
  description: 'Pisahkan laporan tugas akhir menjadi empat PDF sesuai panduan SIPORA POLIJE, periksa rentang halaman, dan siapkan deposit otomatis.',
  icons: {
    icon: '/temanpora-icon.jpg',
    apple: '/temanpora-icon.jpg',
  },
};
// Browser extensions such as Katalon inject attributes on <html> before hydration.
// Suppression is limited to this element; child mismatches remain visible.
export default function Layout({children}: {children: React.ReactNode}) { return <html lang="id" suppressHydrationWarning><body>{children}</body></html>; }

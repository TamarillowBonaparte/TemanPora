'use client';

import { useEffect } from 'react';

export default function ReplacePdfPage() {
  useEffect(() => {
    window.location.replace('/#ganti-halaman-pdf');
  }, []);

  return <main><a href="/#ganti-halaman-pdf">Buka Ganti Halaman PDF</a></main>;
}

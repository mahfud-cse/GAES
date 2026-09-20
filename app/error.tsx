"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("GAES page recovery", error);
  }, [error]);

  return (
    <main className="recoveryPage">
      <section className="recoveryCard" role="alert">
        <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
        <span>DATA TIDAK DAPAT DITAMPILKAN</span>
        <h1>Halaman tetap aman</h1>
        <p>
          Ada data yang formatnya belum sesuai. Data tersebut tidak diproses dan
          halaman dapat dicoba kembali tanpa mengubah Firebase secara manual.
        </p>
        <button className="primary" onClick={reset}>
          Muat Ulang Halaman
        </button>
      </section>
    </main>
  );
}

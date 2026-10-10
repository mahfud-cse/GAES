"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = /chunk|dynamically imported module/i.test(error.message || "");
  useEffect(() => {
    console.error("GAES page recovery", error);
  }, [error]);

  return (
    <main className="recoveryPage">
      <section className="recoveryCard" role="alert">
        <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
        <span>{isChunkError ? "APPLICATION UPDATE" : "DATA TIDAK DAPAT DITAMPILKAN"}</span>
        <h1>{isChunkError ? "Versi aplikasi telah diperbarui" : "Halaman tetap aman"}</h1>
        <p>
          {isChunkError
            ? "Browser masih membuka file dari versi sebelumnya. Muat versi terbaru; data yang sudah tersimpan tidak akan berubah."
            : "Ada data yang formatnya belum sesuai. Data tersebut tidak diproses dan halaman dapat dicoba kembali tanpa mengubah Firebase secara manual."}
        </p>
        <button
          className="primary"
          onClick={() => {
            if (isChunkError) window.location.reload();
            else reset();
          }}
        >
          {isChunkError ? "Muat Versi Terbaru" : "Muat Ulang Halaman"}
        </button>
      </section>
    </main>
  );
}

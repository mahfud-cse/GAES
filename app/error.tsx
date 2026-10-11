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
  const diagnosticCode = error.digest || "CLIENT-RENDER";
  const diagnosticMessage = (error.message || "Unknown client render error")
    .replace(/https?:\/\/\S+/g, "[URL]")
    .slice(0, 500);
  useEffect(() => {
    console.error("GAES page recovery", error);
  }, [error]);

  return (
    <main className="recoveryPage">
      <section className="recoveryCard" role="alert">
        <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
        <span>{isChunkError ? "APPLICATION UPDATE" : "APPLICATION DIAGNOSTIC"}</span>
        <h1>{isChunkError ? "Versi aplikasi telah diperbarui" : "Halaman belum dapat ditampilkan"}</h1>
        <p>
          {isChunkError
            ? "Browser masih membuka file dari versi sebelumnya. Muat versi terbaru; data yang sudah tersimpan tidak akan berubah."
            : "Aplikasi menghentikan proses sebelum ada perubahan data. Salin diagnosis di bawah agar penyebabnya dapat diperbaiki secara tepat tanpa mengubah Firebase secara manual."}
        </p>
        {!isChunkError && (
          <pre className="recoveryDiagnostic" aria-label="Kode diagnosis">
            {diagnosticCode}: {diagnosticMessage}
          </pre>
        )}
        <div className="modalActions">
          {!isChunkError && (
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `${diagnosticCode}: ${diagnosticMessage}`,
                )
              }
            >
              Salin Diagnosis
            </button>
          )}
          <button
            className="primary"
            onClick={() => {
              if (isChunkError) window.location.reload();
              else reset();
            }}
          >
            {isChunkError ? "Muat Versi Terbaru" : "Coba Muat Ulang"}
          </button>
        </div>
      </section>
    </main>
  );
}

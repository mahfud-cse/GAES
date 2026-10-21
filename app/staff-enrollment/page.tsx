"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { seamlessOperationsRequest } from "../../lib/firebase/api";
import {
  errorMessage,
  useCapture,
  type Language,
  type Photo,
} from "../seamless-shared";
import "../seamless.css";
export default function StaffEnrollment() {
  const [language, setLanguage] = useState<Language>("ID"),
    [token, setToken] = useState(""),
    [info, setInfo] = useState<{
      name: string;
      station: string;
      expiresAt: string;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [consent, setConsent] = useState(false),
    [photos, setPhotos] = useState<Photo[]>([]),
    [previews, setPreviews] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  const {
    video: videoRef,
    ready: cameraReady,
    cameraError,
    start: startCamera,
    stop: stopCamera,
    capture: capturePhoto,
  } = useCapture();
  const inflight = useRef(false),
    initialToken = useRef<string | null>(null);
  const t = (id: string, en: string) => (language === "ID" ? id : en);
  const poses = ["front", "right", "left"];
  useEffect(() => {
    const key = initialToken.current ?? window.location.hash.slice(1);
    initialToken.current = key;
    setToken(key);
    window.history.replaceState({}, "", window.location.pathname);
    if (!/^[a-f0-9]{64}$/.test(key)) {
      setNotice("LINK_INVALID");
      setLoading(false);
      return;
    }
    let active = true;
    void seamlessOperationsRequest(null, {
      action: "enrollment-info",
      token: key,
    })
      .then((d) => {
        if (active) setInfo(d as unknown as typeof info);
      })
      .catch((e) => {
        if (active)
          setNotice(e instanceof Error ? e.message : "SERVICE_UNAVAILABLE");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const capture = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const data = capturePhoto();
      const d = await seamlessOperationsRequest(null, {
        action: "enrollment-upload",
        token,
        data,
        pose: poses[photos.length],
        consent,
      });
      setPhotos((p) => [...p, d.photo as Photo]);
      setPreviews((p) => [...p, data]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "SERVICE_UNAVAILABLE");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await seamlessOperationsRequest(null, {
        action: "enrollment-submit",
        token,
        photos,
        consent,
      });
      stopCamera();
      setComplete(true);
      setPreviews([]);
      setToken("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "SERVICE_UNAVAILABLE");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  const poseLabels =
    language === "ID"
      ? [
          "Lihat lurus ke kamera",
          "Tengok sedikit ke kanan",
          "Tengok sedikit ke kiri",
        ]
      : [
          "Look straight at the camera",
          "Turn slightly to your right",
          "Turn slightly to your left",
        ];
  return (
    <main
      className="sa-root sa-enrollment-page"
      data-native-language="true"
      lang={language === "ID" ? "id" : "en"}
    >
      <header className="sa-enrollment-header">
        <div className="sa-brand">
          <img
            src="/garuda-wing.svg"
            width="40"
            height="40"
            alt="Garuda Indonesia"
          />
          <span>
            GARUDA INDONESIA<small>STAFF ACCESS</small>
          </span>
        </div>
        <button
          type="button"
          aria-label={t("Ganti bahasa", "Change language")}
          onClick={() => setLanguage(language === "ID" ? "EN" : "ID")}
        >
          {language === "ID" ? "EN" : "ID"}
        </button>
      </header>
      <section className="sa-enrollment-card">
        <p className="sa-eyebrow">
          {t("PENDAFTARAN MANDIRI", "SELF ENROLLMENT")}
        </p>
        <h1>
          {complete
            ? t("Foto berhasil dikirim", "Photos submitted")
            : t("Siapkan akses petugas Anda", "Prepare your staff access")}
        </h1>
        {loading ? (
          <p role="status">{t("Memeriksa tautan…", "Checking your link…")}</p>
        ) : complete ? (
          <div className="sa-empty">
            <div className="sa-result-symbol">✓</div>
            <h2>
              {t("Menunggu peninjauan admin", "Awaiting administrator review")}
            </h2>
            <p>
              {t(
                "Pendaftaran foto selesai. Akses baru aktif setelah identitas, enrollment, dan kewenangan disetujui administrator.",
                "Photo registration is complete. Access activates only after an administrator approves your identity, enrollment and authorization.",
              )}
            </p>
            <p>
              {t("Anda dapat menutup halaman ini.", "You may close this page.")}
            </p>
          </div>
        ) : info ? (
          <>
            <div className="sa-profile">
              <div className="sa-avatar">{info.name.slice(0, 1)}</div>
              <div>
                <strong>{info.name}</strong>
                <p>{info.station}</p>
              </div>
            </div>
            <p>
              {t(
                "Ambil tiga foto dengan pencahayaan yang baik. Lepaskan masker dan pastikan wajah terlihat jelas.",
                "Take three photos in good lighting. Remove your mask and ensure your face is clearly visible.",
              )}
            </p>
            <label className="sa-check">
              <input
                type="checkbox"
                disabled={busy || photos.length > 0}
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {t(
                  "Saya telah menerima pemberitahuan dan menyetujui penyimpanan foto untuk enrollment serta verifikasi akses wajah 1:1.",
                  "I have received the notice and consent to photo storage for enrollment and 1:1 face access verification.",
                )}
              </span>
            </label>
            <p className="sa-help">
              {t(
                "Foto tersimpan dengan akses terbatas. Pengambilan tiga sudut merupakan panduan foto, bukan bukti liveness. Hasil tetap harus ditinjau sebelum aktivasi.",
                "Photos are stored with restricted access. The three angles are photo guidance, not proof of liveness. Results must be reviewed before activation.",
              )}
            </p>
            <ol className="sa-enrollment-steps">
              {poses.map((p, idx) => (
                <li
                  key={p}
                  className={
                    idx < photos.length
                      ? "done"
                      : idx === photos.length
                        ? "current"
                        : ""
                  }
                >
                  <span>{idx < photos.length ? "✓" : idx + 1}</span>
                  {language === "ID"
                    ? ["Depan", "Kanan", "Kiri"][idx]
                    : ["Front", "Right", "Left"][idx]}
                </li>
              ))}
            </ol>
            {photos.length < 3 ? (
              <>
                <div className="sa-capture-instruction">
                  <span>{photos.length + 1} / 3</span>
                  <h2>{poseLabels[photos.length]}</h2>
                </div>
                <div className="sa-camera">
                  <video ref={videoRef} autoPlay muted playsInline />
                  <div className="sa-face-guide" />
                  {!cameraReady && (
                    <span>{t("Kamera belum aktif", "Camera is inactive")}</span>
                  )}
                </div>
                {cameraError && (
                  <p role="alert">
                    {t(
                      "Kamera tidak tersedia. Buka tautan melalui HTTPS dan izinkan akses kamera di browser.",
                      "Camera unavailable. Open the link over HTTPS and allow camera access in your browser.",
                    )}
                  </p>
                )}
                <div className="sa-actions">
                  <button
                    type="button"
                    disabled={!consent || busy || cameraReady}
                    onClick={() => void startCamera()}
                  >
                    {t("Aktifkan kamera", "Enable camera")}
                  </button>
                  <button
                    type="button"
                    className="sa-primary"
                    disabled={!cameraReady || busy || !consent}
                    onClick={() => void capture()}
                  >
                    {busy
                      ? t("Menyimpan…", "Saving…")
                      : t("Ambil foto", "Capture photo")}
                  </button>
                  <button type="button" onClick={stopCamera}>
                    {t("Hentikan kamera", "Stop camera")}
                  </button>
                </div>
              </>
            ) : (
              <p className="sa-guest-message">
                {t(
                  "Ketiga foto siap dikirim. Periksa sebelum melanjutkan.",
                  "All three photos are ready. Review them before continuing.",
                )}
              </p>
            )}
            <div className="sa-photo-strip">
              {previews.map((p, idx) => (
                <figure key={idx}>
                  <img src={p} alt={poseLabels[idx]} />
                  <figcaption>
                    {language === "ID"
                      ? ["Depan", "Kanan", "Kiri"][idx]
                      : ["Front", "Right", "Left"][idx]}
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="sa-actions">
              {photos.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPhotos([]);
                    setPreviews([]);
                    setNotice("");
                  }}
                >
                  {t("Ambil ulang semua foto", "Retake all photos")}
                </button>
              )}
              <button
                type="button"
                className="sa-primary"
                disabled={busy || photos.length !== 3 || !consent}
                onClick={() => void submit()}
              >
                {busy
                  ? t("Mengirim…", "Submitting…")
                  : t("Kirim untuk peninjauan", "Submit for review")}
              </button>
            </div>
          </>
        ) : null}
        {notice && (
          <div className="sa-notice" role="alert">
            {errorMessage(new Error(notice), language)}
          </div>
        )}
      </section>
      <footer className="sa-enrollment-footer">
        GARUDA ACCESS ENTITLEMENT SYSTEM
      </footer>
    </main>
  );
}

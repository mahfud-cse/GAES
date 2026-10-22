"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCapture, type Language } from "./seamless-shared";
type Api = (p: Record<string, unknown>) => Promise<Record<string, unknown>>;
export default function SeamlessDisplay({
  api,
  language,
  loungeId,
  loungeName,
  station,
  videoUrl,
  qr,
  orientation,
  identityReady,
  onClose,
}: {
  api: Api;
  language: Language;
  loungeId: string;
  loungeName: string;
  station: string;
  videoUrl?: string;
  qr: string;
  orientation: "landscape" | "portrait";
  identityReady: boolean;
  onClose: () => void;
}) {
  const t = useCallback(
    (id: string, en: string) => (language === "ID" ? id : en),
    [language],
  );
  const {
    video: videoRef,
    ready,
    cameraError,
    start,
    stop,
    capture,
  } = useCapture();
  const [phase, setPhase] = useState("camera"),
    [result, setResult] = useState<Record<string, unknown> | null>(null),
    [message, setMessage] = useState(""),
    [videoFailed, setVideoFailed] = useState(false);
  const pending = useRef<{
      sessionId: string;
      requestId: string;
      capture: string;
    } | null>(null),
    processing = useRef(false),
    last = useRef("");
  const phaseRef = useRef(phase);
  const serviceReady = useRef(identityReady),
    nextHealthCheck = useRef(0);
  useEffect(() => {
    serviceReady.current = identityReady;
    nextHealthCheck.current = 0;
  }, [identityReady]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const startRef = useRef(start),
    captureRef = useRef(capture);
  useEffect(() => {
    startRef.current = start;
    captureRef.current = capture;
  });
  useEffect(() => {
    void startRef.current();
    const previous = document.activeElement as HTMLElement | null;
    const overlay = document.querySelector<HTMLElement>(".sa-display-only");
    const background = Array.from(document.body.children).filter(
      (el) => el !== overlay && !el.contains(overlay),
    );
    const alreadyInert = new Set(
      background.filter((el) => el.hasAttribute("inert")),
    );
    background.forEach((el) => el.setAttribute("inert", ""));
    overlay?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => {
      stop();
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", key);
      background.forEach((el) => {
        if (!alreadyInert.has(el)) el.removeAttribute("inert");
      });
      previous?.focus();
    };
  }, [stop, onClose]);
  useEffect(() => {
    if (!ready) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (
        processing.current ||
        ["result", "review", "assistance"].includes(phaseRef.current)
      ) {
        timer = setTimeout(poll, 1500);
        return;
      }
      processing.current = true;
      try {
        if (!serviceReady.current) {
          setPhase("camera");
          setMessage(
            t(
              "Verifikasi wajah belum tersedia. Petugas kami siap membantu.",
              "Face verification is unavailable. Our staff are ready to assist.",
            ),
          );
          if (Date.now() < nextHealthCheck.current) return;
          nextHealthCheck.current = Date.now() + 10000;
          const health = await api({ action: "bootstrap" });
          if (!active) return;
          serviceReady.current = Boolean(
            (health.integration as { identity?: boolean })?.identity,
          );
          if (!serviceReady.current) return;
        }
        if (pending.current) {
          const r = await api({
            action: "verify-one-to-one",
            ...pending.current,
          });
          if (!active) return;
          if (["Processing", "GatePending"].includes(String(r.status))) {
            setPhase("verifying");
            return;
          }
          pending.current = null;
          setResult(r);
          setPhase(
            r.decision === "Eligible" && r.gate === "OpenConfirmed"
              ? "result"
              : r.faceMatched
                ? "review"
                : "assistance",
          );
          return;
        }
        const capture = captureRef.current();
        const detected = await api({ action: "detect-face", capture });
        if (!active) return;
        if (detected.faceCount === 0) {
          setPhase("idle");
          setMessage("");
          return;
        }
        if (detected.faceCount !== 1) {
          setPhase("camera");
          setMessage(
            t(
              "Mohon satu orang di depan kamera.",
              "Please stand in front of the camera one person at a time.",
            ),
          );
          return;
        }
        setPhase("camera");
        const next = await api({ action: "display-next-session", loungeId });
        if (!active) return;
        if (!next.sessionId || next.sessionId === last.current) {
          setMessage(
            t(
              "Silakan lakukan check-in atau tunjukkan kartu kepada petugas.",
              "Please check in or present your card to a staff member.",
            ),
          );
          return;
        }
        last.current = String(next.sessionId);
        pending.current = {
          sessionId: String(next.sessionId),
          requestId: crypto.randomUUID(),
          capture,
        };
        setMessage("");
        setPhase("verifying");
      } catch {
        if (active) {
          setPhase("camera");
          setMessage(
            t(
              "Verifikasi belum tersedia. Silakan hubungi petugas.",
              "Verification is unavailable. Please ask a staff member.",
            ),
          );
        }
      } finally {
        processing.current = false;
        if (active) timer = setTimeout(poll, pending.current ? 1000 : 1800);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, ready, identityReady, loungeId, language, t]);
  useEffect(() => {
    if (!["result", "review", "assistance"].includes(phase)) return;
    const timer = setTimeout(() => {
      setResult(null);
      setMessage("");
      setPhase("camera");
    }, 10000);
    return () => clearTimeout(timer);
  }, [phase]);
  return createPortal(
    <div
      className={`sa-root sa-display sa-display-only ${orientation}`}
      tabIndex={-1}
      data-native-language="true"
      lang={language === "ID" ? "id" : "en"}
      role="dialog"
      aria-modal="true"
      aria-label={t("Layar lounge", "Lounge display")}
      data-orientation={orientation}
      data-phase={phase}
    >
      <header className="sa-display-header">
        <div className="sa-brand">
          <img
            src="/garuda-wing.svg"
            alt="Garuda Indonesia"
            width="42"
            height="42"
          />
          <span>
            GARUDA INDONESIA<small>LOUNGE EXPERIENCE</small>
          </span>
        </div>
        <div className="sa-display-location">
          {loungeName}
          <small>{station}</small>
        </div>
      </header>
      <main className="sa-display-body">
        <div
          className={`sa-live-camera ${["camera", "verifying"].includes(phase) ? "visible" : ""}`}
        >
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="sa-face-guide" />
          <div className="sa-camera-caption">
            <h1>
              {phase === "verifying"
                ? t("Memverifikasi wajah Anda", "Verifying your face")
                : t("Lihat ke arah kamera", "Look at the camera")}
            </h1>
            <p>
              {cameraError
                ? t(
                    "Kamera tidak dapat diakses. Silakan hubungi petugas.",
                    "The camera is unavailable. Please ask a staff member.",
                  )
                : !ready
                  ? t("Menyiapkan kamera…", "Preparing camera…")
                  : message ||
                    t(
                      "Posisikan wajah di dalam bingkai.",
                      "Position your face within the frame.",
                    )}
            </p>
          </div>
        </div>
        {phase === "idle" && (
          <div className="sa-display-idle">
            {videoUrl && !videoFailed ? (
              <video
                className="sa-idle-video"
                autoPlay
                loop
                playsInline
                muted
                src={videoUrl}
                onError={() => setVideoFailed(true)}
              />
            ) : (
              <div className="sa-ambient">
                <img src="/garuda-wing.svg" alt="" />
                <h1>{t("Selamat datang", "Welcome")}</h1>
                <h2>{loungeName}</h2>
                <p>
                  {t(
                    "Perjalanan yang nyaman dimulai di sini.",
                    "A comfortable journey begins here.",
                  )}
                </p>
              </div>
            )}
            <div className="sa-idle-status">
              {cameraError
                ? t(
                    "Kamera belum dapat diakses. Hubungi petugas.",
                    "The camera is unavailable. Please ask a staff member.",
                  )
                : !identityReady
                  ? t(
                      "Layanan verifikasi sedang disiapkan.",
                      "The verification service is being prepared.",
                    )
                  : ready
                    ? t("Kamera siap", "Camera ready")
                    : t("Menyiapkan kamera…", "Preparing camera…")}
            </div>
          </div>
        )}
        {["result", "review", "assistance"].includes(phase) && (
          <div
            className={`sa-result-panel ${phase === "result" ? "success" : ""}`}
            aria-live="polite"
          >
            <div className="sa-result-symbol">
              {phase === "result" ? "✓" : phase === "review" ? "✓" : "i"}
            </div>
            <p className="sa-eyebrow">
              {result?.category === "Staff"
                ? t("VERIFIKASI PETUGAS", "STAFF VERIFICATION")
                : t("AKSES LOUNGE", "LOUNGE ACCESS")}
            </p>
            <h1>
              {phase === "result"
                ? result?.category === "Staff"
                  ? t("Akses petugas terverifikasi", "Staff access verified")
                  : t("Selamat datang", "Welcome")
                : phase === "review"
                  ? t("Wajah sesuai referensi", "Face matches the reference")
                  : t("Silakan hubungi petugas", "Please ask a staff member")}
            </h1>
            {phase === "result" ? (
              <>
                <h2>
                  {result?.category === "Staff"
                    ? String(result?.displayName || "")
                    : `${t("di", "to")} ${loungeName}`}
                </h2>
                <p>
                  {result?.category === "Staff"
                    ? String(result?.unit || "")
                    : `${result?.displayName || ""} ${result?.flight || ""}`}
                </p>
                {result?.category === "Passenger" && (
                  <>
                    <p>
                      {t(
                        "Selamat menikmati layanan kami. Pindai kode QR untuk melihat denah, fasilitas, dan informasi lounge.",
                        "Enjoy your visit. Scan the QR code to explore the lounge map, facilities and information.",
                      )}
                    </p>
                    {qr && (
                      <img
                        className="sa-result-qr"
                        src={qr}
                        alt={t("QR denah lounge", "Lounge map QR")}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <p>
                {phase === "review"
                  ? t(
                      "Pencocokan wajah selesai. Konfirmasi akses dilakukan oleh petugas.",
                      "Face comparison is complete. A staff member will confirm your access.",
                    )
                  : t(
                      "Verifikasi akses belum dapat dikonfirmasi. Petugas kami siap membantu.",
                      "Your access could not be confirmed. Our staff are ready to assist.",
                    )}
              </p>
            )}
          </div>
        )}
      </main>
      <footer className="sa-display-footer">
        <span>{loungeName}</span>
        <span>GARUDA INDONESIA</span>
      </footer>
    </div>,
    document.body,
  );
}

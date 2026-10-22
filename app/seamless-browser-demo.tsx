"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrowserFaceClient } from "../lib/seamless/browser-face-client";
import { errorMessage, useCapture, type Language } from "./seamless-shared";
import type { StaffRow } from "./seamless-staff";
type Api = (p: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Lounge = { id: string; name: string; airport: string; status: string };
type Session = {
  photo: string;
  displayName: string;
  unit: string;
  expiresAt: string;
};
export default function SeamlessBrowserDemo({
  api,
  language,
  stations,
  lounges,
  videos,
}: {
  api: Api;
  language: Language;
  stations: { code: string; name: string }[];
  lounges: Lounge[];
  videos: { id: string; title: string; sourceUrl: string; station: string }[];
}) {
  const t = (id: string, en: string) => (language === "ID" ? id : en);
  const [rows, setRows] = useState<StaffRow[]>([]),
    [station, setStation] = useState(""),
    [loungeId, setLoungeId] = useState(""),
    [uid, setUid] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [videoId, setVideoId] = useState(""),
    [orientation, setOrientation] = useState<"landscape" | "portrait">(
      "landscape",
    ),
    [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      let accountCursor: unknown = null,
        staffCursor: unknown = null,
        accountsDone = false,
        staffDone = false;
      const result = new Map<string, StaffRow>();
      do {
        const data = await api({
          action: "registry-list",
          skipAccounts: accountsDone,
          skipStaff: staffDone,
          accountCursor,
          staffCursor,
        });
        for (const row of data.staff as StaffRow[]) result.set(row.uid, row);
        accountCursor = data.accountCursor;
        staffCursor = data.staffCursor;
        accountsDone = !accountCursor;
        staffDone = !staffCursor;
      } while (active && (!accountsDone || !staffDone));
      if (active) setRows([...result.values()]);
    };
    void load().catch(
      (error) => active && setNotice(errorMessage(error, language)),
    );
    return () => {
      active = false;
    };
  }, [api, language]);
  const lounge = lounges.find((row) => row.id === loungeId);
  const close = useCallback(() => setSession(null), []);
  const candidates = rows.filter(
    (row) =>
      row.station === station &&
      row.registration.loungeIds?.includes(loungeId) &&
      row.hasPhoto &&
      ["PendingReview", "Active"].includes(row.registration.status || ""),
  );
  const begin = async () => {
    setBusy(true);
    setNotice("");
    try {
      const data = await api({
        action: "registry-browser-reference",
        uid,
        loungeId,
        consent,
      });
      setSession(data as unknown as Session);
    } catch (error) {
      setNotice(errorMessage(error, language));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sa-panel">
      <h2>{t("Uji wajah di browser", "Browser face comparison")}</h2>
      <p>
        {t(
          "Jalankan pencocokan satu wajah dengan satu petugas yang dipilih, tanpa server mesin tambahan. Foto repository tidak memerlukan Firebase Storage.",
          "Compare one face with one selected staff reference without an additional engine server. Repository photos do not require Firebase Storage.",
        )}
      </p>
      <p className="sa-help">
        {t(
          "Di Registrasi Petugas, simpan dan ajukan foto terlebih dahulu. Untuk demo ini, foto yang menunggu peninjauan dapat digunakan tanpa mengaktifkan pendaftaran pada mesin server. Hasil browser tidak mengubah status akses atau membuka gerbang.",
          "Save and submit a photo in Staff Registration first. Pending-review photos can be used in this demo without activating server enrollment. Browser results do not change access status or open a gate.",
        )}
      </p>
      <div className="sa-fields">
        <label>
          {t("Station demo", "Demo station")}
          <select
          aria-label={t("Station demo", "Demo station")}
          value={station}
            onChange={(e) => {
              setStation(e.target.value);
              setLoungeId("");
              setUid("");
              setConsent(false);
              setVideoId("");
            }}
          >
            <option value="">{t("Pilih station", "Select station")}</option>
            {stations.map((row) => (
              <option key={row.code} value={row.code}>
                {row.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Lounge demo", "Demo lounge")}
          <select
          aria-label={t("Lounge demo", "Demo lounge")}
          value={loungeId}
            onChange={(e) => {
              setLoungeId(e.target.value);
              setUid("");
              setConsent(false);
            }}
          >
            <option value="">{t("Pilih lounge", "Select lounge")}</option>
            {lounges
              .filter(
                (row) => row.airport === station && row.status === "Aktif",
              )
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("Petugas untuk pencocokan", "Staff reference for comparison")}
          <select
          aria-label={t("Petugas untuk pencocokan", "Staff reference for comparison")}
          value={uid}
            onChange={(e) => {
              setUid(e.target.value);
              setConsent(false);
            }}
          >
            <option value="">
              {t("Pilih satu petugas", "Select one staff member")}
            </option>
            {candidates.map((row) => (
              <option key={row.uid} value={row.uid}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Orientasi layar demo", "Demo display orientation")}
          <select
          aria-label={t("Orientasi layar demo", "Demo display orientation")}
          value={orientation}
            onChange={(e) =>
              setOrientation(e.target.value as "landscape" | "portrait")
            }
          >
            <option value="landscape">
              {t("Mendatar", "Landscape")} · 16:9
            </option>
            <option value="portrait">{t("Tegak", "Portrait")} · 9:16</option>
          </select>
        </label>
        <label>
          {t("Video saat siaga", "Idle video")}
          <select aria-label={t("Video saat siaga", "Idle video")} value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            <option value="">{t("Layar sambutan", "Welcome screen")}</option>
            {videos
              .filter((row) => ["ALL", station].includes(row.station))
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      {loungeId && !candidates.length && (
        <p role="status">
          {t(
            "Belum ada foto yang diajukan untuk petugas di lounge ini. Tambahkan foto melalui Registrasi Petugas, lalu kembali ke halaman ini.",
            "No staff photos have been submitted for this lounge. Add a photo in Staff Registration, then return here.",
          )}
        </p>
      )}
      <label className="sa-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          {t(
            "Petugas menyetujui pencocokan wajah untuk sesi demo ini.",
            "The staff member consents to face comparison for this demo session.",
          )}
        </span>
      </label>
      <button
        type="button"
        className="sa-primary"
        disabled={busy || !uid || !lounge || !consent}
        onClick={() => void begin()}
      >
        {busy
          ? t("Menyiapkan sesi…", "Preparing session…")
          : t("Buka kamera demo", "Open demo camera")}
      </button>
      <p className="sa-help">
        {t(
          "Model dimuat pada penggunaan pertama. Sesi berlaku 10 menit. Gunakan perangkat berkamera dan tekan Esc untuk menutup layar.",
          "Models load on first use. The session lasts 10 minutes. Use a device with a camera and press Esc to close the display.",
        )}
      </p>
      {notice && <p role="alert">{notice}</p>}
      {session && lounge && (
        <BrowserDemoScreen
          session={session}
          language={language}
          lounge={lounge}
          orientation={orientation}
          videoUrl={videos.find((row) => row.id === videoId)?.sourceUrl}
          onClose={close}
        />
      )}
    </section>
  );
}
function BrowserDemoScreen({
  session,
  language,
  lounge,
  orientation,
  videoUrl,
  onClose,
}: {
  session: Session;
  language: Language;
  lounge: Lounge;
  orientation: "landscape" | "portrait";
  videoUrl?: string;
  onClose: () => void;
}) {
  const t = useCallback(
    (id: string, en: string) => (language === "ID" ? id : en),
    [language],
  );
  const { video, ready, cameraError, start, stop } = useCapture();
  const [engineReady, setEngineReady] = useState(false),
    [phase, setPhase] = useState("camera"),
    [progress, setProgress] = useState("models"),
    [message, setMessage] = useState(""),
    [matched, setMatched] = useState(false),
    [videoFailed, setVideoFailed] = useState(false);
  const client = useRef<BrowserFaceClient | null>(null),
    startRef = useRef(start),
    resultUntil = useRef(0),
    awaitingExit = useRef(false);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    let active = true;
    let checkingReference = false;
    const instance = new BrowserFaceClient((value) => {
      if (active) {
        setProgress(value);
        if (value === "face") {
          setPhase("camera");
          setMessage(language === "ID" ? "Memverifikasi wajah Anda…" : "Verifying your face…");
        }
      }
    });
    client.current = instance;
    void instance
      .initialize()
      .then(() => { checkingReference = true; return instance.reference(session.photo); })
      .then(() => {
        if (active) setEngineReady(true);
      })
      .catch((error) => {
        instance.close();
        if (active) setMessage((checkingReference ? (language === "ID" ? "Foto referensi belum dapat digunakan. Periksa foto di Registrasi Petugas. " : "The reference photo could not be used. Check the photo in Staff Registration. ") : "") + errorMessage(error, language));
      });
    return () => {
      active = false;
      instance.close();
      client.current = null;
    };
  }, [session, language]);
  useEffect(() => {
    void startRef.current();
    const overlay = document.querySelector<HTMLElement>(
        "[data-browser-engine]",
      ),
      previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.body.children).filter(
      (el) => el !== overlay && !el.contains(overlay),
    );
    const inert = new Set(background.filter((el) => el.hasAttribute("inert")));
    background.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => {
      stop();
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", key);
      background.forEach((el) => {
        if (!inert.has(el)) el.removeAttribute("inert");
      });
      previous?.focus();
    };
  }, [stop, onClose]);
  useEffect(() => {
    if (!ready || !engineReady) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (Date.now() >= Date.parse(session.expiresAt)) {
        client.current?.close();
        setPhase("camera");
        setMessage(
          t(
            "Sesi telah berakhir. Siapkan sesi baru melalui operator.",
            "The session has ended. Ask the operator to prepare a new session.",
          ),
        );
        return;
      }
      try {
        if (Date.now() < resultUntil.current) return;
        if (!video.current || !client.current) return;
        setMessage("");
        const result = await (awaitingExit.current
          ? client.current.detect(video.current)
          : client.current.compare(video.current));
        if (!active) return;
        if (result.faceCount === 0) {
          awaitingExit.current = false;
          setPhase("idle");
        } else if (result.faceCount !== 1) {
          setPhase("camera");
          setMessage(
            t(
              "Mohon satu orang di depan kamera.",
              "Please stand in front of the camera one person at a time.",
            ),
          );
        } else if (awaitingExit.current) {
          setPhase("camera");
          setMessage(
            t(
              "Pencocokan selesai. Silakan menjauh dari kamera.",
              "Comparison complete. Please step away from the camera.",
            ),
          );
        } else {
          setMatched(result.matched === true);
          setPhase("result");
          awaitingExit.current = true;
          resultUntil.current = Date.now() + 6000;
        }
      } catch (error) {
        if (active) {
          setPhase("camera");
          setMessage(errorMessage(error, language));
        }
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ready, engineReady, session, video, language, t]);
  return createPortal(
    <div
      className={`sa-root sa-display sa-display-only ${orientation}`}
      data-native-language="true"
      data-browser-engine="true"
      data-phase={phase}
      data-engine-ready={engineReady}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("Layar pencocokan browser", "Browser comparison display")}
      lang={language === "ID" ? "id" : "en"}
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
          {lounge.name}
          <small>{lounge.airport}</small>
        </div>
      </header>
      <main className="sa-display-body">
        <div
          className={`sa-live-camera ${phase === "camera" ? "visible" : ""}`}
        >
          <video ref={video} autoPlay muted playsInline />
          <div className="sa-face-guide" />
          <div className="sa-camera-caption">
            <h1>{t("Lihat ke arah kamera", "Look at the camera")}</h1>
            <p>
              {cameraError
                ? t(
                    "Kamera tidak dapat diakses. Periksa izin kamera melalui operator.",
                    "The camera is unavailable. Ask the operator to check camera permissions.",
                  )
                : message ||
                  (!ready
                    ? t("Menyiapkan kamera…", "Preparing camera…")
                    : !engineReady
                      ? progress === "models"
                        ? t(
                            "Memuat model pencocokan. Mohon tunggu…",
                            "Loading comparison models. Please wait…",
                          )
                        : t(
                            "Menyiapkan mesin pencocokan…",
                            "Preparing the comparison engine…",
                          )
                      : t(
                          "Posisikan wajah di dalam bingkai.",
                          "Position your face within the frame.",
                        ))}
            </p>
          </div>
        </div>
        {phase === "idle" && (
          <div className="sa-display-idle">
            {videoUrl && !videoFailed ? (
              <video
                className="sa-idle-video"
                src={videoUrl}
                autoPlay
                loop
                muted
                playsInline
                onError={() => setVideoFailed(true)}
              />
            ) : (
              <div className="sa-ambient">
                <img src="/garuda-wing.svg" alt="" />
                <h1>{t("Selamat datang", "Welcome")}</h1>
                <h2>{lounge.name}</h2>
              </div>
            )}
            <div className="sa-idle-status">
              {t("Kamera siap", "Camera ready")}
            </div>
          </div>
        )}
        {phase === "result" && (
          <div className="sa-result-panel" aria-live="polite">
            <div className="sa-result-symbol">{matched ? "✓" : "i"}</div>
            <h1>
              {matched
                ? t("Wajah sesuai referensi", "Face matches the reference")
                : t(
                    "Wajah belum sesuai referensi",
                    "Face does not match the reference",
                  )}
            </h1>
            {matched && (
              <>
                <h2>{session.displayName}</h2>
                <p>{session.unit}</p>
              </>
            )}
            <p>
              {t(
                "Konfirmasi akses dilakukan oleh petugas.",
                "A staff member will confirm access.",
              )}
            </p>
          </div>
        )}
      </main>
      <footer className="sa-display-footer">
        <span>{lounge.name}</span>
        <span>GARUDA INDONESIA</span>
      </footer>
    </div>,
    document.body,
  );
}

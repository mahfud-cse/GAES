"use client";
/* eslint-disable @next/next/no-img-element */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { User } from "firebase/auth";
import QRCode from "qrcode";
import Link from "next/link";
import { seamlessOperationsRequest } from "../lib/firebase/api";
import SeamlessStaff from "./seamless-staff";
import {
  errorMessage,
  StatusTag,
  useCapture,
  type Language,
} from "./seamless-shared";
import "./seamless.css";
type Lounge = { id: string; name: string; airport: string; status: string };
type Video = { id: string; title: string; sourceUrl: string; station: string };
type Layout = { id: string; title: string; loungeId: string; station: string };
type Result = {
  id: string;
  createdAt: string;
  category: string;
  decision: string;
  gate: string;
  reason?: string;
  displayName?: string;
  unit?: string;
  flight?: string;
  status?: string;
};
type Bootstrap = {
  canManage: boolean;
  integration: { identity: boolean; entitlement: boolean; gate: boolean };
  stations: { code: string; name: string }[];
  videos: Video[];
  layouts: Layout[];
};
const empty: Bootstrap = {
  canManage: false,
  integration: { identity: false, entitlement: false, gate: false },
  stations: [],
  videos: [],
  layouts: [],
};
export default function SeamlessAccess({
  user,
  role,
  lounges,
  initialLoungeId,
  stations = [],
  language = "ID",
  onLanguageChange,
  onDocumentVerification,
}: {
  user: User;
  role: string;
  lounges: Lounge[];
  initialLoungeId: string;
  stations?: { code: string; name: string; status?: string }[];
  language?: Language;
  onLanguageChange?: (value: Language) => void;
  onDocumentVerification?: () => void;
}) {
  const t = (id: string, en: string) => (language === "ID" ? id : en);
  const [data, setData] = useState<Bootstrap>(empty),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("operation");
  const [station, setStation] = useState(
      lounges.find((l) => l.id === initialLoungeId)?.airport || "",
    ),
    [loungeId, setLoungeId] = useState(initialLoungeId),
    [videoId, setVideoId] = useState(""),
    [layoutId, setLayoutId] = useState(""),
    [settingsLoaded, setSettingsLoaded] = useState(false);
  const [kiosk, setKiosk] = useState(false),
    [phase, setPhase] = useState("standby"),
    [category, setCategory] = useState("Passenger"),
    [credential, setCredential] = useState(""),
    [consent, setConsent] = useState(false),
    [sessionId, setSessionId] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [qr, setQr] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [activity, setActivity] = useState<Result[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [videoError, setVideoError] = useState(false);
  const {
    video: videoRef,
    ready: cameraReady,
    cameraError,
    start: startCamera,
    stop: stopCamera,
    capture: capturePhoto,
  } = useCapture();
  const inflight = useRef(false),
    pending = useRef<{
      sessionId: string;
      requestId: string;
      capture: string;
    } | null>(null),
    location = useRef(loungeId),
    languageRef = useRef(language);
  useEffect(() => {
    setNotice("");
  }, [language]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const api = useCallback(
    (p: Record<string, unknown>) => seamlessOperationsRequest(user, p),
    [user],
  );
  const refreshBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      setData((await api({ action: "bootstrap" })) as unknown as Bootstrap);
      setNotice("");
    } catch (e) {
      setNotice(errorMessage(e, languageRef.current));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);
  const loadActivity = useCallback(
    async (next?: string) => {
      if (!loungeId) return;
      const d = await api({ action: "activity", loungeId, cursor: next });
      if (location.current !== loungeId) return;
      setActivity((old) =>
        next ? [...old, ...(d.activity as Result[])] : (d.activity as Result[]),
      );
      setCursor(d.nextCursor as string | null);
    },
    [api, loungeId],
  );
  useEffect(() => {
    location.current = loungeId;
    setResult(null);
    setCredential("");
    setConsent(false);
    setPhase("standby");
    pending.current = null;
    setActivity([]);
    setCursor(null);
    setSessionId("");
    setVideoId("");
    setLayoutId("");
    setSettingsLoaded(false);
    let active = true;
    if (loungeId) {
      void loadActivity().catch(
        (e) => active && setNotice(errorMessage(e, languageRef.current)),
      );
      void api({ action: "display-settings", loungeId })
        .then((d) => {
          if (active) {
            const s = d.settings as { videoId: string; layoutId: string };
            setVideoId(s.videoId);
            setLayoutId(s.layoutId);
            setSettingsLoaded(true);
          }
        })
        .catch(
          (e) => active && setNotice(errorMessage(e, languageRef.current)),
        );
    }
    return () => {
      active = false;
    };
  }, [api, loungeId, loadActivity]);
  const lounge = lounges.find((l) => l.id === loungeId),
    activeVideo = data.videos.find(
      (v) => v.id === videoId && ["ALL", station].includes(v.station),
    ),
    activeLayout = data.layouts.find(
      (l) => l.id === layoutId && l.loungeId === loungeId,
    );
  useEffect(() => {
    setVideoError(false);
  }, [videoId]);
  useEffect(() => {
    let active = true;
    setQr("");
    if (activeLayout) {
      void QRCode.toDataURL(
        `${window.location.origin}/lounge-map/${encodeURIComponent(activeLayout.id)}`,
        { width: 220, margin: 2, errorCorrectionLevel: "M" },
      )
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [activeLayout]);
  useEffect(() => {
    if (!kiosk) stopCamera();
  }, [kiosk, stopCamera]);
  useEffect(() => {
    if (!kiosk || !["result", "assistance"].includes(phase)) return;
    const timer = setTimeout(() => {
      stopCamera();
      setResult(null);
      setCredential("");
      setConsent(false);
      setSessionId("");
      pending.current = null;
      setPhase("standby");
      setNotice("");
    }, 16000);
    return () => clearTimeout(timer);
  }, [kiosk, phase, stopCamera]);
  const verify = async () => {
    if (inflight.current || !sessionId) return;
    inflight.current = true;
    setBusy(true);
    setNotice("");
    try {
      if (!pending.current)
        pending.current = {
          sessionId,
          requestId: crypto.randomUUID(),
          capture: capturePhoto(),
        };
      stopCamera();
      setPhase("verifying");
      const d = await api({ action: "verify-one-to-one", ...pending.current });
      if (["Processing", "GatePending"].includes(d.status as string)) {
        setNotice(
          t(
            "Verifikasi sedang diproses. Periksa status permintaan yang sama.",
            "Verification is processing. Check the same request for its status.",
          ),
        );
        setPhase("pending");
        return;
      }
      const r = d as unknown as Result;
      setResult(r);
      pending.current = null;
      setSessionId("");
      setPhase(
        r.decision === "Eligible" && r.gate === "OpenConfirmed"
          ? "result"
          : "assistance",
      );
      void loadActivity().catch(() => {});
    } catch (e) {
      setNotice(errorMessage(e, language));
      setPhase(pending.current ? "pending" : "assistance");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  const claim = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setNotice("");
    setResult(null);
    try {
      const d = await api({
        action: "claim",
        category,
        credential,
        consent,
        loungeId,
      });
      setSessionId(d.sessionId as string);
      setCredential("");
      setConsent(false);
      setPhase("capture");
      pending.current = null;
    } catch (e) {
      setNotice(errorMessage(e, language));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  // After a claimed 1:1 session and explicit camera consent, capture automatically after 3 seconds.
  useEffect(() => {
    if (phase !== "capture" || !cameraReady || !sessionId) return;
    const timer = setTimeout(() => void verify(), 3000);
    return () => clearTimeout(timer);
  });
  const reset = () => {
    stopCamera();
    pending.current = null;
    setSessionId("");
    setResult(null);
    setCredential("");
    setConsent(false);
    setNotice("");
    setPhase("standby");
  };
  const documentNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    stopCamera();
    setKiosk(false);
    if (onDocumentVerification) onDocumentVerification();
    else window.location.assign("/?view=access");
  };
  useEffect(() => {
    if (!kiosk) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(".sa-display");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = focusable(),
        first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [kiosk]);
  const saveSettings = async () => {
    setBusy(true);
    try {
      await api({
        action: "display-settings-save",
        loungeId,
        videoId,
        layoutId,
      });
      setNotice(t("Pengaturan layar disimpan.", "Display settings saved."));
    } catch (e) {
      setNotice(errorMessage(e, language));
    } finally {
      setBusy(false);
    }
  };
  const gateLabel = (value: string) =>
    ({
      OpenConfirmed: t("Terbuka terkonfirmasi", "Open confirmed"),
      NotRequested: t("Tidak diperintahkan", "Not requested"),
      Unconfirmed: t("Belum terkonfirmasi", "Unconfirmed"),
      Unavailable: t("Belum terhubung", "Not connected"),
      Pending: t("Menunggu konfirmasi", "Awaiting confirmation"),
    })[value] || "—";
  if (
    ![
      "Super Admin",
      "Admin",
      "HO Admin",
      "BO Admin",
      "Lounge Officer",
      "Lounge Manager",
    ].includes(role)
  )
    return (
      <p role="alert">
        {t(
          "Akun tidak memiliki akses Seamless.",
          "Your account does not have Seamless access.",
        )}
      </p>
    );
  return (
    <section
      className="sa-root"
      data-native-language="true"
      lang={language === "ID" ? "id" : "en"}
    >
      <div className="sa-page-heading">
        <div>
          <p className="sa-eyebrow">LOUNGE / TENANT ACCESS</p>
          <h1>Seamless Access</h1>
          <p>
            {t(
              "Sambutan yang personal. Akses yang terverifikasi.",
              "A personal welcome. Verified access.",
            )}
          </p>
        </div>
        <Link
          className="sa-button"
          href="/?view=access"
          onClick={documentNavigation}
        >
          {t("Verifikasi dokumen", "Document verification")} ↗
        </Link>
      </div>
      <nav
        className="sa-tabs"
        aria-label={t("Navigasi Seamless", "Seamless navigation")}
      >
        {[
          [
            "operation",
            t("Operasional & layar lounge", "Operations & lounge display"),
          ],
          ...(data.canManage
            ? [["staff", t("Registrasi petugas", "Staff registration")]]
            : []),
          ["activity", t("Aktivitas akses", "Access activity")],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setTab(key);
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && !kiosk && (
        <div className="sa-notice" role="status">
          {notice}
          <button
            type="button"
            aria-label={t("Tutup notifikasi", "Dismiss notification")}
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {loading ? (
        <div className="sa-panel sa-empty" role="status">
          {t("Memuat pengaturan akses…", "Loading access settings…")}
        </div>
      ) : (
        <>
          {tab === "operation" && (
            <div className="sa-operation-layout">
              <div>
                <section className="sa-panel">
                  <div className="sa-section-heading">
                    <div>
                      <p className="sa-eyebrow">
                        {t("LOKASI AKSES", "ACCESS LOCATION")}
                      </p>
                      <h2>
                        {t(
                          "Siapkan layar lounge",
                          "Prepare the lounge display",
                        )}
                      </h2>
                    </div>
                    <span className="sa-tag">{station || "—"}</span>
                  </div>
                  <div className="sa-fields">
                    <label>
                      Station
                      <select
                        aria-label="Station"
                        value={station}
                        disabled={busy}
                        onChange={(e) => {
                          setStation(e.target.value);
                          setLoungeId("");
                          reset();
                        }}
                      >
                        <option value="">
                          {t("Pilih station", "Select station")}
                        </option>
                        {(data.stations.length
                          ? data.stations
                          : stations.filter(
                              (s) => !s.status || s.status === "Aktif",
                            )
                        )
                          .filter(
                            (s, idx, all) =>
                              all.findIndex((v) => v.code === s.code) === idx,
                          )
                          .map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.code}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Lounge
                      <select
                        value={loungeId}
                        disabled={busy}
                        onChange={(e) => {
                          reset();
                          setLoungeId(e.target.value);
                        }}
                      >
                        <option value="">
                          {t("Pilih lounge", "Select lounge")}
                        </option>
                        {lounges
                          .filter(
                            (l) =>
                              l.airport === station && l.status === "Aktif",
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {data.canManage && (
                      <>
                        <label>
                          {t("Video saat standby", "Standby video")}
                          <select
                            value={videoId}
                            disabled={!settingsLoaded || busy}
                            onChange={(e) => setVideoId(e.target.value)}
                          >
                            <option value="">
                              {t(
                                "Layar sambutan tanpa video",
                                "Welcome screen without video",
                              )}
                            </option>
                            {data.videos
                              .filter((v) =>
                                ["ALL", station].includes(v.station),
                              )
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          {t("Denah lounge", "Lounge map")}
                          <select
                            value={layoutId}
                            disabled={!settingsLoaded || busy}
                            onChange={(e) => setLayoutId(e.target.value)}
                          >
                            <option value="">
                              {t("Tanpa QR denah", "Without map QR")}
                            </option>
                            {data.layouts
                              .filter(
                                (l) =>
                                  l.loungeId === loungeId &&
                                  l.station === station,
                              )
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.title}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <p className="sa-help">
                    {t(
                      "Video menggunakan Pustaka Konten TV & Digital Signage. QR hanya mengarah ke denah lounge yang sudah dipublikasikan.",
                      "Videos use the TV & Digital Signage Content Library. QR codes link only to a published lounge map.",
                    )}
                  </p>
                  <div className="sa-actions">
                    {data.canManage && (
                      <button
                        type="button"
                        disabled={!lounge || !settingsLoaded || busy}
                        onClick={() => void saveSettings()}
                      >
                        {t("Simpan pengaturan", "Save settings")}
                      </button>
                    )}
                    <button
                      className="sa-primary"
                      type="button"
                      disabled={!lounge || busy || !settingsLoaded}
                      onClick={() => {
                        reset();
                        setKiosk(true);
                      }}
                    >
                      {t("Buka layar lounge", "Open lounge display")} ↗
                    </button>
                  </div>
                </section>
                <section className="sa-panel">
                  <h3>{t("Status integrasi", "Integration status")}</h3>
                  <div className="sa-integration-list">
                    {[
                      [
                        t("Verifikasi wajah 1:1", "1:1 face verification"),
                        data.integration.identity,
                      ],
                      [
                        t("Hak akses penumpang", "Passenger entitlement"),
                        data.integration.entitlement,
                      ],
                      ["Autogate", data.integration.gate],
                    ].map(([label, ok]) => (
                      <div key={String(label)}>
                        <span>{label}</span>
                        <span className={`sa-tag ${ok ? "positive" : ""}`}>
                          {ok
                            ? t("Terhubung", "Connected")
                            : t("Belum terhubung", "Not connected")}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="sa-help">
                    {t(
                      "Registrasi foto tidak otomatis mengaktifkan akses. Hak akses dan konfirmasi gerbang diperiksa terpisah.",
                      "Photo registration does not automatically activate access. Entitlement and gate confirmation are checked separately.",
                    )}
                  </p>
                  <button type="button" onClick={() => void refreshBootstrap()}>
                    {t("Periksa koneksi", "Check connections")}
                  </button>
                </section>
              </div>
              <section className="sa-lounge-preview">
                <div className="sa-preview-top">
                  <span>{t("TAMPILAN LAYAR LOUNGE", "LOUNGE DISPLAY")}</span>
                  <span>ID / EN</span>
                </div>
                <div className="sa-preview-body">
                  <img
                    src="/garuda-wing.svg"
                    alt="Garuda Indonesia"
                    width="56"
                    height="56"
                  />
                  <p className="sa-eyebrow">{station || "GARUDA INDONESIA"}</p>
                  <h2>{t("Selamat datang", "Welcome")}</h2>
                  <h3>
                    {lounge?.name ||
                      t(
                        "Pilih lounge untuk memulai",
                        "Select a lounge to begin",
                      )}
                  </h3>
                  <p>
                    {t(
                      "Nikmati kenyamanan sebelum perjalanan Anda.",
                      "Enjoy a moment of comfort before your journey.",
                    )}
                  </p>
                  <div className="sa-preview-line" />
                  <p className="sa-help">
                    {t(
                      "Verifikasi wajah melalui sesi identitas pribadi, atau gunakan verifikasi dokumen.",
                      "Verify your face through a personal identity session, or use document verification.",
                    )}
                  </p>
                  {qr && (
                    <div className="sa-map-mini">
                      <img
                        src={qr}
                        alt={t("QR denah lounge", "Lounge map QR")}
                      />
                      <span>
                        {t(
                          "Jelajahi fasilitas lounge",
                          "Explore lounge facilities",
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <div className="sa-preview-footer">
                  GARUDA INDONESIA <span>LOUNGE EXPERIENCE</span>
                </div>
              </section>
            </div>
          )}
          {tab === "staff" && data.canManage && (
            <SeamlessStaff
              api={api}
              language={language}
              stations={data.stations.length ? data.stations : stations}
              lounges={lounges}
              identityConnected={data.integration.identity}
            />
          )}
          {tab === "activity" && (
            <section className="sa-panel">
              <div className="sa-section-heading">
                <div>
                  <p className="sa-eyebrow">
                    {t("RIWAYAT OPERASIONAL", "OPERATIONAL HISTORY")}
                  </p>
                  <h2>{t("Aktivitas akses", "Access activity")}</h2>
                  <p>
                    {lounge?.name ||
                      t(
                        "Pilih lokasi pada tab operasional.",
                        "Select a location in the operations tab.",
                      )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!loungeId || busy}
                  onClick={() =>
                    void loadActivity().catch((e) =>
                      setNotice(errorMessage(e, language)),
                    )
                  }
                >
                  {t("Muat ulang", "Refresh")}
                </button>
              </div>
              <div className="sa-fields">
                <label>
                  {t("Cari aktivitas yang dimuat", "Search loaded activity")}
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("Kategori atau waktu", "Category or time")}
                  />
                </label>
                <label>
                  {t("Hasil akses", "Access result")}
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="All">
                      {t("Semua hasil", "All results")}
                    </option>
                    <option value="Eligible">
                      {t("Diizinkan", "Authorized")}
                    </option>
                    <option value="Rejected">
                      {t("Perlu bantuan", "Assistance needed")}
                    </option>
                    <option value="Pending">
                      {t("Menunggu hasil", "Pending")}
                    </option>
                  </select>
                </label>
              </div>
              <div className="sa-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        t("Waktu", "Time"),
                        t("Kategori", "Category"),
                        t("Hasil", "Result"),
                        t("Gerbang", "Gate"),
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activity
                      .filter(
                        (x) =>
                          (filter === "All" || x.decision === filter) &&
                          `${x.category} ${x.createdAt}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      )
                      .map((x) => (
                        <tr key={x.id}>
                          <td>
                            {new Date(x.createdAt).toLocaleString(
                              language === "ID" ? "id-ID" : "en-GB",
                            )}
                          </td>
                          <td>
                            {x.category === "Staff"
                              ? t("Petugas", "Staff")
                              : t("Penumpang", "Passenger")}
                          </td>
                          <td>
                            <StatusTag value={x.decision} language={language} />
                          </td>
                          <td>{gateLabel(x.gate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!activity.length && (
                  <div className="sa-empty">
                    {t(
                      "Belum ada aktivitas akses pada lokasi ini.",
                      "No access activity at this location yet.",
                    )}
                  </div>
                )}
              </div>
              {cursor && (
                <button
                  type="button"
                  onClick={() =>
                    void loadActivity(cursor).catch((e) =>
                      setNotice(errorMessage(e, language)),
                    )
                  }
                >
                  {t("Muat aktivitas berikutnya", "Load more activity")}
                </button>
              )}
            </section>
          )}
        </>
      )}
      {kiosk && (
        <div
          className="sa-display"
          role="dialog"
          aria-modal="true"
          aria-label={t("Layar lounge", "Lounge display")}
        >
          <header className="sa-display-header">
            <div className="sa-brand">
              <img
                src="/garuda-wing.svg"
                width="42"
                height="42"
                alt="Garuda Indonesia"
              />
              <span>
                GARUDA INDONESIA<small>LOUNGE EXPERIENCE</small>
              </span>
            </div>
            <div className="sa-display-location">
              {lounge?.name}
              <small>{station}</small>
            </div>
            <div className="sa-actions">
              <button
                type="button"
                aria-label={t("Ganti bahasa", "Change language")}
                onClick={() =>
                  onLanguageChange?.(language === "ID" ? "EN" : "ID")
                }
              >
                {language === "ID" ? "EN" : "ID"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  reset();
                  setKiosk(false);
                }}
              >
                {t("Tutup layar", "Close display")}
              </button>
            </div>
          </header>
          <div className="sa-display-body">
            {phase === "standby" && (
              <>
                <div className="sa-welcome-copy">
                  <p className="sa-eyebrow">
                    {t("WAKTU UNTUK BERSANTAI", "A MOMENT TO UNWIND")}
                  </p>
                  <h1>
                    {t("Selamat datang", "Welcome")}
                    <br />
                    <span>{t("di lounge Anda.", "to your lounge.")}</span>
                  </h1>
                  <p>
                    {t(
                      "Nikmati kenyamanan sebelum perjalanan Anda.",
                      "Enjoy a moment of comfort before your journey.",
                    )}
                  </p>
                  <button
                    className="sa-primary"
                    type="button"
                    onClick={() => setPhase("identity")}
                  >
                    {t("Mulai verifikasi wajah", "Start face verification")} →
                  </button>
                  <Link
                    href="/?view=access"
                    onClick={documentNavigation}
                    className="sa-fallback"
                  >
                    {t(
                      "Belum terdaftar? Gunakan Boarding Pass / QR / kartu petugas",
                      "Not registered? Use Boarding Pass / QR / staff card",
                    )}
                  </Link>
                </div>
                <div className="sa-standby-media">
                  {activeVideo && !videoError ? (
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      src={activeVideo.sourceUrl}
                      onError={() => setVideoError(true)}
                      aria-label={t("Video lounge", "Lounge video")}
                    />
                  ) : (
                    <div className="sa-ambient">
                      <span className="sa-ambient-line" />
                      <img src="/garuda-wing.svg" alt="" />
                      <h2>{lounge?.name}</h2>
                      <p>
                        {t(
                          "Perjalanan yang nyaman dimulai di sini.",
                          "A comfortable journey begins here.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
            {phase === "identity" && (
              <div className="sa-identity-panel">
                <p className="sa-eyebrow">
                  {t("SESI IDENTITAS PRIBADI", "PERSONAL IDENTITY SESSION")}
                </p>
                <h1>{t("Verifikasi akses Anda", "Verify your access")}</h1>
                <p>
                  {t(
                    "Tentukan satu identitas untuk dicocokkan dengan wajah Anda.",
                    "Identify the single identity to compare with your face.",
                  )}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void claim();
                  }}
                >
                  <fieldset disabled={busy}>
                    <div className="sa-fields">
                      <label>
                        {t("Jenis akses", "Access type")}
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="Passenger">
                            {t("Penumpang", "Passenger")}
                          </option>
                          <option value="Staff">{t("Petugas", "Staff")}</option>
                        </select>
                      </label>
                      <label>
                        {category === "Staff"
                          ? t(
                              "Nomor pegawai / kartu petugas",
                              "Employee number / staff card",
                            )
                          : t(
                              "Referensi sesi check-in",
                              "Check-in session reference",
                            )}
                        <input
                          autoFocus
                          required
                          maxLength={300}
                          autoComplete="off"
                          value={credential}
                          onChange={(e) => setCredential(e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="sa-check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        {t(
                          "Saya menyetujui pencocokan wajah dengan referensi identitas saya untuk akses ini.",
                          "I consent to comparing my face with my identity reference for this access.",
                        )}
                      </span>
                    </label>
                    <button
                      type="submit"
                      className="sa-primary"
                      disabled={
                        !consent ||
                        !credential ||
                        !data.integration.identity ||
                        (category === "Passenger" &&
                          !data.integration.entitlement)
                      }
                    >
                      {busy
                        ? t("Menyiapkan sesi…", "Preparing session…")
                        : t("Lanjutkan", "Continue")}
                    </button>
                  </fieldset>
                </form>
                {(!data.integration.identity ||
                  (category === "Passenger" &&
                    !data.integration.entitlement)) && (
                  <p className="sa-guest-message" role="status">
                    {t(
                      "Verifikasi wajah belum tersedia. Silakan gunakan verifikasi dokumen atau hubungi petugas.",
                      "Face verification is unavailable. Please use document verification or ask a staff member for assistance.",
                    )}
                  </p>
                )}
                <button type="button" onClick={reset}>
                  {t("Kembali", "Back")}
                </button>
                <Link
                  className="sa-fallback"
                  href="/?view=access"
                  onClick={documentNavigation}
                >
                  {t("Gunakan verifikasi dokumen", "Use document verification")}
                </Link>
              </div>
            )}
            {phase === "capture" && (
              <div className="sa-capture-panel">
                <p className="sa-eyebrow">
                  {t("VERIFIKASI WAJAH", "FACE VERIFICATION")}
                </p>
                <h1>{t("Lihat ke arah kamera", "Look at the camera")}</h1>
                <p>
                  {t(
                    "Posisikan wajah di dalam bingkai. Pengambilan gambar dimulai setelah kamera siap.",
                    "Position your face within the guide. Capture starts once the camera is ready.",
                  )}
                </p>
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
                      "Kamera tidak tersedia. Periksa izin browser atau gunakan verifikasi dokumen.",
                      "Camera unavailable. Check browser permissions or use document verification.",
                    )}
                  </p>
                )}
                <button
                  className="sa-primary"
                  type="button"
                  disabled={cameraReady}
                  onClick={() => void startCamera()}
                >
                  {cameraReady
                    ? t("Mengambil gambar…", "Capturing…")
                    : t("Izinkan & aktifkan kamera", "Allow & enable camera")}
                </button>
                <button type="button" onClick={reset}>
                  {t("Batalkan", "Cancel")}
                </button>
              </div>
            )}
            {["verifying", "pending"].includes(phase) && (
              <div className="sa-result-panel">
                <div className="sa-verifying-ring" />
                <h1>{t("Memverifikasi akses", "Verifying access")}</h1>
                <p>
                  {phase === "pending"
                    ? t(
                        "Hasil belum terkonfirmasi. Jangan melewati gerbang.",
                        "The result is not confirmed. Do not pass through the gate.",
                      )
                    : t("Mohon tunggu sebentar.", "Please wait a moment.")}
                </p>
                {phase === "pending" && (
                  <button
                    type="button"
                    className="sa-primary"
                    disabled={busy}
                    onClick={() => void verify()}
                  >
                    {t("Periksa hasil permintaan", "Check request result")}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={reset}>
                  {t("Kembali ke layar sambutan", "Return to welcome screen")}
                </button>
              </div>
            )}
            {["result", "assistance"].includes(phase) && (
              <div
                className={`sa-result-panel ${phase === "result" ? "success" : ""}`}
                aria-live="polite"
              >
                <div className="sa-result-symbol">
                  {phase === "result" ? "✓" : "i"}
                </div>
                <p className="sa-eyebrow">
                  {result?.category === "Staff"
                    ? t("AKSES PETUGAS", "STAFF ACCESS")
                    : t("AKSES LOUNGE", "LOUNGE ACCESS")}
                </p>
                <h1>
                  {phase === "result"
                    ? result?.category === "Staff"
                      ? t(
                          "Akses petugas terverifikasi",
                          "Staff access verified",
                        )
                      : t("Selamat datang", "Welcome")
                    : t("Silakan hubungi petugas", "Please ask a staff member")}
                </h1>
                {phase === "result" && (
                  <>
                    <h2>
                      {result?.category === "Passenger"
                        ? `${t("di", "to")} ${lounge?.name}`
                        : result?.displayName}
                    </h2>
                    <p>
                      {result?.category === "Passenger"
                        ? `${result.displayName || ""}${result.flight ? ` · ${result.flight}` : ""}`
                        : result?.unit}
                    </p>
                    <p>
                      {result?.category === "Passenger"
                        ? t(
                            "Selamat menikmati layanan kami. Pindai kode QR untuk melihat denah, fasilitas, dan informasi lounge.",
                            "Enjoy your visit. Scan the QR code to explore the lounge map, facilities and information.",
                          )
                        : t(
                            "Identitas dan kewenangan akses telah diverifikasi.",
                            "Your identity and access authorization have been verified.",
                          )}
                    </p>
                    <span className="sa-tag positive">
                      {t(
                        "Gerbang terbuka terkonfirmasi",
                        "Gate opening confirmed",
                      )}
                    </span>
                    {result?.category === "Passenger" && qr && (
                      <img
                        className="sa-result-qr"
                        src={qr}
                        alt={t(
                          "Pindai QR untuk melihat denah lounge",
                          "Scan QR to view the lounge map",
                        )}
                      />
                    )}
                  </>
                )}
                {phase === "assistance" && (
                  <p>
                    {result?.reason
                      ? errorMessage(new Error(result.reason), language)
                      : t(
                          "Verifikasi atau pembukaan gerbang belum terkonfirmasi. Gunakan verifikasi dokumen untuk bantuan.",
                          "Verification or gate opening is not confirmed. Use document verification for assistance.",
                        )}
                  </p>
                )}
                <button type="button" onClick={reset}>
                  {t("Selesai", "Done")}
                </button>
              </div>
            )}
          </div>
          {notice && (
            <div className="sa-kiosk-notice" role="status">
              {notice}
            </div>
          )}
          <footer className="sa-display-footer">
            <span>
              {t(
                "Kenyamanan Anda, perhatian kami.",
                "Your comfort, our priority.",
              )}
            </span>
            <span>
              {phase !== "standby"
                ? t(
                    "Layar akan kembali otomatis setelah hasil ditampilkan.",
                    "The display returns automatically after showing the result.",
                  )
                : "GARUDA INDONESIA"}
            </span>
          </footer>
        </div>
      )}
    </section>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import QRCode from "qrcode";
import { seamlessOperationsRequest } from "../lib/firebase/api";
import SeamlessStaff from "./seamless-staff";
import SeamlessDisplay from "./seamless-display";
import { errorMessage, StatusTag, type Language } from "./seamless-shared";
import "./seamless.css";
type Lounge = { id: string; name: string; airport: string; status: string };
type Boot = {
  canManage: boolean;
  integration: {
    identity: boolean;
    liveness?: boolean;
    entitlement: boolean;
    gate: boolean;
  };
  stations: { code: string; name: string }[];
  videos: { id: string; title: string; sourceUrl: string; station: string }[];
  layouts: { id: string; title: string; loungeId: string; station: string }[];
};
type Attempt = {
  id: string;
  createdAt: string;
  category: string;
  decision: string;
  gate: string;
  faceMatched?: boolean;
};
const empty: Boot = {
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
  language = "ID",
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
  const [boot, setBoot] = useState<Boot>(empty),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("operation"),
    [busy, setBusy] = useState(false);
  const [station, setStation] = useState(""),
    [loungeId, setLoungeId] = useState(""),
    [videoId, setVideoId] = useState(""),
    [layoutId, setLayoutId] = useState(""),
    [orientation, setOrientation] = useState<"landscape" | "portrait">(
      "landscape",
    ),
    [settingsReady, setSettingsReady] = useState(false),
    [kiosk, setKiosk] = useState(false),
    [qr, setQr] = useState("");
  const [category, setCategory] = useState("Staff"),
    [credential, setCredential] = useState(""),
    [consent, setConsent] = useState(false);
  const [activityStation, setActivityStation] = useState(""),
    [activityLounge, setActivityLounge] = useState(""),
    [activity, setActivity] = useState<Attempt[]>([]),
    [activityCursor, setActivityCursor] = useState<string | null>(null),
    [activityLoading, setActivityLoading] = useState(false),
    [query, setQuery] = useState("");
  const langRef = useRef(language),
    locationRef = useRef(activityLounge);
  useEffect(() => {
    langRef.current = language;
    setNotice("");
  }, [language]);
  const api = useCallback(
    (payload: Record<string, unknown>) =>
      seamlessOperationsRequest(user, payload),
    [user],
  );
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBoot((await api({ action: "bootstrap" })) as unknown as Boot);
    } catch (e) {
      setNotice(errorMessage(e, langRef.current));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let current = true;
    setSettingsReady(false);
    setVideoId("");
    setLayoutId("");
    if (loungeId)
      void api({ action: "display-settings", loungeId })
        .then((d) => {
          if (current) {
            const s = d.settings as {
              videoId: string;
              layoutId: string;
              orientation?: "portrait" | "landscape";
            };
            setVideoId(s.videoId || "");
            setLayoutId(s.layoutId || "");
            setOrientation(s.orientation || "landscape");
            setSettingsReady(true);
          }
        })
        .catch((e) => current && setNotice(errorMessage(e, langRef.current)));
    return () => {
      current = false;
    };
  }, [api, loungeId]);
  const lounge = lounges.find((l) => l.id === loungeId),
    video = boot.videos.find(
      (v) => v.id === videoId && ["ALL", station].includes(v.station),
    ),
    layout = boot.layouts.find(
      (l) =>
        l.id === layoutId && l.loungeId === loungeId && l.station === station,
    );
  useEffect(() => {
    let active = true;
    setQr("");
    if (layout)
      void QRCode.toDataURL(
        `${window.location.origin}/lounge-map/${encodeURIComponent(layout.id)}`,
        { width: 200, margin: 2 },
      ).then((s) => active && setQr(s));
    return () => {
      active = false;
    };
  }, [layout]);
  const closeDisplay = useCallback(() => setKiosk(false), []);
  const save = async () => {
    setBusy(true);
    try {
      await api({
        action: "display-settings-save",
        loungeId,
        videoId,
        layoutId,
        orientation,
      });
      setNotice(t("Pengaturan layar disimpan.", "Display settings saved."));
    } catch (e) {
      setNotice(errorMessage(e, language));
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    setBusy(true);
    try {
      await api({ action: "claim", loungeId, category, credential, consent });
      setCredential("");
      setConsent(false);
      setNotice(
        t(
          "Sesi identitas siap. Layar lounge akan memproses satu wajah yang hadir.",
          "The identity session is ready. The lounge display will process the one face present.",
        ),
      );
    } catch (e) {
      setNotice(errorMessage(e, language));
    } finally {
      setBusy(false);
    }
  };
  const loadActivity = useCallback(
    async (cursor?: string) => {
      if (!activityLounge) return;
      setActivityLoading(true);
      try {
        const d = await api({
          action: "activity",
          loungeId: activityLounge,
          cursor,
        });
        if (locationRef.current !== activityLounge) return;
        setActivity((old) =>
          cursor
            ? [...old, ...(d.activity as Attempt[])]
            : (d.activity as Attempt[]),
        );
        setActivityCursor(d.nextCursor as string | null);
      } catch (e) {
        setNotice(errorMessage(e, langRef.current));
      } finally {
        setActivityLoading(false);
      }
    },
    [api, activityLounge],
  );
  useEffect(() => {
    locationRef.current = activityLounge;
    setActivity([]);
    setActivityCursor(null);
    if (activityLounge) void loadActivity();
  }, [activityLounge, loadActivity]);
  const canOperate = [
    "Super Admin",
    "Admin",
    "HO Admin",
    "BO Admin",
    "Lounge Officer",
    "Lounge Manager",
  ].includes(role);
  if (!canOperate)
    return (
      <p role="alert">
        {t("Akses tidak diizinkan.", "Access is not authorized.")}
      </p>
    );
  const filtered = activity.filter((a) =>
    `${a.category} ${a.createdAt} ${a.decision}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section
      className="sa-root"
      data-native-language="true"
      lang={language === "ID" ? "id" : "en"}
    >
      <div className="sa-page-heading">
        <div className="title">
          <p>LOUNGE / TENANT ACCESS</p>
          <h1>Seamless Access</h1>
          <span>
            {t(
              "Kelola registrasi petugas, verifikasi wajah, dan layar akses lounge.",
              "Manage staff registration, face verification and the lounge access display.",
            )}
          </span>
        </div>
        <button type="button" onClick={onDocumentVerification}>
          {t("Verifikasi dokumen", "Document verification")}
        </button>
      </div>
      <nav
        className="subTabs facilityTabs"
        aria-label={t("Navigasi Seamless", "Seamless navigation")}
      >
        {[
          [
            "operation",
            t("Operasional & Layar Lounge", "Operations & Lounge Display"),
          ],
          ...(boot.canManage
            ? [["staff", t("Registrasi Petugas", "Staff Registration")]]
            : []),
          ["activity", t("Aktivitas Akses", "Access Activity")],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? "portal-tab active" : "portal-tab"}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => {
              setTab(value);
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && (
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
        <section className="sa-panel" role="status">
          {t("Memuat master data…", "Loading master data…")}
        </section>
      ) : (
        <>
          {tab === "operation" && (
            <div className="sa-operation-layout">
              <div>
                <section className="sa-panel">
                  <h2>
                    {t("Pengaturan layar lounge", "Lounge display settings")}
                  </h2>
                  <div className="sa-fields">
                    <label>
                      Station
                      <select
                        aria-label="Station"
                        value={station}
                        onChange={(e) => {
                          setStation(e.target.value);
                          setLoungeId("");
                        }}
                      >
                        <option value="">
                          {t("Pilih station", "Select station")}
                        </option>
                        {boot.stations.map((s) => (
                          <option value={s.code} key={s.code}>
                            {s.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Lounge
                      <select
                        aria-label="Lounge"
                        value={loungeId}
                        onChange={(e) => setLoungeId(e.target.value)}
                      >
                        <option value="">
                          {t(
                            "Pilih lounge dari master data",
                            "Select a lounge from master data",
                          )}
                        </option>
                        {lounges
                          .filter(
                            (l) =>
                              l.airport === station && l.status === "Aktif",
                          )
                          .map((l) => (
                            <option value={l.id} key={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {t("Orientasi layar", "Display orientation")}
                      <select
                        value={orientation}
                        onChange={(e) =>
                          setOrientation(
                            e.target.value as "portrait" | "landscape",
                          )
                        }
                      >
                        <option value="landscape">Landscape · 16:9</option>
                        <option value="portrait">Portrait · 9:16</option>
                      </select>
                    </label>
                    {boot.canManage && (
                      <>
                        <label>
                          {t(
                            "Video iklan saat standby",
                            "Standby advertising video",
                          )}
                          <select
                            value={videoId}
                            disabled={!settingsReady}
                            onChange={(e) => setVideoId(e.target.value)}
                          >
                            <option value="">
                              {t("Layar sambutan", "Welcome screen")}
                            </option>
                            {boot.videos
                              .filter((v) =>
                                ["ALL", station].includes(v.station),
                              )
                              .map((v) => (
                                <option value={v.id} key={v.id}>
                                  {v.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          {t("Denah lounge", "Lounge map")}
                          <select
                            value={layoutId}
                            disabled={!settingsReady}
                            onChange={(e) => setLayoutId(e.target.value)}
                          >
                            <option value="">
                              {t("Tanpa QR denah", "Without map QR")}
                            </option>
                            {boot.layouts
                              .filter(
                                (l) =>
                                  l.loungeId === loungeId &&
                                  l.station === station,
                              )
                              .map((l) => (
                                <option value={l.id} key={l.id}>
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
                      "Station dan lounge mengikuti master data existing. Video berasal dari Pustaka Konten dan QR menggunakan denah lounge yang dipublikasikan.",
                      "Stations and lounges use existing master data. Videos use the Content Library; QR codes use published lounge maps.",
                    )}
                  </p>
                  <div className="sa-actions">
                    {boot.canManage && (
                      <button
                        type="button"
                        disabled={!settingsReady || busy}
                        onClick={() => void save()}
                      >
                        {t("Simpan pengaturan", "Save settings")}
                      </button>
                    )}
                    <button
                      className="sa-primary"
                      type="button"
                      disabled={!settingsReady || !lounge}
                      onClick={() => setKiosk(true)}
                    >
                      {t("Buka layar lounge", "Open lounge display")}
                    </button>
                  </div>
                  <p className="sa-help">
                    {t(
                      "Layar bersifat display saja. Kamera aktif saat dibuka; video ditampilkan saat idle. Tekan Esc pada perangkat operator untuk keluar.",
                      "The lounge screen is display only. The camera activates on opening; video plays while idle. Press Esc on the operator device to exit.",
                    )}
                  </p>
                </section>
                <section className="sa-panel">
                  <h3>{t("Kesiapan layanan", "Service readiness")}</h3>
                  {[
                    [
                      t("Mesin wajah lokal 1:1", "Local 1:1 face engine"),
                      boot.integration.identity,
                    ],
                    [
                      t("Pemeriksaan liveness", "Liveness check"),
                      boot.integration.liveness,
                    ],
                    [
                      t("Hak akses penumpang", "Passenger entitlement"),
                      boot.integration.entitlement,
                    ],
                    ["Autogate", boot.integration.gate],
                  ].map(([label, ready]) => (
                    <div className="sa-integration-row" key={String(label)}>
                      <span>{label}</span>
                      <span className="sa-tag">
                        {ready
                          ? t("Terhubung", "Connected")
                          : t("Belum terhubung", "Not connected")}
                      </span>
                    </div>
                  ))}
                  <button type="button" onClick={() => void refresh()}>
                    {t("Periksa koneksi", "Check connections")}
                  </button>
                </section>
                <details className="sa-panel">
                  <summary>
                    {t(
                      "Kontrol operator · siapkan sesi identitas 1:1",
                      "Operator controls · prepare a 1:1 identity session",
                    )}
                  </summary>
                  <p className="sa-help">
                    {t(
                      "Identitas disiapkan di sisi check-in/operator, bukan pada layar lounge. Sesi berlaku dua menit dan hanya untuk satu identitas.",
                      "Identity is prepared at check-in/operator controls, not on the lounge display. The session lasts two minutes and is bound to one identity.",
                    )}
                  </p>
                  <div className="sa-fields">
                    <label>
                      {t("Jenis sesi", "Session type")}
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="Staff">{t("Petugas", "Staff")}</option>
                        <option value="Passenger">
                          {t("Penumpang", "Passenger")}
                        </option>
                      </select>
                    </label>
                    <label>
                      {category === "Staff"
                        ? t("Nomor pegawai", "Employee number")
                        : t("Referensi check-in", "Check-in reference")}
                      <input
                        value={credential}
                        autoComplete="off"
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
                        "Pemilik identitas menyetujui verifikasi wajah untuk sesi ini.",
                        "The identity holder consents to face verification for this session.",
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={
                      !consent ||
                      !credential ||
                      !loungeId ||
                      busy ||
                      !boot.integration.identity
                    }
                    onClick={() => void prepare()}
                  >
                    {t(
                      "Siapkan sesi untuk layar",
                      "Prepare session for display",
                    )}
                  </button>
                </details>
              </div>
              <section className={`sa-lounge-preview ${orientation}`}>
                <div className="sa-preview-top">
                  <span>{t("PREVIEW LAYAR", "DISPLAY PREVIEW")}</span>
                  <span>{orientation === "portrait" ? "9:16" : "16:9"}</span>
                </div>
                <div className="sa-preview-body">
                  <img
                    src="/garuda-wing.svg"
                    width="54"
                    height="54"
                    alt="Garuda Indonesia"
                  />
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
                      "Video standby → kamera → hasil verifikasi",
                      "Standby video → camera → verification result",
                    )}
                  </p>
                  {qr && (
                    <img
                      className="sa-preview-qr"
                      src={qr}
                      alt={t("QR denah lounge", "Lounge map QR")}
                    />
                  )}
                </div>
              </section>
            </div>
          )}
          {tab === "staff" && boot.canManage && (
            <SeamlessStaff
              api={api}
              language={language}
              stations={boot.stations}
              lounges={lounges}
              identityConnected={boot.integration.identity}
            />
          )}
          {tab === "activity" && (
            <section className="sa-panel">
              <h2>{t("Aktivitas akses", "Access activity")}</h2>
              <p>
                {t(
                  "Pilih station dan lounge untuk melihat riwayat akses.",
                  "Select a station and lounge to view access history.",
                )}
              </p>
              <div className="sa-fields">
                <label>
                  {t("Station aktivitas", "Activity station")}
                  <select
                    value={activityStation}
                    onChange={(e) => {
                      setActivityStation(e.target.value);
                      setActivityLounge("");
                    }}
                  >
                    <option value="">
                      {t("Pilih station", "Select station")}
                    </option>
                    {boot.stations.map((s) => (
                      <option value={s.code} key={s.code}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Lounge aktivitas", "Activity lounge")}
                  <select
                    value={activityLounge}
                    onChange={(e) => setActivityLounge(e.target.value)}
                  >
                    <option value="">
                      {t("Pilih lounge", "Select lounge")}
                    </option>
                    {lounges
                      .filter(
                        (l) =>
                          l.airport === activityStation && l.status === "Aktif",
                      )
                      .map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {!activityLounge ? (
                <div className="sa-empty">
                  {t("Belum ada lokasi yang dipilih.", "No location selected.")}
                </div>
              ) : (
                <>
                  <div className="sa-actions">
                    <input
                      aria-label={t("Cari aktivitas", "Search activity")}
                      value={query}
                      placeholder={t(
                        "Cari kategori atau waktu",
                        "Search category or time",
                      )}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={activityLoading}
                      onClick={() => void loadActivity()}
                    >
                      {t("Muat ulang", "Refresh")}
                    </button>
                  </div>
                  <div className="sa-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            t("Waktu", "Time"),
                            t("Kategori", "Category"),
                            t("Verifikasi", "Verification"),
                            t("Gerbang", "Gate"),
                          ].map((v) => (
                            <th key={v}>{v}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {new Date(a.createdAt).toLocaleString(
                                language === "ID" ? "id-ID" : "en-GB",
                              )}
                            </td>
                            <td>
                              {a.category === "Staff"
                                ? t("Petugas", "Staff")
                                : t("Penumpang", "Passenger")}
                            </td>
                            <td>
                              {a.faceMatched ? (
                                t(
                                  "Wajah sesuai referensi",
                                  "Face matches reference",
                                )
                              ) : (
                                <StatusTag
                                  value={a.decision}
                                  language={language}
                                />
                              )}
                            </td>
                            <td>
                              {a.gate === "OpenConfirmed"
                                ? t(
                                    "Terbuka terkonfirmasi",
                                    "Opening confirmed",
                                  )
                                : t("Belum terkonfirmasi", "Not confirmed")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="sa-empty">
                        {activityLoading
                          ? t("Memuat aktivitas…", "Loading activity…")
                          : t(
                              "Belum ada aktivitas sesuai pilihan.",
                              "No activity matches your selection.",
                            )}
                      </div>
                    )}
                  </div>
                  {activityCursor && (
                    <button
                      type="button"
                      onClick={() => void loadActivity(activityCursor)}
                    >
                      {t("Muat berikutnya", "Load more")}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {kiosk && lounge && (
        <SeamlessDisplay
          api={api}
          language={language}
          loungeId={loungeId}
          loungeName={lounge.name}
          station={station}
          videoUrl={video?.sourceUrl}
          qr={qr}
          orientation={orientation}
          identityReady={boot.integration.identity}
          onClose={closeDisplay}
        />
      )}
    </section>
  );
}

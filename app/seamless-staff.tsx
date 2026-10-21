"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  errorMessage,
  photoData,
  StatusTag,
  useCapture,
  type Language,
  type Photo,
} from "./seamless-shared";
export type StaffRow = {
  uid: string;
  name: string;
  unit: string;
  employeeNumber: string;
  station: string;
  role: string;
  active: boolean;
  loungeId: string;
  hasPhoto: boolean;
  registration: {
    name?: string;
    unit?: string;
    employeeNumber?: string;
    loungeIds?: string[];
    status?: string;
    photos?: Photo[];
  };
};
type Lounge = { id: string; name: string; airport: string; status: string };
type Api = (p: Record<string, unknown>) => Promise<Record<string, unknown>>;
export default function SeamlessStaff({
  api,
  language,
  stations,
  lounges,
  identityConnected,
}: {
  api: Api;
  language: Language;
  stations: { code: string; name: string; status?: string }[];
  lounges: Lounge[];
  identityConnected: boolean;
}) {
  const t = (id: string, en: string) => (language === "ID" ? id : en);
  const [rows, setRows] = useState<StaffRow[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [station, setStation] = useState(""),
    [uid, setUid] = useState("");
  const [name, setName] = useState(""),
    [unit, setUnit] = useState(""),
    [employeeNumber, setEmployeeNumber] = useState(""),
    [loungeId, setLoungeId] = useState(""),
    [consent, setConsent] = useState(false),
    [identity, setIdentity] = useState(false),
    [source, setSource] = useState("upload"),
    [folder, setFolder] = useState(""),
    [filename, setFilename] = useState(""),
    [photos, setPhotos] = useState<Photo[]>([]),
    [invite, setInvite] = useState(""),
    [preview, setPreview] = useState("");
  const {
    video: videoRef,
    ready: cameraReady,
    cameraError,
    start: startCamera,
    stop: stopCamera,
    capture: capturePhoto,
  } = useCapture();
  useEffect(() => {
    setNotice("");
  }, [language]);
  const selected = rows.find((r) => r.uid === uid);
  const load = useCallback(
    async (next?: string) => {
      setLoading(true);
      try {
        const d = await api({ action: "staff-list", cursor: next });
        setRows((old) =>
          next ? [...old, ...(d.staff as StaffRow[])] : (d.staff as StaffRow[]),
        );
        setCursor(d.nextCursor as string | null);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load().catch((e) => setNotice(errorMessage(e, language)));
  }, [load, language]);
  const reset = (s?: StaffRow) => {
    setUid(s?.uid || "");
    setName(s?.name || "");
    setUnit(s?.unit || "");
    setEmployeeNumber(s?.employeeNumber || "");
    setLoungeId(s?.registration.loungeIds?.[0] || s?.loungeId || "");
    setPhotos([]);
    setPreview("");
    setInvite("");
    setConsent(false);
    setIdentity(false);
    stopCamera();
  };
  const run = async (work: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(message);
      await load();
    } catch (e) {
      setNotice(errorMessage(e, language));
    } finally {
      setBusy(false);
    }
  };
  const register = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        api({
          action: "staff-register",
          uid,
          name,
          unit,
          employeeNumber,
          station,
          loungeIds: [loungeId],
          identityConfirmed: identity,
          consent,
        }),
      t(
        "Registrasi tersimpan. Lanjutkan dengan foto enrollment.",
        "Registration saved. Continue with enrollment photos.",
      ),
    );
  };
  const upload = async (data: string, pose = "front") => {
    const d = await api({ action: "photo-upload", uid, data, pose, consent });
    setPhotos([d.photo as Photo]);
    setPreview(data);
  };
  const registered = !!selected?.registration.employeeNumber;
  return (
    <div className="sa-staff">
      <div className="sa-section-heading">
        <div>
          <p className="sa-eyebrow">
            {t("ADMINISTRASI KANTOR PUSAT", "HEAD OFFICE ADMINISTRATION")}
          </p>
          <h2>
            {t(
              "Registrasi & enrollment petugas",
              "Staff registration & enrollment",
            )}
          </h2>
          <p>
            {t(
              "Kelola profil, penugasan, dan referensi verifikasi dalam satu alur.",
              "Manage staff details, assignments and verification references in one workflow.",
            )}
          </p>
        </div>
        <span className="sa-tag">
          {t("Akses terbatas", "Restricted access")}
        </span>
      </div>
      <div className="sa-registration-layout">
        <section className="sa-panel">
          <div className="sa-step-title">
            <span>01</span>
            <h3>{t("Identitas & penugasan", "Identity & assignment")}</h3>
          </div>
          <form onSubmit={register}>
            <fieldset disabled={busy}>
              <div className="sa-fields">
                <label>
                  {t("Station", "Station")}
                  <select
                    aria-label="Station"
                    value={station}
                    onChange={(e) => {
                      setStation(e.target.value);
                      reset();
                    }}
                    required
                  >
                    <option value="">
                      {t("Pilih station", "Select station")}
                    </option>
                    {stations
                      .filter((s) => !s.status || s.status === "Aktif")
                      .map((s) => (
                        <option value={s.code} key={s.code}>
                          {s.code}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("Akun petugas", "Staff account")}
                  <select
                    value={uid}
                    required
                    onChange={(e) =>
                      reset(rows.find((r) => r.uid === e.target.value))
                    }
                  >
                    <option value="">
                      {loading
                        ? t("Memuat akun…", "Loading accounts…")
                        : t("Pilih petugas", "Select staff")}
                    </option>
                    {rows
                      .filter((s) => s.active && s.station === station)
                      .map((s) => (
                        <option key={s.uid} value={s.uid}>
                          {s.name}
                          {s.employeeNumber ? ` · ${s.employeeNumber}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("Nama lengkap", "Full name")}
                  <input
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t("Nomor pegawai", "Employee number")}
                  <input
                    value={employeeNumber}
                    maxLength={40}
                    pattern="[A-Za-z0-9._-]{2,40}"
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t("Unit kerja", "Unit")}
                  <input
                    value={unit}
                    maxLength={120}
                    onChange={(e) => setUnit(e.target.value)}
                    required
                  />
                </label>
                <label>
                  {t("Lounge yang ditugaskan", "Assigned lounge")}
                  <select
                    required
                    value={loungeId}
                    onChange={(e) => setLoungeId(e.target.value)}
                  >
                    <option value="">
                      {t("Pilih lounge", "Select lounge")}
                    </option>
                    {lounges
                      .filter(
                        (l) =>
                          l.airport === station &&
                          l.status === "Aktif" &&
                          (!selected?.loungeId ||
                            selected.loungeId === l.id ||
                            selected.role === "BO Admin"),
                      )
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <p className="sa-help">
                {t(
                  "Akun belum tersedia? Tambahkan melalui Master Data → User & Role. Station mengikuti penugasan akun.",
                  "Account missing? Add it through Master Data → User & Role. Station follows the account assignment.",
                )}
              </p>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={identity}
                  onChange={(e) => setIdentity(e.target.checked)}
                />
                <span>
                  {t(
                    "Saya telah memeriksa identitas dan penugasan petugas.",
                    "I have checked the staff identity and assignment.",
                  )}
                </span>
              </label>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t(
                    "Petugas telah menerima pemberitahuan dan menyetujui pemrosesan foto untuk verifikasi akses 1:1.",
                    "The staff member has received the notice and consents to photo processing for 1:1 access verification.",
                  )}
                </span>
              </label>
              <button
                className="sa-primary"
                disabled={!uid || !consent || !identity}
              >
                {t("Simpan registrasi", "Save registration")}
              </button>
            </fieldset>
          </form>
          {cursor && (
            <button
              type="button"
              disabled={loading || busy}
              onClick={() =>
                void load(cursor).catch((e) =>
                  setNotice(errorMessage(e, language)),
                )
              }
            >
              {t("Muat akun berikutnya", "Load more accounts")}
            </button>
          )}
        </section>
        <section className="sa-panel">
          <div className="sa-step-title">
            <span>02</span>
            <h3>{t("Foto & enrollment", "Photos & enrollment")}</h3>
          </div>
          {!registered ? (
            <div className="sa-empty">
              <div className="sa-empty-symbol">◎</div>
              <h3>{t("Mulai dari registrasi", "Start with registration")}</h3>
              <p>
                {t(
                  "Pilih petugas dan simpan identitas sebelum menambahkan foto.",
                  "Select a staff member and save their details before adding a photo.",
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="sa-profile">
                <div className="sa-avatar">{selected.name.slice(0, 1)}</div>
                <div>
                  <strong>{selected.name}</strong>
                  <p>
                    {selected.unit} · {selected.station}
                  </p>
                </div>
                <StatusTag
                  value={selected.registration.status || "Pending"}
                  language={language}
                />
              </div>
              <div
                className="sa-segmented"
                aria-label={t("Sumber foto", "Photo source")}
              >
                {[
                  ["upload", t("Unggah foto", "Upload photo")],
                  ["camera", t("Ambil foto", "Take photo")],
                  ["repository", t("Repository", "Repository")],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={source === key}
                    onClick={() => {
                      setSource(key);
                      stopCamera();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="sa-photo-area">
                {source === "upload" && (
                  <label className="sa-dropzone">
                    <span className="sa-empty-symbol">↑</span>
                    <strong>
                      {t("Pilih foto petugas", "Choose a staff photo")}
                    </strong>
                    <span>
                      JPEG, PNG, WebP · {t("maks. 1 MB", "max. 1 MB")}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy || !consent}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(
                            async () => upload(await photoData(file)),
                            t(
                              "Foto siap dikirim untuk peninjauan.",
                              "Photo ready to submit for review.",
                            ),
                          );
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                {source === "camera" && (
                  <div>
                    <div className="sa-camera">
                      <video ref={videoRef} muted playsInline />
                      <div className="sa-face-guide" />
                      {!cameraReady && (
                        <span>
                          {t("Kamera belum aktif", "Camera is inactive")}
                        </span>
                      )}
                    </div>
                    <div className="sa-actions">
                      <button
                        type="button"
                        disabled={busy || !consent}
                        onClick={() => void startCamera()}
                      >
                        {t("Aktifkan kamera", "Enable camera")}
                      </button>
                      <button
                        type="button"
                        disabled={!cameraReady || busy || !consent}
                        onClick={() =>
                          void run(
                            async () => {
                              await upload(capturePhoto());
                              stopCamera();
                            },
                            t(
                              "Foto siap dikirim untuk peninjauan.",
                              "Photo ready to submit for review.",
                            ),
                          )
                        }
                      >
                        {t("Ambil foto", "Capture photo")}
                      </button>
                      <button type="button" onClick={stopCamera}>
                        {t("Hentikan kamera", "Stop camera")}
                      </button>
                    </div>
                    {cameraError && (
                      <p role="alert">
                        {t(
                          "Kamera tidak tersedia. Periksa izin browser atau unggah foto.",
                          "Camera unavailable. Check browser permissions or upload a photo.",
                        )}
                      </p>
                    )}
                  </div>
                )}
                {source === "repository" && (
                  <div className="sa-fields">
                    <label>
                      {t(
                        "Folder dalam private/staff-enrollment",
                        "Folder under private/staff-enrollment",
                      )}
                      <input
                        value={folder}
                        maxLength={200}
                        placeholder="CGK"
                        onChange={(e) => setFolder(e.target.value)}
                      />
                    </label>
                    <label>
                      {t("Nama file", "Filename")}
                      <input
                        value={filename}
                        maxLength={120}
                        placeholder="staff-001.jpg"
                        onChange={(e) => setFilename(e.target.value)}
                      />
                    </label>
                    <p className="sa-help sa-wide">
                      {t(
                        "Gunakan repository privat. Foto diimpor oleh server ke penyimpanan terbatas; jangan simpan foto identitas dalam folder public.",
                        "Use a private repository. The server imports the photo into restricted storage; do not place identity photos in public folders.",
                      )}
                    </p>
                    <button
                      type="button"
                      disabled={busy || !consent || !filename}
                      onClick={() =>
                        void run(
                          async () => {
                            const d = await api({
                              action: "photo-repository",
                              uid,
                              folder,
                              file: filename,
                              pose: "front",
                              consent,
                            });
                            setPhotos([d.photo as Photo]);
                            setPreview("");
                          },
                          t("Foto berhasil diimpor.", "Photo imported."),
                        )
                      }
                    >
                      {t("Impor foto", "Import photo")}
                    </button>
                  </div>
                )}
              </div>
              {preview && (
                <img
                  className="sa-photo-preview"
                  src={preview}
                  alt={t("Foto enrollment petugas", "Staff enrollment photo")}
                />
              )}
              <div className="sa-actions">
                <span className="sa-help">
                  {photos.length
                    ? t("Foto baru siap dikirim.", "New photo ready to submit.")
                    : selected.hasPhoto
                      ? t(
                          "Foto tersimpan untuk peninjauan.",
                          "Photo stored for review.",
                        )
                      : t("Belum ada foto.", "No photo yet.")}
                </span>
                {selected.hasPhoto && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          const d = await api({ action: "staff-photo", uid });
                          setPreview(d.url as string);
                        },
                        t(
                          "Foto ditampilkan selama sesi peninjauan.",
                          "Photo displayed for this review session.",
                        ),
                      )
                    }
                  >
                    {t("Lihat foto tersimpan", "Review stored photo")}
                  </button>
                )}
              </div>
              <button
                className="sa-primary"
                type="button"
                disabled={busy || !photos.length || !consent}
                onClick={() =>
                  void run(
                    async () => {
                      await api({
                        action: "staff-enrollment-save",
                        uid,
                        photos,
                        consent,
                      });
                      setPhotos([]);
                    },
                    t(
                      "Foto dikirim. Enrollment menunggu peninjauan admin.",
                      "Photos submitted. Enrollment awaits administrator review.",
                    ),
                  )
                }
              >
                {t("Kirim foto untuk peninjauan", "Submit photos for review")}
              </button>
              <div className="sa-invite">
                <h4>{t("Enrollment mandiri", "Self enrollment")}</h4>
                <p>
                  {t(
                    "Buat tautan sekali pakai, berlaku 24 jam. Petugas mengikuti panduan foto depan, kanan, dan kiri.",
                    "Create a single-use link valid for 24 hours. Staff follow front, right and left photo guidance.",
                  )}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => {
                        const d = await api({
                          action: "enrollment-invite",
                          uid,
                        });
                        setInvite(
                          `${window.location.origin}/staff-enrollment#${d.token}`,
                        );
                      },
                      t(
                        "Tautan siap dibagikan secara pribadi. Tautan sebelumnya tidak berlaku.",
                        "The link is ready to share privately. Previous links are invalid.",
                      ),
                    )
                  }
                >
                  {t("Buat tautan enrollment", "Create enrollment link")}
                </button>
                {invite && (
                  <div className="sa-link-copy">
                    <input
                      aria-label={t("Tautan enrollment", "Enrollment link")}
                      readOnly
                      value={invite}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(invite)
                          .then(() =>
                            setNotice(t("Tautan disalin.", "Link copied.")),
                          )
                          .catch(() =>
                            setNotice(
                              t(
                                "Salin tautan dari kolom di atas.",
                                "Copy the link from the field above.",
                              ),
                            ),
                          );
                      }}
                    >
                      {t("Salin", "Copy")}
                    </button>
                  </div>
                )}
              </div>
              <div className="sa-approval">
                <h4>{t("Persetujuan akses", "Access approval")}</h4>
                <p>
                  {identityConnected
                    ? t(
                        "Aktifkan setelah identitas dan hasil enrollment diperiksa.",
                        "Activate after reviewing the identity and enrollment result.",
                      )
                    : t(
                        "Registrasi dan foto dapat disimpan. Aktivasi menunggu layanan verifikasi wajah terhubung; foto saja tidak mengaktifkan akses.",
                        "Registration and photos can be saved. Activation requires a connected face verification service; a photo alone does not activate access.",
                      )}
                </p>
                <div className="sa-actions">
                  <button
                    className="sa-primary"
                    type="button"
                    disabled={
                      busy ||
                      !identity ||
                      !identityConnected ||
                      selected.registration.status !== "PendingReview"
                    }
                    onClick={() =>
                      void run(
                        () =>
                          api({
                            action: "staff-approve",
                            uid,
                            identityConfirmed: identity,
                          }),
                        t(
                          "Enrollment disetujui dan akses diaktifkan.",
                          "Enrollment approved and access activated.",
                        ),
                      )
                    }
                  >
                    {t("Setujui & aktifkan", "Approve & activate")}
                  </button>
                  <button
                    className="sa-danger"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api({ action: "staff-deactivate", uid }),
                        t(
                          "Akses dinonaktifkan dan tautan enrollment dicabut.",
                          "Access deactivated and enrollment links revoked.",
                        ),
                      )
                    }
                  >
                    {t("Nonaktifkan akses", "Deactivate access")}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
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
    </div>
  );
}

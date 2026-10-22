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
  accountUid?: string;
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
  const [accounts, setAccounts] = useState<
      { uid: string; name: string; station: string; role: string }[]
    >([]),
    [accountUid, setAccountUid] = useState(""),
    [accountSearch, setAccountSearch] = useState("");
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
    [preview, setPreview] = useState(""),
    [photoStatus, setPhotoStatus] = useState(""),
    [photoError, setPhotoError] = useState("");
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
  const load = useCallback(async () => {
    setLoading(true);
    try {
      let accountsDone = false,
        staffDone = false;
      let accountCursor: string | null = null,
        staffCursor: string | null = null;
      const staffMap = new Map<string, StaffRow>(),
        accountMap = new Map<
          string,
          { uid: string; name: string; station: string; role: string }
        >();
      do {
        const d = await api({
          action: "registry-list",
          skipAccounts: accountsDone,
          skipStaff: staffDone,
          accountCursor,
          staffCursor,
        });
        for (const row of d.staff as StaffRow[]) staffMap.set(row.uid, row);
        for (const row of d.accounts as {
          uid: string;
          name: string;
          station: string;
          role: string;
        }[])
          accountMap.set(row.uid, row);
        accountCursor = d.accountCursor as string | null;
        staffCursor = d.staffCursor as string | null;
        accountsDone = !accountCursor;
        staffDone = !staffCursor;
      } while (!accountsDone || !staffDone);
      setRows([...staffMap.values()]);
      setAccounts([...accountMap.values()]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load().catch((e) => setNotice(errorMessage(e, language)));
  }, [load, language]);
  const reset = (s?: StaffRow) => {
    setUid(s?.uid || "");
    setAccountUid(s?.accountUid || "");
    setName(s?.name || "");
    setUnit(s?.unit || "");
    setEmployeeNumber(s?.employeeNumber || "");
    setLoungeId(s?.registration.loungeIds?.[0] || s?.loungeId || "");
    setPhotos([]);
    setPreview("");
    setPhotoStatus("");
    setPhotoError("");
    setInvite("");
    setConsent(false);
    setIdentity(false);
    stopCamera();
  };
  const run = async (
    work: () => Promise<unknown>,
    message: string,
    photoTask = false,
  ) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    if (photoTask) {
      setPhotos([]);
      setPreview("");
      setPhotoError("");
      setPhotoStatus("uploading");
    }
    try {
      await work();
      if (photoTask) setPhotoStatus("stored");
      setNotice(message);
      await load().catch(() => setNotice(t(
        "Perubahan tersimpan, tetapi daftar belum dapat diperbarui. Muat ulang halaman untuk melihat data terbaru.",
        "Changes were saved, but the list could not be refreshed. Reload the page to see the latest details.",
      )));
    } catch (e) {
      if (photoTask) {
        setPhotoStatus("failed");
        setPhotoError(errorMessage(e, language));
      }
      setNotice(errorMessage(e, language));
    } finally {
      setBusy(false);
    }
  };
  const register = (e: FormEvent) => {
    e.preventDefault();
    void run(
      async () => {
        const result = await api({
          action: "registry-save",
          uid: uid || undefined,
          accountUid,
          name,
          unit,
          employeeNumber,
          station,
          loungeIds: [loungeId],
          identityConfirmed: identity,
          consent,
        });
        setUid(result.uid as string);
      },
      t(
        "Registrasi tersimpan. Lanjutkan dengan menambahkan foto wajah.",
        "Registration saved. Continue by adding a face photo.",
      ),
    );
  };
  const upload = async (data: string, pose = "front") => {
    setPreview(data);
    const d = await api({
      action: "registry-photo-upload",
      uid,
      data,
      pose,
      consent,
    });
    setPhotos([d.photo as Photo]);
    setPreview(data);
  };
  const registered = !!selected?.registration.employeeNumber;
  return (
    <div className="sa-staff">
      <div className="sa-section-heading">
        <div>
          <p className="sa-eyebrow">
            {t("IDENTITAS & AKSES PETUGAS", "STAFF IDENTITY & ACCESS")}
          </p>
          <h2>
            {t(
              "Registrasi dan pendaftaran wajah petugas",
              "Staff registration and face enrollment",
            )}
          </h2>
          <p>
            {t(
              "Lengkapi identitas, tambahkan foto, lalu ajukan pendaftaran wajah petugas.",
              "Complete staff details, add a photo, then submit the face enrollment.",
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
          <label>
            {t("Petugas terdaftar", "Registered staff")}
            <select
              value={uid}
              onChange={(e) => {
                const staff = rows.find((s) => s.uid === e.target.value);
                reset(staff);
                if (staff) setStation(staff.station);
              }}
            >
              <option value="">
                {t("Registrasi petugas baru", "Register new staff")}
              </option>
              {rows.map((s) => (
                <option key={s.uid} value={s.uid}>
                  {s.name} · {s.employeeNumber} · {s.station}
                </option>
              ))}
            </select>
          </label>
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
                  {t(
                    "Cari akun portal (opsional)",
                    "Search portal accounts (optional)",
                  )}
                  <input
                    value={accountSearch}
                    placeholder={t("Nama atau peran", "Name or role")}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                </label>
                <label>
                  {t("Akun petugas (opsional)", "Staff account (optional)")}
                  <select
                    aria-label={t(
                      "Akun petugas (opsional)",
                      "Staff account (optional)",
                    )}
                    value={accountUid}
                    disabled={!!uid && !uid.startsWith("stf-")}
                    onChange={(e) => {
                      setAccountUid(e.target.value);
                      const account = accounts.find(
                        (a) => a.uid === e.target.value,
                      );
                      if (account && !name) setName(account.name);
                    }}
                  >
                    <option value="">
                      {t("Tanpa akun portal", "No portal account")}
                    </option>
                    {accounts
                      .filter(
                        (a) =>
                          (!station || [station, "ALL"].includes(a.station)) &&
                          `${a.name} ${a.role}`
                            .toLowerCase()
                            .includes(accountSearch.toLowerCase()),
                      )
                      .map((a) => (
                        <option key={a.uid} value={a.uid}>
                          {a.name} · {a.role}
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
                  {t("Lokasi penugasan", "Assigned lounge")}
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
                          l.airport === station && l.status === "Aktif" && true,
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
                  "Akun portal hanya menghubungkan profil petugas dengan akun yang sudah ada. Memilih akun tidak memverifikasi wajah. Petugas tanpa akun portal tetap dapat didaftarkan.",
                  "A portal account only links this staff profile to an existing account. Selecting an account does not verify a face. Staff without a portal account can still be registered.",
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
                disabled={
                  !station ||
                  !name ||
                  !unit ||
                  !employeeNumber ||
                  !loungeId ||
                  !consent ||
                  !identity
                }
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
                void load().catch((e) => setNotice(errorMessage(e, language)))
              }
            >
              {t("Muat akun berikutnya", "Load more accounts")}
            </button>
          )}
        </section>
        <section className="sa-panel">
          <div className="sa-step-title">
            <span>02</span>
            <h3>{t("Pendaftaran wajah", "Face enrollment")}</h3>
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
                {selected.registration.status === "Active" ||
                selected.registration.status === "PendingReview" ? (
                  <StatusTag
                    value={selected.registration.status}
                    language={language}
                  />
                ) : (
                  <span className="sa-tag">
                    {selected.hasPhoto
                      ? t("Foto belum diajukan", "Photo not submitted")
                      : t(
                          "Foto wajah belum ditambahkan",
                          "Face photo required",
                        )}
                  </span>
                )}
              </div>
              <p className="sa-help">
                {t(
                  "Gunakan foto dengan satu wajah yang terlihat jelas, menghadap kamera, dan pencahayaan cukup. Setelah foto tersimpan, ajukan verifikasi lalu minta administrator menyetujui pendaftaran wajah.",
                  "Use a well-lit photo showing one clear face looking at the camera. After saving the photo, submit it for verification and ask an administrator to approve the face enrollment.",
                )}
              </p>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t(
                    "Petugas menyetujui penggunaan foto untuk verifikasi wajah.",
                    "The staff member consents to using the photo for face verification.",
                  )}
                </span>
              </label>
              {!consent && (
                <p className="sa-help">
                  {t(
                    "Centang persetujuan di atas untuk mengunggah foto atau menggunakan kamera.",
                    "Select the consent checkbox above to upload a photo or use the camera.",
                  )}
                </p>
              )}
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
                              "Foto tersimpan. Ajukan verifikasi untuk melanjutkan.",
                              "Photo saved. Submit it for verification to continue.",
                            ),
                            true,
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
                              "Foto tersimpan. Ajukan verifikasi untuk melanjutkan.",
                              "Photo saved. Submit it for verification to continue.",
                            ),
                            true,
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
                        "Gunakan file dari repository privat yang sudah berhasil di-deploy. Isi subfolder saja (misalnya CGK) dan nama file persis, termasuk spasi dan huruf besar/kecil. Foto akan disalin ke penyimpanan terbatas.",
                        "Use a file from a private repository that has been successfully deployed. Enter only the subfolder (for example CGK) and the exact filename, including spaces and letter case. The photo will be copied to restricted storage.",
                      )}
                    </p>
                    <button
                      type="button"
                      disabled={busy || !consent || !filename}
                      onClick={() =>
                        void run(
                          async () => {
                            const d = await api({
                              action: "registry-photo-repository",
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
                          true,
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
                  alt={t("Foto wajah petugas", "Staff face photo")}
                />
              )}
              {photoStatus === "uploading" && (
                <p role="status">
                  {t(
                    "Mengunggah dan menyimpan foto…",
                    "Uploading and saving photo…",
                  )}
                </p>
              )}
              {photoError && (
                <p role="alert">
                  {photoError}{" "}
                  {t(
                    "Foto baru belum tersimpan. Pilih foto lain atau coba kembali.",
                    "The new photo was not saved. Choose another photo or try again.",
                  )}
                </p>
              )}
              <div className="sa-actions">
                <span className="sa-help">
                  {photoStatus === "uploading"
                    ? t(
                        "Mohon tunggu hingga foto selesai disimpan.",
                        "Please wait until the photo is saved.",
                      )
                    : photos.length
                      ? t(
                          "Foto tersimpan dan siap diajukan.",
                          "Photo saved and ready to submit.",
                        )
                      : selected.registration.status === "Active"
                        ? t(
                            "Pendaftaran wajah aktif.",
                            "Face enrollment is active.",
                          )
                        : selected.hasPhoto
                          ? t(
                              "Foto tersimpan untuk peninjauan.",
                              "Photo stored for review.",
                            )
                          : t(
                              "Foto wajah belum ditambahkan.",
                              "No face photo has been added.",
                            )}
                </span>
                {selected.hasPhoto && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          const d = await api({
                            action: "registry-photo",
                            uid,
                          });
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
                        action: "registry-enrollment-save",
                        uid,
                        photos,
                        consent,
                      });
                      setPhotos([]);
                    },
                    t(
                      "Pengajuan terkirim. Administrator perlu memeriksa dan mengaktifkan pendaftaran wajah.",
                      "Submission received. An administrator must review and activate the face enrollment.",
                    ),
                  )
                }
              >
                {t(
                  "Simpan dan ajukan verifikasi",
                  "Save and submit for verification",
                )}
              </button>
              {!photos.length && (
                <p className="sa-help">
                  {t(
                    "Tambahkan foto baru sebelum mengajukan verifikasi. Jika foto sudah diajukan, lanjutkan ke persetujuan di bawah.",
                    "Add a new photo before submitting for verification. If a photo has already been submitted, continue to approval below.",
                  )}
                </p>
              )}
              <div className="sa-invite">
                <h4>
                  {t("Pendaftaran wajah mandiri", "Self face enrollment")}
                </h4>
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
                          action: "registry-invite",
                          uid,
                        });
                        setInvite(
                          `${window.location.origin}/staff-enrollment#registry:${d.token}`,
                        );
                      },
                      t(
                        "Tautan siap dibagikan secara pribadi. Tautan sebelumnya tidak berlaku.",
                        "The link is ready to share privately. Previous links are invalid.",
                      ),
                    )
                  }
                >
                  {t("Buat tautan pendaftaran", "Create enrollment link")}
                </button>
                {invite && (
                  <div className="sa-link-copy">
                    <input
                      aria-label={t("Tautan pendaftaran", "Enrollment link")}
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
                        "Periksa identitas dan foto, lalu pilih Setujui dan aktifkan. Foto akan diperiksa oleh mesin verifikasi wajah.",
                        "Review the identity and photo, then select Approve and activate. The face verification engine will check the photo.",
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
                            action: "registry-approve",
                            uid,
                            identityConfirmed: identity,
                          }),
                        t(
                          "Pendaftaran wajah aktif. Siapkan sesi verifikasi untuk mencoba pencocokan wajah.",
                          "Face enrollment is active. Prepare a verification session to try face comparison.",
                        ),
                      )
                    }
                  >
                    {t("Setujui dan aktifkan", "Approve and activate")}
                  </button>
                  <button
                    className="sa-danger"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api({ action: "registry-deactivate", uid }),
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

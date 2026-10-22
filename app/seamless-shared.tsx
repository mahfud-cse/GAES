"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export type Language = "ID" | "EN";
export type Photo = { path: string; pose: string };
const messages: Record<string, [string, string]> = {
  EXACTLY_ONE_FACE_REQUIRED: [
    "Foto harus menampilkan tepat satu wajah.",
    "The photo must show exactly one face.",
  ],
  FACE_TOO_SMALL: [
    "Wajah terlalu kecil. Dekatkan kamera dan ambil ulang foto.",
    "The face is too small. Move closer and retake the photo.",
  ],
  PHOTO_BLURRED: [
    "Foto kurang tajam. Perbaiki pencahayaan dan ambil ulang.",
    "The photo is blurred. Improve the lighting and retake it.",
  ],
  INCONSISTENT_ENROLLMENT: [
    "Foto enrollment belum konsisten. Ambil ulang foto orang yang sama.",
    "Enrollment photos are inconsistent. Retake photos of the same person.",
  ],
  ACCOUNT_ALREADY_LINKED: [
    "Akun sudah terhubung dengan registrasi petugas lain.",
    "This account is linked to another staff registration.",
  ],

  ENTITLEMENT_INVALID: [
    "Hak akses lounge tidak berlaku untuk kunjungan ini. Silakan hubungi petugas.",
    "Lounge access is not valid for this visit. Please ask a staff member.",
  ],
  PROVIDER_TIMEOUT: [
    "Layanan tidak merespons tepat waktu. Jangan melewati gerbang sebelum ada konfirmasi.",
    "The service did not respond in time. Do not pass through the gate without confirmation.",
  ],
  INVALID_MEDIA: [
    "Video harus aktif dan tersedia pada station lounge ini.",
    "The video must be active and available at this lounge's station.",
  ],
  INVALID_LAYOUT: [
    "Pilih denah yang sudah dipublikasikan untuk lounge ini.",
    "Select a published map for this lounge.",
  ],
  ENROLLMENT_REJECTED: [
    "Enrollment belum lolos pemeriksaan layanan verifikasi.",
    "Enrollment did not pass the verification service checks.",
  ],
  VERIFICATION_UNAVAILABLE: [
    "Verifikasi belum dapat diselesaikan. Silakan hubungi petugas.",
    "Verification could not be completed. Please ask a staff member.",
  ],
  INVALID_INPUT: [
    "Periksa kembali informasi yang dimasukkan.",
    "Please check the information you entered.",
  ],

  HO_ADMIN_REQUIRED: [
    "Hanya administrator kantor pusat yang dapat mengelola petugas.",
    "Only head office administrators can manage staff.",
  ],
  FORBIDDEN: [
    "Akun tidak memiliki izin untuk tindakan ini.",
    "Your account is not authorized for this action.",
  ],
  STAFF_UNAVAILABLE: [
    "Akun petugas aktif tidak tersedia. Periksa User & Role.",
    "An active staff account was not found. Check User & Role.",
  ],
  STAFF_FIELDS_REQUIRED: [
    "Lengkapi nama, unit, dan nomor pegawai.",
    "Complete the name, unit and employee number.",
  ],
  STAFF_SCOPE_INVALID: [
    "Station dan lounge harus sesuai penugasan akun pada master data.",
    "Station and lounge must match the account assignment in master data.",
  ],
  STATION_UNAVAILABLE: [
    "Station aktif tidak ditemukan pada master data.",
    "The station is not active in master data.",
  ],
  EMPLOYEE_NUMBER_USED: [
    "Nomor pegawai sudah terdaftar pada akun lain.",
    "The employee number is registered to another account.",
  ],
  REGISTER_FIRST: [
    "Simpan registrasi petugas terlebih dahulu.",
    "Save the staff registration first.",
  ],
  CONSENT_REQUIRED: [
    "Persetujuan dan konfirmasi yang diperlukan belum lengkap.",
    "The required consent and confirmations are incomplete.",
  ],
  PHOTO_REQUIRED: [
    "Tambahkan foto enrollment terlebih dahulu.",
    "Add an enrollment photo first.",
  ],
  INVALID_PHOTO: [
    "Foto tidak valid. Gunakan JPEG, PNG, atau WebP maksimal 1 MB.",
    "Invalid photo. Use JPEG, PNG or WebP, up to 1 MB.",
  ],
  PHOTO_TOO_LARGE: [
    "Ukuran foto terlalu besar. Maksimal 1 MB.",
    "The photo exceeds the 1 MB limit.",
  ],
  THREE_POSES_REQUIRED: [
    "Lengkapi foto depan, kanan, dan kiri.",
    "Complete the front, right and left photos.",
  ],
  IDENTITY_NOT_CONNECTED: [
    "Layanan verifikasi wajah belum terhubung. Gunakan verifikasi dokumen.",
    "Face verification is not connected. Please use document verification.",
  ],
  ENTITLEMENT_NOT_CONNECTED: [
    "Layanan hak akses penumpang belum terhubung.",
    "The passenger entitlement service is not connected.",
  ],
  GATE_NOT_CONNECTED: [
    "Autogate belum terhubung. Hubungi petugas untuk bantuan akses.",
    "The autogate is not connected. Please ask a staff member for assistance.",
  ],
  CLAIM_UNAVAILABLE: [
    "Identitas atau akses belum siap. Silakan gunakan jalur verifikasi dokumen.",
    "The identity or access is not ready. Please use document verification.",
  ],
  CREDENTIAL_REQUIRED: [
    "Masukkan referensi identitas untuk sesi ini.",
    "Enter your identity reference for this session.",
  ],
  FACE_VERIFICATION_FAILED: [
    "Verifikasi belum berhasil. Silakan hubungi petugas.",
    "Verification was unsuccessful. Please ask a staff member for assistance.",
  ],
  LINK_INVALID: [
    "Tautan tidak valid, kedaluwarsa, atau sudah digunakan. Minta tautan baru kepada admin.",
    "This link is invalid, expired or already used. Ask your administrator for a new link.",
  ],
  SESSION_INVALID: [
    "Sesi berakhir. Mulai verifikasi baru.",
    "The session has ended. Start a new verification.",
  ],
  SESSION_EXPIRED: [
    "Sesi login berakhir. Silakan masuk kembali.",
    "Your sign-in session has expired. Please sign in again.",
  ],
  REVIEW_REQUIRED: [
    "Foto harus dikirim untuk peninjauan dan identitas harus dikonfirmasi.",
    "Submit the photos for review and confirm the identity.",
  ],
  STAFF_CHANGED: [
    "Data berubah. Muat ulang sebelum melanjutkan.",
    "The record has changed. Refresh before continuing.",
  ],
  INVALID_REPOSITORY_PATH: [
    "Folder atau nama file tidak valid.",
    "The folder or filename is invalid.",
  ],
  REPOSITORY_PHOTO_NOT_FOUND: [
    "Foto tidak ditemukan pada versi website ini. Periksa folder dan nama file, termasuk huruf besar/kecil, lalu pastikan deployment dari branch yang memuat foto sudah berhasil.",
    "The photo was not found in this website version. Check the folder and exact filename, including letter case, and ensure deployment from the branch containing the photo has completed.",
  ],
  STORAGE_NOT_CONNECTED: [
    "Penyimpanan foto belum terhubung. Periksa konfigurasi Firebase Storage.",
    "Photo storage is not connected. Check the Firebase Storage configuration.",
  ],
  STORAGE_CONFIG_INVALID: [
    "Konfigurasi penyimpanan foto tidak valid. Administrator perlu memeriksa nama bucket Firebase Storage pada pengaturan server.",
    "Photo storage configuration is invalid. An administrator must check the Firebase Storage bucket name in the server settings.",
  ],
  STORAGE_PERMISSION_DENIED: [
    "Server tidak memiliki izin untuk mengakses penyimpanan foto. Administrator perlu memeriksa izin service account pada bucket yang digunakan.",
    "The server does not have permission to access photo storage. An administrator must check the service account permissions on the configured bucket.",
  ],
  STORAGE_BUCKET_NOT_FOUND: [
    "Bucket penyimpanan tidak ditemukan. Administrator perlu mencocokkan nama bucket pada server dengan Firebase Storage yang sudah digunakan.",
    "The storage bucket was not found. An administrator must match the server bucket setting to the existing Firebase Storage bucket.",
  ],
  STORAGE_PHOTO_NOT_FOUND: [
    "Foto tersimpan belum dapat ditemukan pada penyimpanan yang dikonfigurasi. Periksa pengaturan bucket atau tambahkan ulang foto.",
    "The saved photo could not be found in the configured storage. Check the bucket setting or add the photo again.",
  ],
  STORAGE_CREDENTIAL_INVALID: [
    "Kredensial server untuk penyimpanan foto tidak dapat digunakan. Administrator perlu memeriksa konfigurasi service account.",
    "The server credentials for photo storage could not be used. An administrator must check the service account configuration.",
  ],
  STORAGE_PROJECT_BLOCKED: [
    "Penyimpanan ditolak karena status akun atau penagihan proyek. Administrator perlu memeriksa status Firebase Storage pada proyek yang digunakan.",
    "Storage access was blocked by the project account or billing status. An administrator must check Firebase Storage on the existing project.",
  ],
  STORAGE_API_DISABLED: [
    "Layanan penyimpanan belum diaktifkan untuk proyek ini. Administrator perlu memeriksa layanan Cloud Storage pada proyek yang digunakan.",
    "Storage service is not enabled for this project. An administrator must check Cloud Storage on the existing project.",
  ],
  STORAGE_QUOTA_EXCEEDED: [
    "Batas permintaan atau kuota penyimpanan tercapai. Coba kembali beberapa saat lagi atau hubungi administrator.",
    "The storage request limit or quota was reached. Try again later or contact an administrator.",
  ],
  STORAGE_OPERATION_FAILED: [
    "Proses penyimpanan foto gagal di server. Coba kembali. Jika tetap gagal, sampaikan nomor referensi berikut kepada administrator untuk pemeriksaan log Netlify.",
    "The server could not complete the photo storage operation. Try again. If it fails again, give the reference below to an administrator to check the Netlify logs.",
  ],
  REPOSITORY_READ_FAILED: [
    "Server tidak dapat membaca foto repository. Administrator perlu memeriksa file yang disertakan dan izin baca pada deployment.",
    "The server could not read the repository photo. An administrator must check the bundled file and read permissions in the deployment.",
  ],
  SERVICE_UNAVAILABLE: [
    "Layanan belum tersedia. Coba kembali atau hubungi administrator.",
    "The service is unavailable. Please try again or contact your administrator.",
  ],
};
export function errorMessage(error: unknown, language: Language) {
  const code = error instanceof Error ? error.message : String(error);
  const message = (messages[code] || messages.SERVICE_UNAVAILABLE)[
    language === "ID" ? 0 : 1
  ];
  const requestId = (error as { requestId?: unknown } | null)?.requestId;
  return typeof requestId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)
    ? `${message} ${language === "ID" ? "Referensi" : "Reference"}: ${requestId}`
    : message;
}
export async function photoData(file: File): Promise<string> {
  if (file.size > 1000000) throw new Error("PHOTO_TOO_LARGE");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("INVALID_PHOTO");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("INVALID_PHOTO"));
    reader.readAsDataURL(file);
  });
}
export function useCapture() {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0);
  const [ready, setReady] = useState(false),
    [cameraError, setCameraError] = useState(false);
  const stop = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const start = async () => {
    stop();
    setCameraError(false);
    const epoch = generation.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (generation.current !== epoch) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setReady(true);
    } catch {
      setCameraError(true);
    }
  };
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth || !v.videoHeight || !ready)
      throw new Error("INVALID_PHOTO");
    const c = document.createElement("canvas");
    c.width = Math.min(v.videoWidth, 800);
    c.height = Math.round((v.videoHeight * c.width) / v.videoWidth);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  };
  return { video, ready, cameraError, start, stop, capture };
}
export function StatusTag({
  value,
  language,
}: {
  value: string;
  language: Language;
}) {
  const labels: Record<string, [string, string]> = {
    Pending: ["Belum lengkap", "Incomplete"],
    PendingReview: ["Menunggu peninjauan", "Awaiting review"],
    Active: ["Aktif", "Active"],
    Revoked: ["Nonaktif", "Inactive"],
    Eligible: ["Diizinkan", "Authorized"],
    Rejected: ["Perlu bantuan", "Assistance needed"],
    Processing: ["Sedang diproses", "Processing"],
  };
  return (
    <span
      className={`sa-tag ${value === "Active" || value === "Eligible" ? "positive" : value === "Revoked" || value === "Rejected" ? "negative" : ""}`}
    >
      {(labels[value] || [value, value])[language === "ID" ? 0 : 1]}
    </span>
  );
}

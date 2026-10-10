import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage, storageEnabled } from "./client";

export async function uploadEvidence(visitorId: string, file: File) {
  if (!storageEnabled || !storage) throw new Error("Firebase Storage belum diaktifkan. Fitur lampiran sementara belum tersedia pada paket saat ini.");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const target = ref(storage, `evidence/${visitorId}/${Date.now()}-${safeName}`);
  await uploadBytes(target, file, { contentType: file.type });
  return { name: file.name, url: await getDownloadURL(target) };
}

export async function uploadDisplayMedia(station: string, contentId: string, file: File) {
  if (!storageEnabled || !storage)
    throw new Error("Firebase Storage belum diaktifkan. Gunakan source URL atau aktifkan Storage untuk upload media.");
  const allowed = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];
  if (!allowed.includes(file.type)) throw new Error("Format media harus JPG, PNG, WEBP, MP4, atau WEBM.");
  if (file.size > 200 * 1024 * 1024) throw new Error("Ukuran media maksimal 200 MB.");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `display-content/${station}/${contentId}/${Date.now()}-${safeName}`;
  const target = ref(storage, storagePath);
  await uploadBytes(target, file, { contentType: file.type });
  return { name: file.name, storagePath, url: await getDownloadURL(target) };
}

export async function uploadLoungeLayoutAsset(
  station: string,
  layoutId: string,
  file: File,
  kind: "layout" | "area-photo",
) {
  if (!storageEnabled || !storage)
    throw new Error(
      "Firebase Storage belum diaktifkan. Untuk UAT, gunakan URL asset dari folder public/lounge-layouts.",
    );
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
  if (!allowed.includes(file.type))
    throw new Error("Format denah/foto harus JPG, PNG, WEBP, atau SVG.");
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Ukuran denah/foto maksimal 15 MB.");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `lounge-layouts/${station}/${layoutId}/${kind}/${Date.now()}-${safeName}`;
  const target = ref(storage, storagePath);
  await uploadBytes(target, file, { contentType: file.type });
  return { name: file.name, storagePath, url: await getDownloadURL(target) };
}

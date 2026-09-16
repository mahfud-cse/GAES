import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./client";

export async function uploadEvidence(visitorId: string, file: File) {
  if (!storage) throw new Error("Firebase Storage belum dikonfigurasi.");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const target = ref(storage, `evidence/${visitorId}/${Date.now()}-${safeName}`);
  await uploadBytes(target, file, { contentType: file.type });
  return { name: file.name, url: await getDownloadURL(target) };
}

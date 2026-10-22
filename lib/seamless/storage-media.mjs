// Preserve Firebase Storage as the existing private photo store.
export function storageBucketName(env) {
  const raw = [env.FIREBASE_STORAGE_BUCKET, env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].map(value => String(value || "").trim()).find(Boolean) || "";
  if (!raw) throw Object.assign(new Error("STORAGE_NOT_CONNECTED"), { code: "STORAGE_NOT_CONNECTED", status: 503 });
  const name = raw.replace(/^gs:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name) || name.includes(".."))
    throw Object.assign(new Error("STORAGE_CONFIG_INVALID"), { code: "STORAGE_CONFIG_INVALID", status: 503 });
  return name;
}

export function storageFailure(error, stage) {
  const sourceCode = error?.code;
  const status = Number(error?.response?.statusCode || error?.response?.status || error?.statusCode || sourceCode);
  const reasons = (Array.isArray(error?.errors) ? error.errors : []).map(e => e.reason);
  let code;
  if (typeof sourceCode === "string" && sourceCode.startsWith("STORAGE_") && [
    "STORAGE_NOT_CONNECTED", "STORAGE_CONFIG_INVALID",
  ].includes(sourceCode)) code = sourceCode;
  else if (reasons.some(r => ["accountDisabled", "billingNotEnabled", "billingDisabled"].includes(r))) code = "STORAGE_PROJECT_BLOCKED";
  else if (reasons.some(r => ["accessNotConfigured", "serviceDisabled"].includes(r))) code = "STORAGE_API_DISABLED";
  else if (status === 401 || sourceCode === "storage/invalid-credential" || sourceCode === "invalid_grant") code = "STORAGE_CREDENTIAL_INVALID";
  else if (status === 403 || sourceCode === "storage/unauthorized" || sourceCode === "permission-denied") code = "STORAGE_PERMISSION_DENIED";
  else if (status === 404) code = stage === "storage-save" ? "STORAGE_BUCKET_NOT_FOUND" : "STORAGE_PHOTO_NOT_FOUND";
  else if (sourceCode === "storage/invalid-argument" || status === 400) code = "STORAGE_CONFIG_INVALID";
  else if (status === 429 || reasons.some(r => ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(r))) code = "STORAGE_QUOTA_EXCEEDED";
  else code = "STORAGE_OPERATION_FAILED";
  // Never retain upstream messages: they may contain paths, URLs or credentials.
  return Object.assign(new Error(code), { code, status: 503, stage,
    upstreamStatus: Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined });
}

export function createStorageMedia({ getBucket, repository }) {
  const run = async (stage, work) => {
    try { return await work(getBucket()); }
    catch (error) { throw storageFailure(error, stage); }
  };
  return {
    save: (objectPath, image, meta) => run("storage-save", bucket => bucket.file(objectPath).save(image.bytes, {
      resumable: false,
      timeout: 15000,
      metadata: { contentType: image.contentType, cacheControl: "private, no-store", metadata: meta },
    })),
    read: objectPath => run("storage-read", async bucket => {
      const file = bucket.file(objectPath);
      const [[metadata], [bytes]] = await Promise.all([file.getMetadata(), file.download()]);
      return { bytes, contentType: metadata.contentType };
    }),
    validate: objectPath => run("storage-metadata", async bucket => {
      const [meta] = await bucket.file(objectPath).getMetadata();
      return meta.metadata || {};
    }),
    readUrl: objectPath => run("storage-preview", async bucket => {
      const [url] = await bucket.file(objectPath).getSignedUrl({ action: "read", expires: Date.now() + 120000 });
      return url;
    }),
    repository,
  };
}

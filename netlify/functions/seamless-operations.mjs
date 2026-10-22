import { getStorage } from "firebase-admin/storage";
import { readRepositoryPhoto } from "../../lib/seamless/repository-media.mjs";
import {
  requireUser,
  targetApp,
  targetDb,
  enforceRateLimit,
  json,
} from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";
import {
  createOperationsService,
  safeOperationCodes,
} from "../../lib/seamless/operations.mjs";
import { createSelfHostedProvider } from "../../lib/seamless/self-hosted.mjs";
const bucket = () => {
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!name)
    throw Object.assign(new Error("STORAGE_NOT_CONNECTED"), {
      status: 503,
      code: "STORAGE_NOT_CONNECTED",
    });
  return getStorage(targetApp()).bucket(name);
};
const media = {
  async save(objectPath, image, meta) {
    await bucket()
      .file(objectPath)
      .save(image.bytes, {
        resumable: false,
        metadata: {
          contentType: image.contentType,
          cacheControl: "private, no-store",
          metadata: meta,
        },
      });
  },
  async read(objectPath) {
    const file = bucket().file(objectPath);
    const [[metadata], [bytes]] = await Promise.all([
      file.getMetadata(),
      file.download(),
    ]);
    return { bytes, contentType: metadata.contentType };
  },
  async validate(objectPath) {
    const [m] = await bucket().file(objectPath).getMetadata();
    return m.metadata || {};
  },
  async readUrl(objectPath) {
    const [url] = await bucket()
      .file(objectPath)
      .getSignedUrl({ action: "read", expires: Date.now() + 120000 });
    return url;
  },
  repository: readRepositoryPhoto,
};
const handle = createOperationsService({
  authenticate: requireUser,
  database: targetDb,
  audit: writeAudit,
  media,
  provider: createSelfHostedProvider({ media }),
  rateLimit: (request, identity) =>
    enforceRateLimit(request, "seamless-operations", {
      limit: 150,
      windowMs: 60000,
      identity,
    }),
});
function reply(status, body) {
  const response = json(status, body);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
export default async function handler(request) {
  try {
    return reply(200, await handle(request));
  } catch (e) {
    const status = [400, 401, 403, 404, 405, 409, 413, 429].includes(e.status)
      ? e.status
      : 503;
    const code =
      e.code && safeOperationCodes.has(e.code)
        ? e.code
        : status === 401
          ? "SESSION_EXPIRED"
          : status === 403
            ? "FORBIDDEN"
            : "SERVICE_UNAVAILABLE";
    return reply(status, { error: code, code });
  }
}

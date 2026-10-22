import { getStorage } from "firebase-admin/storage";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
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
  imageBytes,
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
  async repository(folder, file) {
    const root = await realpath(
      path.join(process.cwd(), "private/staff-enrollment"),
    );
    if (
      !/^[\w/-]*$/.test(folder) ||
      folder.includes("..") ||
      !/^[\w.-]+\.(?:jpe?g|png|webp)$/i.test(file) ||
      file.includes("..")
    )
      throw Object.assign(new Error("INVALID_REPOSITORY_PATH"), {
        status: 400,
        code: "INVALID_REPOSITORY_PATH",
      });
    const target = await realpath(path.join(root, folder, file));
    if (!target.startsWith(root + path.sep))
      throw Object.assign(new Error("INVALID_REPOSITORY_PATH"), {
        status: 400,
        code: "INVALID_REPOSITORY_PATH",
      });
    const size = (await stat(target)).size;
    if (size > 1000000)
      throw Object.assign(new Error("PHOTO_TOO_LARGE"), {
        status: 413,
        code: "PHOTO_TOO_LARGE",
      });
    const data = await readFile(target);
    const ext = path.extname(file).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return imageBytes(`data:${mime};base64,${data.toString("base64")}`);
  },
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

import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { createStorageMedia, storageBucketName } from "../../lib/seamless/storage-media.mjs";
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
const media = createStorageMedia({
  getBucket: () => getStorage(targetApp()).bucket(storageBucketName(process.env)),
  repository: readRepositoryPhoto,
});
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
    const requestId = randomUUID();
    console.error(JSON.stringify({ event: "seamless-operation-failed", requestId, code,
      stage: ["storage-save", "storage-read", "storage-metadata", "storage-preview", "repository-read"].includes(e.stage) ? e.stage : "operation",
      upstreamStatus: Number.isInteger(e.upstreamStatus) ? e.upstreamStatus : undefined,
    }));
    return reply(status, { error: code, code, requestId });
  }
}

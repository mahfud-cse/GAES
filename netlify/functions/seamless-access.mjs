import {
  requireUser,
  targetDb,
  enforceRateLimit,
  json,
} from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";
import { createSeamlessService } from "../../lib/seamless/service.mjs";
const handle = createSeamlessService({
  authenticate: requireUser,
  database: targetDb,
  audit: writeAudit,
  rateLimit: (request, actor) =>
    enforceRateLimit(request, "seamless-access", {
      limit: 30,
      windowMs: 60000,
      identity: actor.decoded.uid,
    }),
});
const handler = async (request) => {
  try {
    return json(200, await handle(request));
  } catch (error) {
    // Never relay provider details, references, credentials or raw Firebase errors.
    const status = [400, 401, 403, 404, 405, 409, 413, 429].includes(
      error.status,
    )
      ? error.status
      : 503;
    return json(status, {
      error:
        status === 503
          ? "Seamless Access unavailable. Silakan gunakan Access Verification."
          : error.message,
    });
  }
};

export default handler;

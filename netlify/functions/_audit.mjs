import { json } from "./_firebase-admin.mjs";

const text = (value, max = 500) =>
  String(value || "")
    .trim()
    .slice(0, max);

export function auditRecord(actor, input = {}) {
  const station = text(input.station || actor.profile.station || "ALL", 20).toUpperCase();
  return {
    action: text(input.action, 80).toUpperCase(),
    module: text(input.module, 80) || "Portal",
    result: text(input.result, 40) || "Success",
    station,
    loungeId: text(input.loungeId, 160),
    loungeName: text(input.loungeName, 160),
    scope: text(input.scope || actor.profile.scope, 160) || (station === "ALL" ? "All Stations" : `Station ${station}`),
    targetType: text(input.targetType, 80),
    targetId: text(input.targetId, 180),
    targetName: text(input.targetName, 220),
    detail: text(input.detail, 800),
    reasonCode: text(input.reasonCode, 80),
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name || actor.decoded.name || actor.decoded.email, 160) || "Portal User",
    actorUsername: text(actor.profile.username, 80),
    actorEmail: text(actor.profile.email || actor.decoded.email, 180),
    actorRole: text(actor.profile.role, 100),
    actorOrganization: text(actor.profile.organization, 180),
    createdAt: new Date(),
  };
}

export function writeAudit(batch, db, actor, input) {
  const reference = db.collection("auditLogs").doc();
  batch.set(reference, { id: reference.id, ...auditRecord(actor, input) });
  return reference.id;
}

// Netlify discovers shared files in this directory. Keep direct requests inert.
const handler = async () => json(404, { error: "Not found." });
export default handler;

import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";
import { auditRecord } from "./_audit.mjs";

const CLIENT_EVENTS = new Set([
  "BOARDING_PASS_READ",
  "LOUNGE_ACCESS_DENIED",
  "LOUNGE_ACCESS_GRANTED",
  "EXPORT_VISITOR_REPORT",
  "EXPORT_FACILITY_REPORT",
  "ROOM_CONFIG_SAVED",
  "FLIGHT_DATA_SAVED",
  "MASTER_DATA_SAVED",
  "EXCEPTIONAL_ACCESS_REQUESTED",
  "EXCEPTIONAL_ACCESS_GRANTED",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const text = (value, max = 500) => String(value || "").trim().slice(0, max);

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    const input = await request.json();
    const action = text(input.action, 80).toUpperCase();
    if (!CLIENT_EVENTS.has(action)) throw httpError(400, "Jenis activity tidak valid.");
    const station = text(input.station || actor.profile.station, 20).toUpperCase();
    if (!GLOBAL_ROLES.has(actor.profile.role) && station !== actor.profile.station)
      throw httpError(403, "Activity berada di luar scope station akun.");
    const record = auditRecord(actor, { ...input, action, station });
    const reference = await targetDb().collection("auditLogs").add(record);
    return json(201, { id: reference.id, status: "Recorded" });
  } catch (error) {
    return failure(error);
  }
};

export default handler;

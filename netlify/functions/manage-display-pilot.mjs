import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";

const CONTROL_ROLES = new Set(["Super Admin", "Admin", "HO Admin", "BO Admin", "Lounge Officer", "Lounge Manager"]);
const APPROVER_ROLES = new Set(["Super Admin", "Admin", "HO Admin", "BO Admin", "Lounge Manager"]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const REQUIRED_CHECKS = ["enrollment", "heartbeat", "schedule", "sequence", "offline-cache", "play-now", "running-text", "pause-resume", "refresh", "revoke-reenroll", "autoplay-audio", "source-compatibility"];
const OPTIONAL_CHECKS = ["native-screenshot"];
const text = (value, max = 1000) => String(value || "").trim().slice(0, max);

function requireControl(actor) {
  if (!CONTROL_ROLES.has(actor.profile.role)) throw httpError(403, "Role tidak memiliki akses Pilot UAT.");
}

function requireStation(actor, station) {
  if (!GLOBAL_ROLES.has(actor.profile.role) && actor.profile.station !== station)
    throw httpError(403, "Device berada di luar scope station akun.");
}

async function deviceFor(db, actor, deviceId) {
  const snapshot = await db.collection("displayDevices").doc(deviceId).get();
  if (!snapshot.exists) throw httpError(404, "Display device tidak ditemukan.");
  const device = { id: snapshot.id, ...snapshot.data() };
  requireStation(actor, device.station);
  return device;
}

async function saveTest(db, actor, input) {
  const deviceId = text(input.deviceId, 160);
  const checkId = text(input.checkId, 80);
  const status = text(input.status, 30);
  if (![...REQUIRED_CHECKS, ...OPTIONAL_CHECKS].includes(checkId)) throw httpError(400, "UAT check tidak valid.");
  if (!["Not Tested", "Pass", "Fail", "Blocked", "N/A"].includes(status)) throw httpError(400, "Status UAT tidak valid.");
  if (REQUIRED_CHECKS.includes(checkId) && status === "N/A") throw httpError(400, "Required UAT check tidak dapat ditandai N/A.");
  const device = await deviceFor(db, actor, deviceId);
  const id = `${deviceId}--${checkId}`;
  const batch = db.batch();
  batch.set(db.collection("displayPilotTests").doc(id), {
    id,
    deviceId,
    deviceName: device.name,
    station: device.station,
    checkId,
    required: REQUIRED_CHECKS.includes(checkId),
    status,
    note: text(input.note, 1500),
    testedAt: new Date(),
    testedBy: actor.decoded.uid,
    testedByName: text(actor.profile.name || actor.decoded.email, 120),
    updatedAt: new Date(),
  }, { merge: true });
  batch.update(db.collection("displayDevices").doc(deviceId), { rolloutStatus: "Testing", rolloutCertifiedAt: null, updatedAt: new Date() });
  batch.create(db.collection("displayActivityLogs").doc(), { action: "DISPLAY_PILOT_TEST_RECORDED", station: device.station, deviceId, checkId, testStatus: status, actorId: actor.decoded.uid, actorName: text(actor.profile.name, 120), createdAt: new Date() });
  await batch.commit();
  return { id, status };
}

async function certify(db, actor, input) {
  if (!APPROVER_ROLES.has(actor.profile.role)) throw httpError(403, "Rollout certification memerlukan Lounge Manager, BO Admin, atau Admin HO.");
  const deviceId = text(input.deviceId, 160);
  const device = await deviceFor(db, actor, deviceId);
  if (device.enrollmentStatus !== "Enrolled") throw httpError(409, "Device harus Enrolled sebelum rollout certification.");
  const tests = await db.collection("displayPilotTests").where("deviceId", "==", deviceId).get();
  const byCheck = new Map(tests.docs.map((row) => [row.data().checkId, row.data()]));
  const incomplete = REQUIRED_CHECKS.filter((checkId) => byCheck.get(checkId)?.status !== "Pass");
  if (incomplete.length) throw httpError(409, `Required UAT belum Pass: ${incomplete.join(", ")}.`, "DISPLAY_UAT_INCOMPLETE");
  const batch = db.batch();
  batch.set(db.collection("displayRolloutApprovals").doc(deviceId), {
    id: deviceId,
    deviceId,
    deviceName: device.name,
    station: device.station,
    status: "Ready for Operations",
    note: text(input.note, 1500),
    certifiedAt: new Date(),
    certifiedBy: actor.decoded.uid,
    certifiedByName: text(actor.profile.name || actor.decoded.email, 120),
    updatedAt: new Date(),
  }, { merge: true });
  batch.update(db.collection("displayDevices").doc(deviceId), { rolloutStatus: "Ready for Operations", rolloutCertifiedAt: new Date(), rolloutCertifiedBy: actor.decoded.uid, updatedAt: new Date() });
  batch.create(db.collection("displayActivityLogs").doc(), { action: "DISPLAY_ROLLOUT_CERTIFIED", station: device.station, deviceId, actorId: actor.decoded.uid, actorName: text(actor.profile.name, 120), createdAt: new Date() });
  await batch.commit();
  return { id: deviceId, status: "Ready for Operations" };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireControl(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (action === "savetest") return json(200, await saveTest(db, actor, input));
    if (action === "certify") return json(200, await certify(db, actor, input));
    throw httpError(400, "Pilot action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export { REQUIRED_CHECKS, OPTIONAL_CHECKS };
export default handler;

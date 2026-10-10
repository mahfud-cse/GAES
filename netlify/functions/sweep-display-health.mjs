import { failure, json, targetDb } from "./_firebase-admin.mjs";

const ONLINE_MS = 20 * 1000;
const DEGRADED_MS = 60 * 1000;

function heartbeatMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function healthFor(device, now) {
  const age = now - heartbeatMillis(device.lastHeartbeat);
  if (!heartbeatMillis(device.lastHeartbeat) || age > DEGRADED_MS)
    return { status: "Offline", healthStatus: "Offline" };
  if (age > ONLINE_MS || device.lastError)
    return { status: "Degraded", healthStatus: "Degraded" };
  return { status: "Online", healthStatus: "Healthy" };
}

const handler = async () => {
  try {
    const db = targetDb();
    const snapshot = await db
      .collection("displayDevices")
      .where("enrollmentStatus", "==", "Enrolled")
      .get();
    const now = Date.now();
    let changed = 0;
    for (let offset = 0; offset < snapshot.docs.length; offset += 200) {
      const batch = db.batch();
      snapshot.docs.slice(offset, offset + 200).forEach((document) => {
        const device = document.data();
        const health = healthFor(device, now);
        batch.update(document.ref, {
          ...health,
          healthCheckedAt: new Date(),
          updatedAt: new Date(),
        });
        if (device.healthStatus !== health.healthStatus) {
          changed += 1;
          batch.create(db.collection("displayActivityLogs").doc(), {
            action: `DISPLAY_HEALTH_${health.healthStatus.toUpperCase()}`,
            station: device.station,
            deviceId: document.id,
            previousHealthStatus: device.healthStatus || "Unknown",
            healthStatus: health.healthStatus,
            actorId: "system",
            actorName: "Display Health Monitor",
            createdAt: new Date(),
          });
        }
      });
      await batch.commit();
    }
    return json(200, { checked: snapshot.size, changed });
  } catch (error) {
    return failure(error);
  }
};

export const config = { schedule: "* * * * *" };
export { healthFor };
export default handler;

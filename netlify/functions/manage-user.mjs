import { failure, json, requireUser, targetAuth, targetDb } from "./_firebase-admin.mjs";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(event, ["Super Admin"]);
    const input = JSON.parse(event.body || "{}");
    const uid = String(input.uid || "");
    if (!uid || uid === actor.decoded.uid) return json(400, { error: "Target akun tidak valid." });
    const db = targetDb();
    const current = await db.collection("users").doc(uid).get();
    if (!current.exists) return json(404, { error: "Akun tidak ditemukan." });
    const before = current.data();
    const username = String(input.username || before.username).trim().toLowerCase();
    const email = String(input.email || before.email).trim().toLowerCase();
    const active = input.status !== "Nonaktif";
    await targetAuth().updateUser(uid, { email, displayName: input.name || before.name, disabled: !active });
    const batch = db.batch();
    if (username !== before.username) batch.delete(db.collection("usernames").doc(before.username));
    batch.set(db.collection("usernames").doc(username), { uid, email, active });
    batch.set(db.collection("users").doc(uid), {
      name: input.name, username, email, role: input.role, station: input.station,
      scope: input.scope, organization: input.organization,
      verificationScopes: input.verificationScopes || [], active,
      updatedAt: new Date(), updatedBy: actor.decoded.uid,
    }, { merge: true });
    batch.set(db.collection("auditLogs").doc(), { action: active ? "UPDATE_USER" : "DEACTIVATE_USER", targetId: uid, actorId: actor.decoded.uid, before, createdAt: new Date() });
    await batch.commit();
    return json(200, { uid });
  } catch (error) { return failure(error); }
}

import { failure, json, requireUser, targetAuth, targetDb } from "./_firebase-admin.mjs";

const allowedRoles = new Set(["Super Admin", "Admin", "HO Admin", "BO Admin", "Lounge Officer", "Lounge Manager", "HO Ancillary Coordinator", "HO Ancillary Verifier", "Airline Coordinator", "Airline Verifier", "Report Viewer"]);

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(event, ["Super Admin"]);
    const input = JSON.parse(event.body || "{}");
    const username = String(input.username || "").trim().toLowerCase();
    const email = String(input.email || "").trim().toLowerCase();
    if (!input.name || !email.includes("@") || !/^[a-z0-9._-]{3,40}$/.test(username) || !allowedRoles.has(input.role)) {
      return json(400, { error: "Nama, email, username, atau role tidak valid." });
    }
    const db = targetDb();
    const usernameRef = db.collection("usernames").doc(username);
    if ((await usernameRef.get()).exists) return json(409, { error: "Username sudah digunakan." });
    const record = await targetAuth().createUser({ email, displayName: input.name, disabled: input.status === "Nonaktif" });
    const profile = {
      uid: record.uid, name: input.name, email, username, role: input.role,
      station: input.station || "ALL", scope: input.scope || "Seluruh Station",
      organization: input.organization || "Garuda Indonesia",
      verificationScopes: Array.isArray(input.verificationScopes) ? input.verificationScopes : [],
      active: input.status !== "Nonaktif", createdAt: new Date(), createdBy: actor.decoded.uid,
    };
    const batch = db.batch();
    batch.set(db.collection("users").doc(record.uid), profile);
    batch.set(usernameRef, { uid: record.uid, email, active: profile.active });
    batch.set(db.collection("auditLogs").doc(), { action: "CREATE_USER", targetId: record.uid, actorId: actor.decoded.uid, createdAt: new Date() });
    await batch.commit();
    await targetAuth().generatePasswordResetLink(email);
    return json(201, { uid: record.uid, email, username });
  } catch (error) { return failure(error); }
}

import {
  failure,
  httpError,
  json,
  requireUser,
  targetAuth,
  targetDb,
} from "./_firebase-admin.mjs";

const allowedRoles = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
  "HO Ancillary Coordinator",
  "HO Ancillary Verifier",
  "Airline Coordinator",
  "Airline Verifier",
  "Report Viewer",
]);

export async function createUserRecord(input, actor) {
  const username = String(input.username || "")
    .trim()
    .toLowerCase();
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  const password = String(input.password || "");
  if (
    !input.name ||
    !email.includes("@") ||
    password.length < 8 ||
    !/^[a-z0-9._-]{3,40}$/.test(username) ||
    !allowedRoles.has(input.role)
  ) {
    throw httpError(
      400,
      "Nama, email, username, password, atau role tidak valid.",
    );
  }
  if (actor.profile.role !== "Super Admin" && input.role === "Super Admin") {
    throw httpError(403, "Hanya Super Admin yang dapat membuat Super Admin.");
  }

  const db = targetDb();
  const usernameRef = db.collection("usernames").doc(username);
  if ((await usernameRef.get()).exists)
    throw httpError(409, "Username sudah digunakan.");

  const auth = targetAuth();
  const record = await auth.createUser({
    email,
    password,
    displayName: input.name,
    disabled: input.status === "Nonaktif",
  });
  const profile = {
    uid: record.uid,
    name: input.name,
    email,
    username,
    role: input.role,
    station: input.station || "ALL",
    scope: input.scope || "Seluruh Station",
    organization: input.organization || "Garuda Indonesia",
    verificationScopes: Array.isArray(input.verificationScopes)
      ? input.verificationScopes
      : [],
    active: input.status !== "Nonaktif",
    mustChangePassword: true,
    createdAt: new Date(),
    createdBy: actor.decoded.uid,
  };
  const batch = db.batch();
  batch.set(db.collection("users").doc(record.uid), profile);
  batch.set(usernameRef, { uid: record.uid, email, active: profile.active });
  batch.set(db.collection("auditLogs").doc(), {
    action: "CREATE_USER",
    targetId: record.uid,
    actorId: actor.decoded.uid,
    createdAt: new Date(),
  });
  try {
    await batch.commit();
  } catch (error) {
    // Auth and Firestore cannot share a transaction. Remove the newly-created
    // Auth account when its profile cannot be committed so the username/email
    // can be retried safely by the administrator.
    await auth.deleteUser(record.uid).catch(() => undefined);
    throw error;
  }
  return { uid: record.uid, email, username };
}

export default async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request, ["Super Admin", "Admin"]);
    const result = await createUserRecord(await request.json(), actor);
    return json(201, result);
  } catch (error) {
    return failure(error);
  }
};

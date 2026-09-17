import { failure, json, targetAuth, targetDb } from "./_firebase-admin.mjs";

export default async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const input = await request.json();
    if (!process.env.INITIAL_SETUP_TOKEN || input.setupToken !== process.env.INITIAL_SETUP_TOKEN) {
      return json(403, { error: "Setup token tidak valid." });
    }

    const db = targetDb();
    const bootstrap = await db.collection("system").doc("bootstrap").get();
    const existing = await db.collection("users").where("role", "==", "Super Admin").limit(1).get();
    if (bootstrap.data()?.completed || !existing.empty) {
      return json(409, { error: "Initial Super Admin sudah tersedia." });
    }

    const email = String(input.email || "").trim().toLowerCase();
    const username = String(input.username || "").trim().toLowerCase();
    const user = await targetAuth().createUser({
      email,
      password: input.password,
      displayName: input.name,
    });
    const batch = db.batch();
    batch.set(db.collection("users").doc(user.uid), {
      uid: user.uid,
      name: input.name,
      email,
      username,
      role: "Super Admin",
      station: "ALL",
      scope: "Seluruh Station",
      organization: "Garuda Indonesia",
      verificationScopes: ["ALL"],
      active: true,
      createdAt: new Date(),
    });
    batch.set(db.collection("usernames").doc(username), { uid: user.uid, email, active: true });
    batch.set(db.collection("system").doc("bootstrap"), {
      completed: true,
      completedAt: new Date(),
      uid: user.uid,
    });
    await batch.commit();
    return json(201, { uid: user.uid });
  } catch (error) {
    return failure(error);
  }
};


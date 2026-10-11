import {
  enforceRateLimit,
  failure,
  json,
  targetDb,
} from "./_firebase-admin.mjs";

export default async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const username = String((await request.json()).username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json(400, { error: "Username tidak valid." });
    await enforceRateLimit(request, "resolve-username", {
      // Lounge networks commonly place many workstations behind one public IP.
      limit: 100,
      windowMs: 10 * 60 * 1000,
    });
    const snapshot = await targetDb().collection("usernames").doc(username).get();
    const email = snapshot.data()?.email;
    if (!email) return json(404, { error: "Username tidak ditemukan." });
    return json(200, { email });
  } catch (error) {
    return failure(error);
  }
};


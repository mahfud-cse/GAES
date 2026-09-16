import { failure, json, targetDb } from "./_firebase-admin.mjs";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    const username = String(JSON.parse(event.body || "{}").username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json(400, { error: "Username tidak valid." });
    const snapshot = await targetDb().collection("usernames").doc(username).get();
    const email = snapshot.data()?.email;
    if (!email) return json(404, { error: "Username tidak ditemukan." });
    return json(200, { email });
  } catch (error) { return failure(error); }
}

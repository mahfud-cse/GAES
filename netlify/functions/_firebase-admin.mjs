import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const privateKey = (name) => (process.env[name] || "").replace(/\\n/g, "\n");

function appFor(name, prefix) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;
  return initializeApp({
    credential: cert({
      projectId: process.env[`${prefix}_PROJECT_ID`],
      clientEmail: process.env[`${prefix}_CLIENT_EMAIL`],
      privateKey: privateKey(`${prefix}_PRIVATE_KEY`),
    }),
  }, name);
}

export const targetApp = () => appFor("gaes-target", "FIREBASE");
export const sourceApp = () => appFor("gaes-source", "SOURCE_FIREBASE");
export const targetAuth = () => getAuth(targetApp());
export const targetDb = () => getFirestore(targetApp());
export const sourceDb = () => getFirestore(sourceApp());

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

export async function requireUser(request, roles = []) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Authentication required.");
  const decoded = await targetAuth().verifyIdToken(token);
  const profile = await targetDb().collection("users").doc(decoded.uid).get();
  const data = profile.data() || {};
  if (!data.active || (roles.length && !roles.includes(data.role))) {
    throw httpError(403, "User does not have permission.");
  }
  return { decoded, profile: data };
}

export const json = (status, value) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

export const failure = (error) => json(error.status || 500, {
  ...(error.code ? { code: error.code } : {}),
  error: error.message || "Server error.",
});

// Netlify also discovers this shared module in the functions directory. The
// default Web API export keeps it out of Lambda compatibility mode without
// exposing configuration values.
export default async () => json(404, { error: "Not found." });

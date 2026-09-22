import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const privateKey = (name) => (process.env[name] || "").replace(/\\n/g, "\n");

function appFor(name, prefix) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;
  const projectId = process.env[`${prefix}_PROJECT_ID`];
  const clientEmail = process.env[`${prefix}_CLIENT_EMAIL`];
  const key = privateKey(`${prefix}_PRIVATE_KEY`);
  if (!projectId || !clientEmail || !key) {
    throw httpError(
      500,
      `Konfigurasi ${prefix} belum lengkap di Netlify. Periksa PROJECT_ID, CLIENT_EMAIL, dan PRIVATE_KEY.`,
    );
  }
  return initializeApp(
    {
      credential: cert({
        projectId,
        clientEmail,
        privateKey: key,
      }),
    },
    name,
  );
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
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-firebase-id-token") ||
    "";
  if (!token) throw httpError(401, "Authentication required.", "auth/missing-id-token");

  let decoded;
  try {
    decoded = await targetAuth().verifyIdToken(token);
  } catch (error) {
    // Backend authentication failures are client-auth failures, not Firestore
    // permission failures. Returning 401 lets the browser refresh its Firebase
    // ID token once and retry the same operation safely.
    throw httpError(401, "Firebase authentication token is invalid or expired.", error?.code || "auth/invalid-id-token");
  }

  const profile = await targetDb().collection("users").doc(decoded.uid).get();
  const data = profile.data() || {};
  if (!data.active || (roles.length && !roles.includes(data.role))) {
    throw httpError(403, "User does not have permission.");
  }
  return { decoded, profile: data };
}

export const json = (status, value) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const friendlyFirebaseMessage = (error) =>
  ({
    "auth/email-already-exists": "Email sudah digunakan oleh akun lain.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/invalid-password": "Password sementara minimal 8 karakter.",
    "auth/insufficient-permission":
      "Service account tidak memiliki izin mengelola Firebase Authentication.",
    "permission-denied":
      "Service account atau pengguna tidak memiliki izin Firestore yang diperlukan.",
    "failed-precondition":
      "Konfigurasi Firebase belum memenuhi prasyarat operasi ini.",
  })[error?.code] ||
  error?.message ||
  "Server error.";

export const failure = (error) =>
  json(error.status || 500, {
    ...(error.code ? { code: error.code } : {}),
    error: friendlyFirebaseMessage(error),
  });

// Netlify also discovers this shared module in the functions directory. The
// default Web API export keeps it out of Lambda compatibility mode without
// exposing configuration values.
export default async () => json(404, { error: "Not found." });

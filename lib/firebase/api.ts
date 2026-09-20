import type { User } from "firebase/auth";

async function call<T>(
  path: string,
  user: User | null,
  body: unknown,
): Promise<T> {
  const token = user ? await user.getIdToken() : "";
  const response = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = String(
      payload.error ||
        payload.message ||
        (raw && !raw.trim().startsWith("<") ? raw : "") ||
        `Permintaan tidak dapat diproses (HTTP ${response.status}).`,
    );
    throw new Error(message);
  }
  return payload as T;
}

export const resolveUsername = (username: string) =>
  call<{ email: string }>("resolve-username", null, { username });

export const createManagedUser = (user: User, payload: unknown) =>
  call<{ uid: string; email: string; username: string }>(
    "create-user",
    user,
    payload,
  );

export const updateManagedUser = (user: User, payload: unknown) =>
  call<{ uid: string }>("manage-user", user, payload);

export const deleteManagedUser = (user: User, uid: string) =>
  call<{ uid: string }>("manage-user", user, { action: "delete", uid });

export const resetManagedUserPassword = (
  user: User,
  uid: string,
  password: string,
) =>
  call<{ uid: string }>("manage-user", user, {
    action: "resetPassword",
    uid,
    password,
  });

export const requestPasswordReset = (identity: string, message: string) =>
  call<{ submitted: boolean }>("request-password-reset", null, {
    identity,
    message,
  });

export const completePasswordChange = (user: User) =>
  call<{ uid: string }>("complete-password-change", user, {});

export const importManagedUsers = (user: User, users: unknown[]) =>
  call<{ created: number; errors: Array<{ row: number; error: string }> }>(
    "import-users",
    user,
    { users },
  );

export const syncSourceLounges = (user: User) =>
  call<{ imported: number; skipped: number }>("sync-source-lounges", user, {});

export const createVisitor = (user: User, visitor: unknown) =>
  call<{ id: string; lateScan: boolean }>("create-visitor", user, { visitor });

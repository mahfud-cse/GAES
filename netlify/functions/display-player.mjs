import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { failure, httpError, targetDb } from "./_firebase-admin.mjs";

const text = (value, max = 500) =>
  String(value || "")
    .trim()
    .slice(0, max);
const isApprovedStatus = (value) =>
  ["approved", "disetujui"].includes(text(value, 40).toLowerCase());
const sha = (value) => createHash("sha256").update(value).digest("hex");
const shareSignalId = (sessionId, deviceId) =>
  sha(`${sessionId}|${deviceId}`).slice(0, 48);
const noStoreJson = (status, value) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function requestFingerprint(request) {
  const forwarded =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  return sha(`${forwarded.trim()}|${agent.slice(0, 160)}|display-player`);
}

async function enforceRateLimit(db, request, bucket, maximum, windowMs) {
  const ref = db
    .collection("displayRateLimits")
    .doc(sha(`${bucket}|${requestFingerprint(request)}`));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const current = snapshot.data();
    const resetAt = current?.resetAt?.toDate?.().getTime() || 0;
    const count = resetAt > now ? Number(current.count || 0) : 0;
    if (count >= maximum)
      throw httpError(
        429,
        "Terlalu banyak percobaan. Tunggu sebelum mencoba kembali.",
        "rate-limit",
      );
    transaction.set(
      ref,
      {
        bucket,
        count: count + 1,
        resetAt: new Date(resetAt > now ? resetAt : now + windowMs),
        updatedAt: new Date(),
      },
      { merge: true },
    );
  });
}

function secretMatches(secret, expectedHash) {
  const actual = Buffer.from(sha(secret));
  const expected = Buffer.from(String(expectedHash || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function authenticateDevice(db, input) {
  const deviceId = text(input.deviceId, 160);
  const secret = text(input.deviceSecret, 200);
  if (!deviceId || !secret)
    throw httpError(401, "Device credential wajib tersedia.");
  const [snapshot, credential] = await Promise.all([
    db.collection("displayDevices").doc(deviceId).get(),
    db.collection("displayDeviceCredentials").doc(deviceId).get(),
  ]);
  if (
    !snapshot.exists ||
    !credential.exists ||
    !secretMatches(secret, credential.data()?.secretHash)
  )
    throw httpError(401, "Device credential tidak valid.");
  const device = { id: snapshot.id, ...snapshot.data() };
  if (device.status === "Disabled" || device.enrollmentStatus !== "Enrolled")
    throw httpError(403, "Device tidak aktif atau enrollment telah dicabut.");
  return device;
}

async function claim(db, request, input) {
  await enforceRateLimit(db, request, "enrollment-claim", 8, 10 * 60 * 1000);
  const code = text(input.code, 16)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8)
    throw httpError(400, "Kode enrollment harus 8 karakter.");
  const enrollmentRef = db.collection("displayEnrollments").doc(sha(code));
  const secret = randomBytes(32).toString("base64url");
  const result = await db.runTransaction(async (transaction) => {
    const enrollment = await transaction.get(enrollmentRef);
    if (!enrollment.exists)
      throw httpError(404, "Kode enrollment tidak valid atau kedaluwarsa.");
    const data = enrollment.data();
    if (
      data.status !== "Pending" ||
      data.expiresAt.toDate().getTime() < Date.now()
    )
      throw httpError(409, "Kode enrollment tidak valid atau kedaluwarsa.");
    const deviceRef = db.collection("displayDevices").doc(data.deviceId);
    const credentialRef = db
      .collection("displayDeviceCredentials")
      .doc(data.deviceId);
    const deviceSnapshot = await transaction.get(deviceRef);
    if (
      !deviceSnapshot.exists ||
      !isApprovedStatus(deviceSnapshot.data()?.approvalStatus)
    )
      throw httpError(409, "Device tidak ditemukan atau belum Approved.");
    transaction.update(enrollmentRef, { status: "Used", usedAt: new Date() });
    transaction.set(credentialRef, {
      deviceId: data.deviceId,
      secretHash: sha(secret),
      createdAt: new Date(),
      rotatedAt: new Date(),
    });
    transaction.update(deviceRef, {
      enrollmentStatus: "Enrolled",
      status: "Online",
      playerVersion: text(input.playerVersion, 40),
      enrolledAt: new Date(),
      lastHeartbeat: new Date(),
      updatedAt: new Date(),
    });
    return { id: deviceSnapshot.id, ...deviceSnapshot.data() };
  });
  await db.collection("displayActivityLogs").add({
    action: "DISPLAY_PLAYER_ENROLLED",
    station: result.station,
    deviceId: result.id,
    actorId: result.id,
    actorName: result.name,
    createdAt: new Date(),
  });
  return {
    deviceId: result.id,
    deviceSecret: secret,
    name: result.name,
    station: result.station,
    roomId: result.roomId,
    status: "Enrolled",
  };
}

function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[
    value.weekday
  ];
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    day,
  };
}

async function channelPlan(db, channelId) {
  const channel = await db.collection("displayChannels").doc(channelId).get();
  if (!channel.exists || channel.data()?.status !== "Active") return null;
  const data = channel.data();
  const snapshots = await Promise.all(
    (data.contentIds || []).map((id) =>
      db.collection("displayContents").doc(id).get(),
    ),
  );
  const items = snapshots
    .filter((item) => item.exists && item.data()?.status === "Active")
    .map((item) => ({ id: item.id, ...item.data() }));
  if (!items.length) return null;
  return { channelId: channel.id, channelName: data.name, items };
}

async function schedulePlan(db, device) {
  const station = await db.collection("stations").doc(device.station).get();
  const timeZone = text(station.data()?.timeZone, 80) || "Asia/Jakarta";
  const clock = localClock(new Date(), timeZone);
  const schedules = await db
    .collection("displaySchedules")
    .where("station", "==", device.station)
    .get();
  const matches = schedules.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter(
      (row) =>
        row.status === "Active" &&
        row.deviceIds?.includes(device.id) &&
        row.startDate <= clock.date &&
        row.endDate >= clock.date &&
        row.startTime <= clock.time &&
        row.endTime > clock.time &&
        row.daysOfWeek?.includes(clock.day),
    )
    .sort((a, b) => {
      const priority =
        ({ Emergency: 3, High: 2, Normal: 1 }[b.priority] || 0) -
        ({ Emergency: 3, High: 2, Normal: 1 }[a.priority] || 0);
      if (priority) return priority;
      const aTime =
        a.updatedAt?.toDate?.().getTime() ||
        a.createdAt?.toDate?.().getTime() ||
        0;
      const bTime =
        b.updatedAt?.toDate?.().getTime() ||
        b.createdAt?.toDate?.().getTime() ||
        0;
      return bTime - aTime;
    });
  const selected = matches[0];
  if (!selected) return null;
  const channel = await channelPlan(db, selected.channelId);
  return channel
    ? {
        source: "Schedule",
        scheduleId: selected.id,
        scheduleTitle: selected.title,
        overlayEnabled: selected.overlayEnabled === true,
        overlayText: text(selected.overlayText, 500),
        ...channel,
      }
    : null;
}

async function announcementPlan(db, device) {
  const snapshot = await db
    .collection("displayAnnouncements")
    .where("station", "==", device.station)
    .get();
  const now = Date.now();
  const active = snapshot.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .filter(
      (row) =>
        row.status === "Active" &&
        row.deviceIds?.includes(device.id) &&
        row.startsAt?.toDate?.().getTime() <= now &&
        row.expiresAt?.toDate?.().getTime() > now,
    )
    .sort((a, b) => {
      const priority = Number(b.priority || 0) - Number(a.priority || 0);
      if (priority) return priority;
      return (
        (a.createdAt?.toDate?.().getTime() || 0) -
        (b.createdAt?.toDate?.().getTime() || 0)
      );
    });
  const selected =
    active[0]?.priority >= 100
      ? active.filter((row) => row.priority >= 100)
      : active;
  return selected.flatMap((row) =>
    Array.from(
      { length: Math.max(1, Math.min(5, Number(row.repeatCount) || 1)) },
      (_, index) => ({
        id: `${row.id}-${index + 1}`,
        announcementId: row.id,
        message: text(row.message, 500),
        priority: Number(row.priority) || 0,
        templateName: text(row.templateName, 80),
        flightNumber: text(row.flightNumber, 24),
        expiresAt: row.expiresAt?.toDate?.().toISOString() || "",
      }),
    ),
  );
}

async function sharePlan(db, device) {
  const sessionId = text(device.activeShareSessionId, 160);
  if (!sessionId) return null;
  const [session, signal] = await Promise.all([
    db.collection("displayShareSessions").doc(sessionId).get(),
    db
      .collection("displayShareSignals")
      .doc(shareSignalId(sessionId, device.id))
      .get(),
  ]);
  if (
    !session.exists ||
    session.data()?.status !== "Sharing" ||
    !session.data()?.deviceIds?.includes(device.id)
  )
    return null;
  return {
    sessionId,
    outputGroupId: text(session.data()?.outputGroupId, 160),
    outputGroupName: text(session.data()?.outputGroupName, 120),
    sourceName: text(session.data()?.sourceName, 160),
    offerSdp: text(signal.data()?.offerSdp, 120_000),
    signalStatus: text(signal.data()?.status, 40) || "Waiting",
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };
}

async function submitShareAnswer(db, input) {
  const device = await authenticateDevice(db, input);
  const sessionId = text(input.sessionId, 160);
  const answerSdp = text(input.answerSdp, 120_000);
  if (!sessionId || !answerSdp || device.activeShareSessionId !== sessionId)
    throw httpError(409, "Screen share session tidak sesuai dengan Player.");
  const signalRef = db
    .collection("displayShareSignals")
    .doc(shareSignalId(sessionId, device.id));
  const signal = await signalRef.get();
  if (
    !signal.exists ||
    signal.data()?.deviceId !== device.id ||
    !signal.data()?.offerSdp
  )
    throw httpError(409, "WebRTC offer untuk Player belum tersedia.");
  await signalRef.update({
    answerSdp,
    status: "Answer",
    answeredAt: new Date(),
    updatedAt: new Date(),
  });
  return { sessionId, status: "Answer" };
}

async function acknowledge(db, device, acknowledgments) {
  const rows = Array.isArray(acknowledgments)
    ? acknowledgments.slice(0, 20)
    : [];
  if (!rows.length) return;
  const refs = rows.map((row) =>
    db.collection("displayCommands").doc(text(row.commandId, 160)),
  );
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  const batch = db.batch();
  snapshots.forEach((snapshot, index) => {
    const row = rows[index];
    if (
      !snapshot.exists ||
      snapshot.data()?.deviceId !== device.id ||
      snapshot.data()?.status !== "Pending"
    )
      return;
    const status = row.status === "Failed" ? "Failed" : "Executed";
    batch.update(snapshot.ref, {
      status,
      message: text(row.message, 500),
      acknowledgedAt: new Date(),
      updatedAt: new Date(),
    });
    batch.create(db.collection("displayActivityLogs").doc(), {
      action: `DISPLAY_COMMAND_${status.toUpperCase()}`,
      station: device.station,
      deviceId: device.id,
      commandId: snapshot.id,
      actorId: device.id,
      actorName: device.name,
      detail: text(row.message, 500),
      createdAt: new Date(),
    });
  });
  await batch.commit();
}

async function heartbeat(db, input) {
  const device = await authenticateDevice(db, input);
  await acknowledge(db, device, input.acknowledgments);
  const state = input.state || {};
  const capabilities = input.capabilities || {};
  const telemetry = {
    visibilityState: state.visibilityState === "hidden" ? "Hidden" : "Visible",
    fullscreen: state.fullscreen === true,
    playbackMode: text(state.playbackMode, 40) || "Standby",
    overrideUntil: text(state.overrideUntil, 80),
    activeAnnouncementId: text(state.activeAnnouncementId, 160),
    viewport: {
      width: Math.max(0, Math.min(16384, Number(state.viewport?.width) || 0)),
      height: Math.max(0, Math.min(16384, Number(state.viewport?.height) || 0)),
      pixelRatio: Math.max(
        0,
        Math.min(10, Number(state.viewport?.pixelRatio) || 0),
      ),
    },
  };
  const now = new Date();
  const deviceRef = db.collection("displayDevices").doc(device.id);
  const batch = db.batch();
  batch.update(deviceRef, {
    status: state.status === "Degraded" ? "Degraded" : "Online",
    healthStatus: state.status === "Degraded" ? "Degraded" : "Healthy",
    nowPlaying: text(state.nowPlaying, 160),
    overlayText: text(state.overlayText, 500),
    playerVersion: text(input.playerVersion, 40),
    capabilities,
    ...telemetry,
    lastError: text(state.lastError, 500),
    lastHeartbeat: now,
    updatedAt: now,
  });
  const transitions = [
    ["visibilityState", device.visibilityState, telemetry.visibilityState],
    ["fullscreen", device.fullscreen, telemetry.fullscreen],
    ["playbackMode", device.playbackMode, telemetry.playbackMode],
  ].filter(([, previous, next]) => previous !== undefined && previous !== next);
  transitions.forEach(([field, previous, next]) =>
    batch.create(db.collection("displayActivityLogs").doc(), {
      action: `DISPLAY_PLAYER_${String(field).toUpperCase()}_CHANGED`,
      station: device.station,
      deviceId: device.id,
      actorId: device.id,
      actorName: device.name,
      detail: `${String(previous)} → ${String(next)}`,
      createdAt: now,
    }),
  );
  await batch.commit();
  const commandSnapshots = await db
    .collection("displayCommands")
    .where("deviceId", "==", device.id)
    .get();
  const commandRows = commandSnapshots.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  }));
  const expired = commandRows.filter(
    (row) =>
      row.status === "Pending" &&
      row.expiresAt?.toDate?.().getTime() <= Date.now(),
  );
  if (expired.length) {
    const batch = db.batch();
    expired.forEach((row) =>
      batch.update(db.collection("displayCommands").doc(row.id), {
        status: "Expired",
        updatedAt: new Date(),
      }),
    );
    await batch.commit();
  }
  const commands = commandRows
    .filter(
      (row) =>
        row.status === "Pending" &&
        row.expiresAt?.toDate?.().getTime() > Date.now(),
    )
    .sort(
      (a, b) => a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime(),
    )
    .slice(0, 10);
  for (const command of commands) {
    if (command.type === "PLAY_CHANNEL")
      command.playback = await channelPlan(db, command.payload?.channelId);
  }
  return {
    serverTime: new Date().toISOString(),
    device: {
      id: device.id,
      name: device.name,
      station: device.station,
      roomId: device.roomId,
    },
    schedule: await schedulePlan(db, device),
    announcements: await announcementPlan(db, device),
    share: await sharePlan(db, device),
    commands,
  };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return noStoreJson(405, { error: "Method not allowed." });
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 64 * 1024)
      throw httpError(413, "Player request terlalu besar.");
    const input = await request.json();
    const action = text(input.action, 30).toLowerCase();
    const db = targetDb();
    if (action === "claim")
      return noStoreJson(200, await claim(db, request, input));
    if (action === "heartbeat")
      return noStoreJson(200, await heartbeat(db, input));
    if (action === "shareanswer")
      return noStoreJson(200, await submitShareAnswer(db, input));
    throw httpError(400, "Player action tidak valid.");
  } catch (error) {
    const response = failure(error);
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        "cache-control": "no-store",
      },
    });
  }
};

export default handler;

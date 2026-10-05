/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Credential = {
  deviceId: string;
  deviceSecret: string;
  name: string;
  station: string;
  roomId: string;
};
type ContentItem = {
  id: string;
  title: string;
  contentType: "Live TV" | "Video" | "Image" | "Web URL";
  sourceUrl: string;
  durationSeconds: number;
};
type Playback = {
  channelId: string;
  channelName: string;
  items: ContentItem[];
  overlayEnabled?: boolean;
  overlayText?: string;
  source?: string;
  scheduleId?: string;
};
type Command = {
  id: string;
  type: string;
  payload?: { overlayText?: string; overrideUntil?: string };
  playback?: Playback | null;
};
type Announcement = {
  id: string;
  announcementId: string;
  message: string;
  priority: number;
  templateName: string;
  flightNumber: string;
  expiresAt: string;
};
type HeartbeatResponse = {
  schedule?: Playback | null;
  announcements?: Announcement[];
  commands?: Command[];
  device?: { name: string; station: string };
};
type Ack = {
  commandId: string;
  status: "Executed" | "Failed";
  message: string;
};

const CREDENTIAL_KEY = "gaes-display-player-credential-v1";
const CACHE_KEY = "gaes-display-player-cache-v1";
const PROCESSED_KEY = "gaes-display-player-processed-v1";
const VERSION = "web-player-1.0.0";

class PlayerRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function playerCall<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/.netlify/functions/display-player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new PlayerRequestError(
      result.error || `Player request failed (HTTP ${response.status}).`,
      response.status,
    );
  return result as T;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

export default function DisplayPlayerPage() {
  const [credential, setCredential] = useState<Credential | null>(null);
  const [code, setCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState("");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [tickerCycle, setTickerCycle] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastError, setLastError] = useState("");
  const [lastHeartbeat, setLastHeartbeat] = useState("");
  const acks = useRef<Ack[]>([]);
  const processed = useRef<Set<string>>(new Set());
  const manualOverride = useRef<{ playback: Playback; until: string } | null>(
    null,
  );
  const manualOverlay = useRef<{ text: string; until: string } | null>(null);
  const stoppedUntil = useRef("");
  const announcementQueue = useRef<Announcement[]>([]);
  const announcementIndex = useRef(0);
  const scheduledOverlay = useRef("");

  const clearEnrollment = useCallback((reason = "") => {
    localStorage.removeItem(CREDENTIAL_KEY);
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(PROCESSED_KEY);
    setCredential(null);
    setPlayback(null);
    setOverlayText("");
    setPaused(false);
    setMessage(reason);
    manualOverride.current = null;
    manualOverlay.current = null;
    announcementQueue.current = [];
    stoppedUntil.current = "";
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const saved = readJson<Credential | null>(CREDENTIAL_KEY, null);
      const cached = readJson<{
        playback?: Playback;
        overlayText?: string;
        manualOverride?: { playback: Playback; until: string };
      }>(CACHE_KEY, {});
      processed.current = new Set(readJson<string[]>(PROCESSED_KEY, []));
      if (saved) setCredential(saved);
      if (cached.playback) setPlayback(cached.playback);
      if (cached.overlayText) setOverlayText(cached.overlayText);
      if (
        cached.manualOverride &&
        Date.parse(cached.manualOverride.until) > Date.now()
      )
        manualOverride.current = cached.manualOverride;
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  const cacheState = useCallback(
    (nextPlayback: Playback | null, nextOverlay: string) => {
      if (!nextPlayback) return;
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          playback: nextPlayback,
          overlayText: nextOverlay,
          manualOverride: manualOverride.current,
        }),
      );
    },
    [],
  );

  const executeCommands = useCallback((commands: Command[]) => {
    for (const command of commands) {
      if (processed.current.has(command.id)) {
        acks.current.push({
          commandId: command.id,
          status: "Executed",
          message: "Idempotent replay acknowledged.",
        });
        continue;
      }
      try {
        if (command.type === "PLAY_CHANNEL" && command.playback) {
          const until =
            command.payload?.overrideUntil ||
            new Date(Date.now() + 60 * 60 * 1000).toISOString();
          manualOverride.current = { playback: command.playback, until };
          setPlayback(command.playback);
          setItemIndex(0);
        } else if (command.type === "SET_OVERLAY") {
          manualOverlay.current = {
            text: command.payload?.overlayText || "",
            until:
              command.payload?.overrideUntil ||
              new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          };
          setOverlayText(manualOverlay.current.text);
          setTickerCycle((value) => value + 1);
        } else if (command.type === "CLEAR_OVERLAY") {
          manualOverlay.current = null;
          setOverlayText(
            announcementQueue.current[announcementIndex.current]?.message ||
              scheduledOverlay.current,
          );
          setTickerCycle((value) => value + 1);
        } else if (command.type === "STOP_PLAYBACK") {
          manualOverride.current = null;
          stoppedUntil.current =
            command.payload?.overrideUntil ||
            new Date(Date.now() + 60 * 60 * 1000).toISOString();
          setPlayback(null);
          setItemIndex(0);
          setPaused(false);
          localStorage.removeItem(CACHE_KEY);
        } else if (command.type === "PAUSE") {
          setPaused(true);
        } else if (command.type === "RESUME") {
          setPaused(false);
        } else if (command.type === "REFRESH") {
          acks.current.push({
            commandId: command.id,
            status: "Executed",
            message: "Player refresh accepted.",
          });
          processed.current.add(command.id);
          localStorage.setItem(
            PROCESSED_KEY,
            JSON.stringify([...processed.current].slice(-100)),
          );
          window.setTimeout(() => window.location.reload(), 400);
          continue;
        } else if (command.type === "REQUEST_SCREENSHOT") {
          throw new Error(
            "Unattended screenshot is unavailable in the browser player; use the native/Android player capability.",
          );
        }
        processed.current.add(command.id);
        acks.current.push({
          commandId: command.id,
          status: "Executed",
          message: "Command executed by web player.",
        });
      } catch (error) {
        acks.current.push({
          commandId: command.id,
          status: "Failed",
          message: error instanceof Error ? error.message : "Command failed.",
        });
      }
    }
    localStorage.setItem(
      PROCESSED_KEY,
      JSON.stringify([...processed.current].slice(-100)),
    );
  }, []);

  const heartbeat = useCallback(async () => {
    if (!credential) return;
    const sentAcks = [...acks.current];
    try {
      const result = await playerCall<HeartbeatResponse>({
        action: "heartbeat",
        ...credential,
        playerVersion: VERSION,
        capabilities: {
          browserPlayer: true,
          screenshot: false,
          offlinePlanCache: true,
          runningText: true,
        },
        acknowledgments: sentAcks,
        state: {
          status: lastError ? "Degraded" : "Online",
          nowPlaying: playback?.items[itemIndex]?.title || "",
          overlayText,
          lastError,
          visibilityState: document.visibilityState,
          fullscreen: Boolean(document.fullscreenElement),
          playbackMode: stoppedUntil.current
            ? "Standby Override"
            : manualOverride.current
              ? "Manual Override"
              : playback?.source === "Schedule"
                ? "Schedule"
                : playback
                  ? "Channel"
                  : "Standby",
          overrideUntil:
            stoppedUntil.current || manualOverride.current?.until || "",
          activeAnnouncementId:
            announcementQueue.current[announcementIndex.current]
              ?.announcementId || "",
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: window.devicePixelRatio,
          },
        },
      });
      acks.current = acks.current.slice(sentAcks.length);
      setOnline(true);
      setLastHeartbeat(new Date().toISOString());
      setLastError("");
      executeCommands(result.commands || []);
      const override = manualOverride.current;
      if (override && Date.parse(override.until) <= Date.now())
        manualOverride.current = null;
      if (
        stoppedUntil.current &&
        Date.parse(stoppedUntil.current) <= Date.now()
      )
        stoppedUntil.current = "";
      if (
        manualOverlay.current &&
        Date.parse(manualOverlay.current.until) <= Date.now()
      )
        manualOverlay.current = null;
      const next = stoppedUntil.current
        ? null
        : manualOverride.current?.playback || result.schedule || null;
      if (!next && playback) {
        setPlayback(null);
        setItemIndex(0);
      }
      if (next && next.channelId !== playback?.channelId) {
        setPlayback(next);
        setItemIndex(0);
      }
      const nextAnnouncements = (result.announcements || []).filter(
        (row) => row.message && Date.parse(row.expiresAt) > Date.now(),
      );
      const currentAnnouncementId =
        announcementQueue.current[announcementIndex.current]?.id;
      announcementQueue.current = nextAnnouncements;
      const preservedIndex = currentAnnouncementId
        ? nextAnnouncements.findIndex((row) => row.id === currentAnnouncementId)
        : -1;
      if (preservedIndex >= 0) announcementIndex.current = preservedIndex;
      else if (announcementIndex.current >= nextAnnouncements.length)
        announcementIndex.current = 0;
      scheduledOverlay.current = next?.overlayEnabled
        ? next.overlayText || ""
        : "";
      const nextOverlay = manualOverlay.current
        ? manualOverlay.current.text
        : nextAnnouncements[announcementIndex.current]?.message ||
          scheduledOverlay.current;
      if (overlayText !== nextOverlay) {
        setOverlayText(nextOverlay);
        setTickerCycle((value) => value + 1);
      }
      cacheState(next, nextOverlay);
    } catch (error) {
      if (
        error instanceof PlayerRequestError &&
        [401, 403].includes(error.status)
      ) {
        clearEnrollment(
          "Enrollment device telah dicabut. Masukkan kode enrollment baru.",
        );
        return;
      }
      setOnline(false);
      setLastError(
        error instanceof Error ? error.message : "Heartbeat failed.",
      );
    }
  }, [
    cacheState,
    clearEnrollment,
    credential,
    executeCommands,
    itemIndex,
    lastError,
    overlayText,
    playback,
  ]);

  useEffect(() => {
    if (!credential) return;
    const initial = window.setTimeout(() => void heartbeat(), 0);
    const timer = window.setInterval(() => void heartbeat(), 5000);
    const reportVisibility = () => {
      setFullscreenActive(Boolean(document.fullscreenElement));
      void heartbeat();
    };
    const fullscreenTimer = window.setTimeout(
      () => setFullscreenActive(Boolean(document.fullscreenElement)),
      0,
    );
    document.addEventListener("visibilitychange", reportVisibility);
    document.addEventListener("fullscreenchange", reportVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(fullscreenTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", reportVisibility);
      document.removeEventListener("fullscreenchange", reportVisibility);
    };
  }, [credential, heartbeat]);

  useEffect(() => {
    if (!credential) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const wakeLockApi = (
      navigator as Navigator & {
        wakeLock?: {
          request: (
            type: "screen",
          ) => Promise<{ release: () => Promise<void> }>;
        };
      }
    ).wakeLock;
    const requestWakeLock = async () => {
      if (!wakeLockApi || document.visibilityState !== "visible") return;
      try {
        wakeLock = await wakeLockApi.request("screen");
      } catch {
        // Some Smart TV browsers do not expose the Screen Wake Lock API.
      }
    };
    void requestWakeLock();
    document.addEventListener("visibilitychange", requestWakeLock);
    return () => {
      document.removeEventListener("visibilitychange", requestWakeLock);
      void wakeLock?.release();
    };
  }, [credential]);

  function advanceTicker() {
    if (!manualOverlay.current && announcementQueue.current.length) {
      announcementIndex.current =
        (announcementIndex.current + 1) % announcementQueue.current.length;
      setOverlayText(
        announcementQueue.current[announcementIndex.current]?.message ||
          scheduledOverlay.current,
      );
    }
    setTickerCycle((value) => value + 1);
  }

  const current = playback?.items[itemIndex];
  useEffect(() => {
    if (!current || paused || !playback || playback.items.length < 2) return;
    const seconds =
      current.durationSeconds ||
      (current.contentType === "Image"
        ? 15
        : current.contentType === "Web URL"
          ? 60
          : 0);
    if (!seconds) return;
    const timer = window.setTimeout(
      () => setItemIndex((value) => (value + 1) % playback.items.length),
      seconds * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [current, paused, playback]);

  async function enroll(event: FormEvent) {
    event.preventDefault();
    setEnrolling(true);
    setMessage("");
    try {
      const result = await playerCall<Credential & { status: string }>({
        action: "claim",
        code,
        playerVersion: VERSION,
      });
      const next = {
        deviceId: result.deviceId,
        deviceSecret: result.deviceSecret,
        name: result.name,
        station: result.station,
        roomId: result.roomId,
      };
      localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(next));
      setCredential(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enrollment gagal.");
    } finally {
      setEnrolling(false);
    }
  }

  function resetPlayer() {
    if (
      !window.confirm(
        "Hapus enrollment dari browser ini? Device perlu kode baru untuk terhubung kembali.",
      )
    )
      return;
    clearEnrollment();
  }

  if (!credential)
    return (
      <main className="playerEnroll">
        <form onSubmit={(event) => void enroll(event)}>
          <img src="/garuda-wing.svg" alt="Garuda Indonesia" />
          <small>GAES DISPLAY PLAYER</small>
          <h1>Connect this screen</h1>
          <p>
            Masukkan kode enrollment 8 karakter yang dibuat dari Device Control
            Center.
          </p>
          <label>
            <span>Enrollment Code</span>
            <input
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 8),
                )
              }
              maxLength={8}
              autoFocus
              required
            />
          </label>
          {message && <div className="playerError">{message}</div>}
          <button
            className="primary"
            type="submit"
            disabled={enrolling || code.length !== 8}
          >
            {enrolling ? "Connecting..." : "Connect Device"}
          </button>
        </form>
      </main>
    );

  return (
    <main className={`displayPlayer ${paused ? "paused" : ""}`}>
      <div className="playerCanvas">
        {!current && (
          <div className="playerStandby">
            <img src="/garuda-wing.svg" alt="Garuda Indonesia" />
            <h1>Screen Ready</h1>
            <p>Waiting for an active schedule or Play Now command.</p>
          </div>
        )}
        {current?.contentType === "Image" && (
          <img
            className="playerMedia"
            src={current.sourceUrl}
            alt={current.title}
          />
        )}
        {current?.contentType === "Video" && (
          <video
            className="playerMedia"
            src={current.sourceUrl}
            autoPlay
            muted={false}
            playsInline
            onEnded={() =>
              playback &&
              setItemIndex((value) => (value + 1) % playback.items.length)
            }
          />
        )}
        {(current?.contentType === "Live TV" ||
          current?.contentType === "Web URL") && (
          <iframe
            className="playerMedia"
            src={current.sourceUrl}
            title={current.title}
            allow="autoplay; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {paused && <div className="playerPaused">PAUSED</div>}
        {overlayText && (
          <div className="playerTicker">
            <div
              key={`${overlayText}-${tickerCycle}`}
              style={{
                animationDuration: `${Math.max(12, Math.min(50, 8 + overlayText.length * 0.22))}s`,
              }}
              onAnimationEnd={advanceTicker}
            >
              {overlayText}
            </div>
          </div>
        )}
      </div>
      <div className="playerStatus">
        <span className={online ? "online" : "offline"}>
          {online ? "Online" : "Offline cache"}
        </span>
        <b>{credential.name}</b>
        <span>{current?.title || "Standby"}</span>
        <small>{fullscreenActive ? "Fullscreen" : "Windowed"}</small>
        <small>
          {lastHeartbeat
            ? new Date(lastHeartbeat).toLocaleTimeString("id-ID")
            : "—"}
        </small>
        <button
          type="button"
          onClick={() => void document.documentElement.requestFullscreen?.()}
        >
          Fullscreen
        </button>
        <button type="button" onClick={resetPlayer}>
          Reset
        </button>
      </div>
    </main>
  );
}

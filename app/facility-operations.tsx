"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  manageDisplayContent,
  manageDisplayDevice,
  manageDisplayPilot,
  manageRoomBooking,
  manageRoomOperation,
} from "../lib/firebase/api";
import { uploadDisplayMedia } from "../lib/firebase/evidence";
import {
  removeRecord,
  saveRecord,
  subscribeCollection,
  subscribeStationCollection,
} from "../lib/firebase/repository";

type FacilityRole =
  | "Super Admin"
  | "Admin"
  | "HO Admin"
  | "BO Admin"
  | "Lounge Officer"
  | "Lounge Manager"
  | "HO Ancillary Coordinator"
  | "HO Ancillary Verifier"
  | "Airline Coordinator"
  | "Airline Verifier"
  | "Report Viewer";

type FacilityAccount = {
  id: string;
  name: string;
  role: FacilityRole;
  station: string;
};

type StationOption = { code: string; name: string; timeZone: string };

type RoomState =
  "Available" | "Reserved" | "Occupied" | "Cleaning" | "Maintenance";
type RoomRecord = {
  id: string;
  station: string;
  name: string;
  area: string;
  roomType: string;
  capacity: number;
  facilities: string[];
  operationalState: RoomState;
  status: "Active" | "Inactive";
};

type DeviceRecord = {
  id: string;
  station: string;
  roomId: string;
  name: string;
  platform: "Smart TV Browser" | "Android Signage Player" | "Mini PC";
  connectionType: "LAN" | "Wi-Fi";
  approvalStatus: "Pending" | "Approved" | "Rejected";
  status: "Online" | "Offline" | "Degraded" | "Disabled" | "Unregistered";
  nowPlaying: string;
  overlayText: string;
  lastHeartbeat: string;
  playerVersion: string;
  screenshotUrl?: string;
  approvedBy?: string;
  approvedAt?: string;
  enrollmentStatus?: "Pending" | "Enrolled" | "Revoked";
  capabilities?: {
    screenshot?: boolean;
    browserPlayer?: boolean;
    runningText?: boolean;
    offlinePlanCache?: boolean;
    cacheStorage?: boolean;
    persistentStorage?: boolean;
  };
  lastError?: string;
  healthStatus?: "Healthy" | "Degraded" | "Offline";
  rolloutStatus?: "Testing" | "Ready for Operations";
  rolloutCertifiedAt?: unknown;
  visibilityState?: "Visible" | "Hidden";
  fullscreen?: boolean;
  playbackMode?:
    | "Schedule"
    | "Manual Override"
    | "Standby Override"
    | "Screen Share"
    | "Channel"
    | "Standby";
  overrideUntil?: string;
  activeAnnouncementId?: string;
  viewport?: { width?: number; height?: number; pixelRatio?: number };
  cacheStatus?:
    | "Pending Download"
    | "Downloading"
    | "Ready Offline"
    | "Update Available"
    | "Streaming Only"
    | "Storage Insufficient"
    | "Cache Unsupported"
    | "Download Failed";
  cachedContentCount?: number;
  cacheProgress?: number;
  storageUsageBytes?: number;
  storageQuotaBytes?: number;
  persistentStorage?: boolean;
};

type DisplayContent = {
  id: string;
  title: string;
  contentType: "Live TV" | "Video" | "Image" | "Web URL";
  sourceUrl: string;
  storagePath?: string;
  station: string;
  durationSeconds: number;
  description: string;
  status: "Active" | "Inactive";
};
type DisplayChannel = {
  id: string;
  name: string;
  description: string;
  contentIds: string[];
  status: "Active" | "Inactive";
};
type OutputSourceMode =
  | "Cached Playlist"
  | "Managed Channel"
  | "Live Screen Share"
  | "External TV/IPTV"
  | "Emergency Override";
type DisplayOutputGroup = {
  id: string;
  station: string;
  name: string;
  description: string;
  deviceIds: string[];
  status: "Active" | "Inactive";
  sessionStatus?: "Idle" | "Ready" | "Sharing" | "Error";
  activeSourceName?: string;
  activeShareSessionId?: string;
  sourceMode?: OutputSourceMode;
  updatedAt?: unknown;
};

type ShareRuntime = {
  group: DisplayOutputGroup;
  sessionId: string;
  sourceName: string;
  stream: MediaStream;
  peers: Map<string, RTCPeerConnection>;
};

type ActiveShareState = {
  groupId: string;
  groupName: string;
  sessionId: string;
  sourceName: string;
  deviceStates: Record<string, string>;
};
type DisplaySchedule = {
  id: string;
  station: string;
  title: string;
  channelId: string;
  channelName: string;
  deviceIds: string[];
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  overlayEnabled: boolean;
  overlayText: string;
  priority: "Normal" | "High" | "Emergency";
  status: "Active" | "Inactive";
};
type DisplayCommand = {
  id: string;
  deviceId: string;
  station: string;
  type: string;
  status: "Pending" | "Executed" | "Failed" | "Expired";
  message?: string;
  createdAt?: unknown;
};
type FlightReference = {
  id: string;
  date: string;
  flight: string;
  origin: string;
  destination: string;
  std: string;
  etd: string;
  status: string;
};
type AnnouncementTemplate = {
  id: string;
  name: string;
  messageTemplate: string;
  defaultDurationMinutes: number;
  priority: number;
  repeatCount: number;
  status: "Active" | "Inactive";
};
type DisplayAnnouncement = {
  id: string;
  station: string;
  deviceIds: string[];
  templateId: string;
  templateName: string;
  message: string;
  flightNumber: string;
  route: string;
  priority: number;
  durationMinutes: number;
  status: string;
  expiresAt?: unknown;
  createdByName?: string;
};
type QuickAnnouncementDraft = {
  station: string;
  outputGroupId: string;
  templateId: string;
  flightId: string;
  flightNumber: string;
  route: string;
  etd: string;
  oldGate: string;
  newGate: string;
  message: string;
  durationMinutes: number;
  deviceIds: string[];
};
type DisplayPilotTest = {
  id: string;
  deviceId: string;
  deviceName: string;
  station: string;
  checkId: string;
  required: boolean;
  status: "Not Tested" | "Pass" | "Fail" | "Blocked" | "N/A";
  note?: string;
  testedByName?: string;
  testedAt?: unknown;
};
type DisplayRolloutApproval = {
  id: string;
  deviceId: string;
  station: string;
  status: "Ready for Operations";
  note?: string;
  certifiedByName?: string;
  certifiedAt?: unknown;
};

type BookingStatus =
  | "Draft"
  | "Requested"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | "Checked-in"
  | "Completed"
  | "No Show";
type RoomBooking = {
  id: string;
  station: string;
  roomId: string;
  roomName: string;
  title: string;
  purpose: string;
  organizer: string;
  contact: string;
  attendees: number;
  startAt: string;
  endAt: string;
  localDate: string;
  startTime: string;
  endTime: string;
  stationTimeZone: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  notes: string;
  visitorReference: string;
  status: BookingStatus;
  recurrenceGroupId?: string;
  createdBy: string;
  createdByName: string;
  checkedInAt?: unknown;
  checkedOutAt?: unknown;
  privacy?: "Detail" | "Masked";
};
type BookingDraft = {
  station: string;
  roomId: string;
  title: string;
  purpose: string;
  organizer: string;
  contact: string;
  attendees: number;
  localDate: string;
  startTime: string;
  endTime: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  recurrenceType: "None" | "Daily" | "Weekly" | "Monthly";
  recurrenceCount: number;
  visitorReference: string;
  notes: string;
};

type RoomOperation = {
  id: string;
  bookingId: string;
  station: string;
  roomId: string;
  roomName: string;
  status: "Checked-in" | "Cleaning" | "Completed" | "No Show";
  checkedInByName?: string;
  handoverTo?: string;
  issueSummary?: string;
  checkedInAt?: unknown;
  checkedOutAt?: unknown;
};
type RoomMaintenance = {
  id: string;
  station: string;
  roomId: string;
  roomName: string;
  category: string;
  reason: string;
  resolution?: string;
  status: "Open" | "Completed";
};
type RoomIncident = {
  id: string;
  station: string;
  roomId: string;
  roomName: string;
  bookingId?: string;
  category: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  description: string;
  status: "Open" | "Resolved";
  reportedByName?: string;
};
type RoomActivity = {
  id: string;
  station: string;
  roomId: string;
  bookingId?: string;
  action: string;
  actorName: string;
  reason?: string;
  createdAt?: unknown;
};
type OperationDialog = {
  type:
    "checkin" | "checkout" | "cleaning" | "move" | "maintenance" | "incident";
  booking?: RoomBooking;
  room?: RoomRecord;
};
type OperationForm = {
  clean: boolean;
  avReady: boolean;
  amenitiesReady: boolean;
  safetyChecked: boolean;
  tvReady: boolean;
  readinessNote: string;
  overrideReason: string;
  handoverTo: string;
  handoverNote: string;
  issueSummary: string;
  cleaningClean: boolean;
  cleaningAmenities: boolean;
  cleaningDamageChecked: boolean;
  cleaningNote: string;
  targetRoomId: string;
  reason: string;
  category: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  description: string;
};

type Notice = { kind: "ok" | "warn" | "error"; text: string };
type ModuleTab =
  | "Overview"
  | "Room Booking"
  | "Room Operations"
  | "TV & Digital Signage"
  | "Master & Configuration"
  | "Activity Log";

const GLOBAL_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "HO Ancillary Coordinator",
  "HO Ancillary Verifier",
];
const CONFIG_ROLES: FacilityRole[] = ["Super Admin", "Admin", "HO Admin"];
const CONTROL_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Manager",
  "Lounge Officer",
];
const APPROVER_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
];

const DISPLAY_UAT_CHECKS = [
  { id: "enrollment", label: "Secure enrollment", required: true },
  { id: "heartbeat", label: "Heartbeat & health state", required: true },
  { id: "schedule", label: "Scheduled playback", required: true },
  { id: "sequence", label: "Channel playback order", required: true },
  { id: "offline-cache", label: "Offline plan fallback", required: true },
  { id: "play-now", label: "Play Channel Now", required: true },
  { id: "running-text", label: "Running text overlay", required: true },
  { id: "pause-resume", label: "Pause & resume", required: true },
  { id: "refresh", label: "Remote refresh", required: true },
  { id: "revoke-reenroll", label: "Revoke & re-enroll", required: true },
  { id: "autoplay-audio", label: "Autoplay & audio policy", required: true },
  {
    id: "source-compatibility",
    label: "Live TV / source compatibility",
    required: true,
  },
  {
    id: "native-screenshot",
    label: "Native screenshot capability",
    required: false,
  },
] as const;

const EMPTY_ROOM: Omit<RoomRecord, "id"> = {
  station: "CGK",
  name: "",
  area: "",
  roomType: "Meeting Room",
  capacity: 1,
  facilities: [],
  operationalState: "Available",
  status: "Active",
};

const EMPTY_DEVICE: Omit<DeviceRecord, "id"> = {
  station: "CGK",
  roomId: "",
  name: "",
  platform: "Smart TV Browser",
  connectionType: "LAN",
  approvalStatus: "Pending",
  status: "Unregistered",
  nowPlaying: "",
  overlayText: "",
  lastHeartbeat: "",
  playerVersion: "",
};

const DEFAULT_ANNOUNCEMENT_TEMPLATES: AnnouncementTemplate[] = [
  {
    id: "boarding",
    name: "Boarding Now",
    messageTemplate: "{flight} {route} — BOARDING NOW",
    defaultDurationMinutes: 10,
    priority: 60,
    repeatCount: 1,
    status: "Active",
  },
  {
    id: "final-call",
    name: "Final Call",
    messageTemplate: "{flight} {route} — FINAL CALL",
    defaultDurationMinutes: 5,
    priority: 80,
    repeatCount: 2,
    status: "Active",
  },
  {
    id: "delay",
    name: "New ETD / Delay",
    messageTemplate: "{flight} {route} — NEW ETD {etd}",
    defaultDurationMinutes: 15,
    priority: 50,
    repeatCount: 1,
    status: "Active",
  },
  {
    id: "gate-change",
    name: "Gate Change",
    messageTemplate: "{flight} {route} — GATE CHANGE: {oldGate} TO {newGate}",
    defaultDurationMinutes: 15,
    priority: 70,
    repeatCount: 2,
    status: "Active",
  },
  {
    id: "cancellation",
    name: "Cancellation",
    messageTemplate: "{flight} {route} — FLIGHT CANCELLED",
    defaultDurationMinutes: 15,
    priority: 90,
    repeatCount: 2,
    status: "Active",
  },
  {
    id: "emergency",
    name: "Emergency",
    messageTemplate: "{message}",
    defaultDurationMinutes: 30,
    priority: 100,
    repeatCount: 3,
    status: "Active",
  },
  {
    id: "custom",
    name: "Custom Message",
    messageTemplate: "{message}",
    defaultDurationMinutes: 10,
    priority: 40,
    repeatCount: 1,
    status: "Active",
  },
];

function announcementPreview(
  template: AnnouncementTemplate | undefined,
  draft: QuickAnnouncementDraft,
) {
  if (!template) return "";
  const values: Record<string, string> = {
    flight: draft.flightNumber.trim().toUpperCase(),
    route: draft.route.trim().toUpperCase(),
    etd: draft.etd.trim(),
    oldGate: draft.oldGate.trim().toUpperCase(),
    newGate: draft.newGate.trim().toUpperCase(),
    message: draft.message.trim(),
  };
  return template.messageTemplate
    .replace(
      /\{(flight|route|etd|oldGate|newGate|message)\}/g,
      (_, key) => values[key] || `[${key}]`,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function localToday() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function waitForPeerIce(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 5000);
    const onChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

const EMPTY_CONTENT: Omit<DisplayContent, "id"> = {
  title: "",
  contentType: "Live TV",
  sourceUrl: "",
  storagePath: "",
  station: "ALL",
  durationSeconds: 0,
  description: "",
  status: "Active",
};

const EMPTY_CHANNEL: Omit<DisplayChannel, "id"> = {
  name: "",
  description: "",
  contentIds: [],
  status: "Active",
};

const EMPTY_OUTPUT_GROUP: Omit<DisplayOutputGroup, "id"> = {
  station: "CGK",
  name: "",
  description: "",
  deviceIds: [],
  status: "Active",
  sessionStatus: "Idle",
  sourceMode: "Managed Channel",
};

const EMPTY_SCHEDULE: Omit<DisplaySchedule, "id" | "channelName"> = {
  station: "CGK",
  title: "",
  channelId: "",
  deviceIds: [],
  startDate: localToday(),
  endDate: localToday(),
  startTime: "06:00",
  endTime: "23:00",
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  overlayEnabled: false,
  overlayText: "",
  priority: "Normal",
  status: "Active",
};

const EMPTY_BOOKING: BookingDraft = {
  station: "CGK",
  roomId: "",
  title: "",
  purpose: "",
  organizer: "",
  contact: "",
  attendees: 1,
  localDate: localToday(),
  startTime: "09:00",
  endTime: "10:00",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  recurrenceType: "None",
  recurrenceCount: 1,
  visitorReference: "",
  notes: "",
};

const EMPTY_OPERATION: OperationForm = {
  clean: false,
  avReady: false,
  amenitiesReady: false,
  safetyChecked: false,
  tvReady: false,
  readinessNote: "",
  overrideReason: "",
  handoverTo: "",
  handoverNote: "",
  issueSummary: "",
  cleaningClean: false,
  cleaningAmenities: false,
  cleaningDamageChecked: false,
  cleaningNote: "",
  targetRoomId: "",
  reason: "",
  category: "General",
  severity: "Medium",
  description: "",
};

function recordId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isOnline(device: DeviceRecord) {
  if (device.status === "Disabled" || !isDeviceApproved(device)) return false;
  if (!device.lastHeartbeat) return device.status === "Online";
  const heartbeat = activityMillis(device.lastHeartbeat);
  return heartbeat > 0 && Date.now() - heartbeat < 20_000;
}

function playerOperationalStatus(device: DeviceRecord) {
  if (device.enrollmentStatus !== "Enrolled") return "Not Enrolled";
  const heartbeat = activityMillis(device.lastHeartbeat);
  const age = heartbeat ? Date.now() - heartbeat : Number.POSITIVE_INFINITY;
  if (age > 60_000) return "Offline";
  if (age > 20_000 || device.lastError) return "Connection Warning";
  if (device.visibilityState === "Hidden") return "Online – Hidden";
  if (device.playbackMode === "Standby") return "Online – Standby";
  if (device.playbackMode === "Standby Override") return "Online – Stopped";
  return "Online – Playing";
}

function playerStatusClass(device: DeviceRecord) {
  const status = playerOperationalStatus(device);
  if (status === "Offline" || status === "Not Enrolled") return "offline";
  if (status.includes("Warning") || status.includes("Hidden"))
    return "degraded";
  return "online";
}

function canonicalApprovalStatus(
  value: unknown,
): DeviceRecord["approvalStatus"] {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["approved", "disetujui"].includes(normalized)) return "Approved";
  if (["rejected", "ditolak"].includes(normalized)) return "Rejected";
  return "Pending";
}

function isDeviceApproved(device: DeviceRecord) {
  return canonicalApprovalStatus(device.approvalStatus) === "Approved";
}

function isDeviceEnrolled(device: DeviceRecord) {
  return (
    String(device.enrollmentStatus || "")
      .trim()
      .toLowerCase() === "enrolled"
  );
}

function readableHeartbeat(value: unknown): string {
  if (!value) return "Belum pernah terhubung";
  const millis = activityMillis(value);
  if (!millis) return "Format waktu tidak dikenali";
  return new Date(millis).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function localDateTimeToIso(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const displayedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return new Date(guess - (displayedAsUtc - guess)).toISOString();
}

export default function FacilityOperations({
  account,
  stations,
  user,
  route,
}: {
  account: FacilityAccount;
  stations: StationOption[];
  user: User;
  route?: {
    tab: "Room Booking" | "TV & Digital Signage";
    targetId?: string;
    nonce: number;
  } | null;
}) {
  const [activeTab, setActiveTab] = useState<ModuleTab>("Overview");
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [displayContents, setDisplayContents] = useState<DisplayContent[]>([]);
  const [displayChannels, setDisplayChannels] = useState<DisplayChannel[]>([]);
  const [displayOutputGroups, setDisplayOutputGroups] = useState<
    DisplayOutputGroup[]
  >([]);
  const [displaySchedules, setDisplaySchedules] = useState<DisplaySchedule[]>(
    [],
  );
  const [displayCommands, setDisplayCommands] = useState<DisplayCommand[]>([]);
  const [flights, setFlights] = useState<FlightReference[]>([]);
  const [announcementTemplates, setAnnouncementTemplates] = useState<
    AnnouncementTemplate[]
  >([]);
  const [displayAnnouncements, setDisplayAnnouncements] = useState<
    DisplayAnnouncement[]
  >([]);
  const [displayPilotTests, setDisplayPilotTests] = useState<
    DisplayPilotTest[]
  >([]);
  const [displayRollouts, setDisplayRollouts] = useState<
    DisplayRolloutApproval[]
  >([]);
  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [operations, setOperations] = useState<RoomOperation[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<RoomMaintenance[]>([]);
  const [incidents, setIncidents] = useState<RoomIncident[]>([]);
  const [roomActivities, setRoomActivities] = useState<RoomActivity[]>([]);
  const [stationFilter, setStationFilter] = useState(
    GLOBAL_ROLES.includes(account.role) ? "ALL" : account.station,
  );
  const [roomDraft, setRoomDraft] = useState(EMPTY_ROOM);
  const [roomFacilitiesInput, setRoomFacilitiesInput] = useState("");
  const [deviceDraft, setDeviceDraft] = useState(EMPTY_DEVICE);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bookingView, setBookingView] = useState<
    "Day" | "Week" | "Month" | "List"
  >("Month");
  const [bookingAnchor, setBookingAnchor] = useState(localToday());
  const [usageGrain, setUsageGrain] = useState<"Daily" | "Weekly" | "Monthly">(
    "Daily",
  );
  const [usageDateFrom, setUsageDateFrom] = useState(
    `${localToday().slice(0, 8)}01`,
  );
  const [usageDateTo, setUsageDateTo] = useState(localToday());
  const [bookingRoomFilter, setBookingRoomFilter] = useState("ALL");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("ALL");
  const [bookingDraft, setBookingDraft] = useState<BookingDraft>(EMPTY_BOOKING);
  const [bookingRequestId, setBookingRequestId] = useState("");
  const [editingBooking, setEditingBooking] = useState<string | null>(null);
  const [editingBookingStatus, setEditingBookingStatus] =
    useState<BookingStatus | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingDetail, setBookingDetail] = useState<RoomBooking | null>(null);
  const [savingBooking, setSavingBooking] = useState(false);
  const [operationDialog, setOperationDialog] =
    useState<OperationDialog | null>(null);
  const [operationForm, setOperationForm] =
    useState<OperationForm>(EMPTY_OPERATION);
  const [operationRequestId, setOperationRequestId] = useState("");
  const [savingOperation, setSavingOperation] = useState(false);
  const [activityQuery, setActivityQuery] = useState("");
  const [displaySection, setDisplaySection] = useState<
    | "Monitor"
    | "Output Groups"
    | "Schedules"
    | "Channels"
    | "Content Library"
    | "Pilot & Rollout"
  >("Monitor");
  const [contentDraft, setContentDraft] = useState(EMPTY_CONTENT);
  const [channelDraft, setChannelDraft] = useState(EMPTY_CHANNEL);
  const [scheduleDraft, setScheduleDraft] = useState(EMPTY_SCHEDULE);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [outputGroupDraft, setOutputGroupDraft] = useState(EMPTY_OUTPUT_GROUP);
  const [editingOutputGroup, setEditingOutputGroup] = useState<string | null>(
    null,
  );
  const [showOutputGroupForm, setShowOutputGroupForm] = useState(false);
  const [savingOutputGroup, setSavingOutputGroup] = useState(false);
  const [shareGroup, setShareGroup] = useState<DisplayOutputGroup | null>(null);
  const [shareSourceName, setShareSourceName] = useState("Operator Screen");
  const [shareSourceSelection, setShareSourceSelection] = useState("NEW");
  const [shareStarting, setShareStarting] = useState(false);
  const [activeShares, setActiveShares] = useState<
    Record<string, ActiveShareState>
  >({});
  const shareRuntimes = useRef<Map<string, ShareRuntime>>(new Map());
  const [displayDialog, setDisplayDialog] = useState<
    "content" | "channel" | "schedule" | null
  >(null);
  const [displayMediaFile, setDisplayMediaFile] = useState<File | null>(null);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [remoteDevice, setRemoteDevice] = useState<DeviceRecord | null>(null);
  const [remoteMode, setRemoteMode] = useState<"enroll" | "command">("command");
  const [remoteType, setRemoteType] = useState("PLAY_CHANNEL");
  const [remoteChannelId, setRemoteChannelId] = useState("");
  const [remoteOverlayText, setRemoteOverlayText] = useState("");
  const [remoteDuration, setRemoteDuration] = useState(60);
  const [enrollmentCode, setEnrollmentCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);
  const [showQuickAnnouncement, setShowQuickAnnouncement] = useState(false);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [announcementClock, setAnnouncementClock] = useState(0);
  const [quickAnnouncement, setQuickAnnouncement] =
    useState<QuickAnnouncementDraft>({
      station: account.station === "ALL" ? "CGK" : account.station,
      outputGroupId: "",
      templateId: "boarding",
      flightId: "",
      flightNumber: "",
      route: "",
      etd: "",
      oldGate: "",
      newGate: "",
      message: "",
      durationMinutes: 10,
      deviceIds: [],
    });
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [pilotDialog, setPilotDialog] = useState<{
    device: DeviceRecord;
    checkId: string;
  } | null>(null);
  const [pilotStatus, setPilotStatus] =
    useState<DisplayPilotTest["status"]>("Pass");
  const [pilotNote, setPilotNote] = useState("");
  const [savingPilot, setSavingPilot] = useState(false);
  const [pilotFeedback, setPilotFeedback] = useState<Notice | null>(null);
  const handledRouteNonce = useRef<number | null>(null);

  useEffect(() => {
    if (!route) return;
    const timer = window.setTimeout(() => setActiveTab(route.tab), 0);
    return () => window.clearTimeout(timer);
  }, [route]);

  useEffect(() => {
    if (
      !route?.targetId ||
      route.tab !== "Room Booking" ||
      handledRouteNonce.current === route.nonce
    )
      return;
    const booking = bookings.find((row) => row.id === route.targetId);
    if (!booking) return;
    handledRouteNonce.current = route.nonce;
    const timer = window.setTimeout(() => setBookingDetail(booking), 0);
    return () => window.clearTimeout(timer);
  }, [bookings, route]);

  const globalScope = GLOBAL_ROLES.includes(account.role);
  const canConfigure = CONFIG_ROLES.includes(account.role);
  const canControl = CONTROL_ROLES.includes(account.role);
  const activeShareKey = Object.keys(activeShares).sort().join("|");
  const permittedStation = useCallback(
    (value: string) => globalScope || value === account.station,
    [account.station, globalScope],
  );

  useEffect(() => {
    const updateClock = () => setAnnouncementClock(Date.now());
    const initial = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onError = (error: Error) =>
      setNotice({
        kind: "error",
        text: `Data fasilitas tidak dapat dimuat: ${error.message}`,
      });
    const stops = [
      subscribeStationCollection<RoomRecord>(
        "rooms",
        globalScope ? "ALL" : account.station,
        setRooms,
        onError,
      ),
      subscribeStationCollection<DeviceRecord>(
        "displayDevices",
        globalScope ? "ALL" : account.station,
        setDevices,
        onError,
      ),
      subscribeCollection<DisplayContent>(
        "displayContents",
        setDisplayContents,
        undefined,
        onError,
      ),
      subscribeCollection<DisplayChannel>(
        "displayChannels",
        setDisplayChannels,
        undefined,
        onError,
      ),
      subscribeStationCollection<DisplayOutputGroup>(
        "displayOutputGroups",
        globalScope ? "ALL" : account.station,
        setDisplayOutputGroups,
        onError,
      ),
      subscribeStationCollection<DisplaySchedule>(
        "displaySchedules",
        globalScope ? "ALL" : account.station,
        setDisplaySchedules,
        onError,
      ),
      subscribeStationCollection<DisplayCommand>(
        "displayCommands",
        globalScope ? "ALL" : account.station,
        setDisplayCommands,
        onError,
      ),
      subscribeCollection<FlightReference>(
        "flights",
        setFlights,
        undefined,
        onError,
      ),
      subscribeCollection<AnnouncementTemplate>(
        "displayAnnouncementTemplates",
        setAnnouncementTemplates,
        undefined,
        onError,
      ),
      subscribeStationCollection<DisplayAnnouncement>(
        "displayAnnouncements",
        globalScope ? "ALL" : account.station,
        setDisplayAnnouncements,
        onError,
      ),
      subscribeStationCollection<DisplayPilotTest>(
        "displayPilotTests",
        globalScope ? "ALL" : account.station,
        setDisplayPilotTests,
        onError,
      ),
      subscribeStationCollection<DisplayRolloutApproval>(
        "displayRolloutApprovals",
        globalScope ? "ALL" : account.station,
        setDisplayRollouts,
        onError,
      ),
      ["HO Admin", "Lounge Officer"].includes(account.role)
        ? () => undefined
        : subscribeStationCollection<RoomBooking>(
            "roomBookings",
            globalScope ? "ALL" : account.station,
            setBookings,
            onError,
          ),
      account.role === "HO Admin"
        ? () => undefined
        : subscribeStationCollection<RoomOperation>(
            "roomOperations",
            globalScope ? "ALL" : account.station,
            setOperations,
            onError,
          ),
      account.role === "HO Admin"
        ? () => undefined
        : subscribeStationCollection<RoomMaintenance>(
            "roomMaintenance",
            globalScope ? "ALL" : account.station,
            setMaintenanceRows,
            onError,
          ),
      account.role === "HO Admin"
        ? () => undefined
        : subscribeStationCollection<RoomIncident>(
            "roomIncidents",
            globalScope ? "ALL" : account.station,
            setIncidents,
            onError,
          ),
      account.role === "HO Admin"
        ? () => undefined
        : subscribeStationCollection<RoomActivity>(
            "roomActivityLogs",
            globalScope ? "ALL" : account.station,
            setRoomActivities,
            onError,
          ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [account.role, account.station, globalScope]);

  useEffect(() => {
    if (!["HO Admin", "Lounge Officer"].includes(account.role)) return;
    let disposed = false;
    const loadScopedBookings = async () => {
      try {
        const result = await manageRoomBooking(user, {
          action: "list",
          station: globalScope ? "ALL" : account.station,
        });
        if (!disposed)
          setBookings((result.bookings || []) as unknown as RoomBooking[]);
      } catch (error) {
        if (!disposed)
          setNotice({
            kind: "error",
            text:
              error instanceof Error
                ? error.message
                : "Data booking tidak dapat dimuat.",
          });
      }
    };
    void loadScopedBookings();
    const timer = window.setInterval(() => void loadScopedBookings(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [account.role, account.station, globalScope, user]);

  useEffect(() => {
    if (!activeShareKey) return;
    let polling = false;
    let disposed = false;

    const pollShareStatus = async () => {
      if (polling || disposed) return;
      polling = true;
      await Promise.all(
        [...shareRuntimes.current.entries()].map(
          async ([groupId, runtime]) => {
            try {
              const result = await manageDisplayDevice(user, {
                action: "sharestatus",
                sessionId: runtime.sessionId,
              });
              if (result.status !== "Sharing") {
                releaseShareRuntime(groupId);
                return;
              }
              await Promise.all(
                (result.devices || []).map(async (row) => {
                  const peer = runtime.peers.get(row.deviceId);
                  if (peer && row.answerSdp && !peer.currentRemoteDescription) {
                    await peer.setRemoteDescription(
                      JSON.parse(row.answerSdp) as RTCSessionDescriptionInit,
                    );
                  }
                  updateShareDeviceState(
                    groupId,
                    row.deviceId,
                    peer?.connectionState === "connected"
                      ? "connected"
                      : row.answerSdp
                        ? "connecting"
                        : row.status || "Waiting for Player",
                  );
                }),
              );
            } catch {
              [...runtime.peers.keys()].forEach((deviceId) =>
                updateShareDeviceState(groupId, deviceId, "Status retry"),
              );
            }
          },
        ),
      );
      polling = false;
    };

    const initial = window.setTimeout(() => void pollShareStatus(), 300);
    const timer = window.setInterval(() => void pollShareStatus(), 2000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [activeShareKey, user]);

  const scopedRooms = useMemo(
    () =>
      rooms.filter(
        (room) =>
          permittedStation(room.station) &&
          (stationFilter === "ALL" || room.station === stationFilter),
      ),
    [rooms, stationFilter, permittedStation],
  );
  const scopedDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          permittedStation(device.station) &&
          (stationFilter === "ALL" || device.station === stationFilter),
      ),
    [devices, stationFilter, permittedStation],
  );
  const scopedDisplayContents = useMemo(
    () =>
      displayContents
        .filter((row) => row.station === "ALL" || permittedStation(row.station))
        .filter(
          (row) =>
            stationFilter === "ALL" ||
            row.station === "ALL" ||
            row.station === stationFilter,
        ),
    [displayContents, permittedStation, stationFilter],
  );
  const scopedDisplaySchedules = useMemo(
    () =>
      displaySchedules.filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      ),
    [displaySchedules, permittedStation, stationFilter],
  );
  const scopedOutputGroups = useMemo(
    () =>
      displayOutputGroups.filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      ),
    [displayOutputGroups, permittedStation, stationFilter],
  );
  const scopedBookings = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            permittedStation(booking.station) &&
            (stationFilter === "ALL" || booking.station === stationFilter) &&
            (bookingRoomFilter === "ALL" ||
              booking.roomId === bookingRoomFilter) &&
            (bookingStatusFilter === "ALL" ||
              booking.status === bookingStatusFilter),
        )
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [
      bookings,
      bookingRoomFilter,
      bookingStatusFilter,
      permittedStation,
      stationFilter,
    ],
  );
  const scopedOperations = useMemo(
    () =>
      operations.filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      ),
    [operations, permittedStation, stationFilter],
  );
  const scopedMaintenance = useMemo(
    () =>
      maintenanceRows.filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      ),
    [maintenanceRows, permittedStation, stationFilter],
  );
  const scopedIncidents = useMemo(
    () =>
      incidents.filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      ),
    [incidents, permittedStation, stationFilter],
  );
  const scopedActivities = useMemo(() => {
    const query = activityQuery.trim().toLowerCase();
    return roomActivities
      .filter(
        (row) =>
          permittedStation(row.station) &&
          (stationFilter === "ALL" || row.station === stationFilter),
      )
      .filter(
        (row) =>
          !query ||
          `${row.action} ${row.actorName} ${row.roomId} ${row.bookingId || ""}`
            .toLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) => activityMillis(b.createdAt) - activityMillis(a.createdAt),
      );
  }, [activityQuery, permittedStation, roomActivities, stationFilter]);

  const usageBookings = useMemo(
    () =>
      scopedBookings.filter(
        (booking) =>
          booking.localDate >= usageDateFrom &&
          booking.localDate <= usageDateTo &&
          !["Draft", "Rejected", "Cancelled"].includes(booking.status),
      ),
    [scopedBookings, usageDateFrom, usageDateTo],
  );
  const usageAnalytics = useMemo(() => {
    const grouped = new Map<
      string,
      { bookings: number; plannedMinutes: number; actualMinutes: number }
    >();
    const roomTotals = new Map<string, number>();
    const hourTotals = Array.from({ length: 24 }, () => 0);
    usageBookings.forEach((booking) => {
      const key =
        usageGrain === "Monthly"
          ? booking.localDate.slice(0, 7)
          : usageGrain === "Weekly"
            ? dateValue(startOfWeek(booking.localDate))
            : booking.localDate;
      const plannedMinutes = Math.max(
        0,
        (Date.parse(booking.endAt) - Date.parse(booking.startAt)) / 60_000,
      );
      const operation = scopedOperations.find(
        (row) => row.bookingId === booking.id,
      );
      const checkedIn = activityMillis(
        operation?.checkedInAt || booking.checkedInAt,
      );
      const checkedOut = activityMillis(
        operation?.checkedOutAt || booking.checkedOutAt,
      );
      const actualMinutes =
        checkedIn && checkedOut && checkedOut > checkedIn
          ? (checkedOut - checkedIn) / 60_000
          : 0;
      const current = grouped.get(key) || {
        bookings: 0,
        plannedMinutes: 0,
        actualMinutes: 0,
      };
      current.bookings += 1;
      current.plannedMinutes += plannedMinutes;
      current.actualMinutes += actualMinutes;
      grouped.set(key, current);
      roomTotals.set(
        booking.roomName,
        (roomTotals.get(booking.roomName) || 0) + actualMinutes,
      );
      const hour = Number(booking.startTime.slice(0, 2));
      if (Number.isFinite(hour) && hour >= 0 && hour < 24)
        hourTotals[hour] += 1;
    });
    const series = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, ...value }));
    const rooms = [...roomTotals.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([label, minutes]) => ({ label, minutes }));
    const peakHour = hourTotals.reduce(
      (best, count, hour) =>
        count > best.count ? { hour, count } : best,
      { hour: 0, count: 0 },
    );
    return { series, rooms, hourTotals, peakHour };
  }, [scopedOperations, usageBookings, usageGrain]);
  const plannedUsageMinutes = usageAnalytics.series.reduce(
    (total, row) => total + row.plannedMinutes,
    0,
  );
  const actualUsageMinutes = usageAnalytics.series.reduce(
    (total, row) => total + row.actualMinutes,
    0,
  );
  const utilizationPercent = plannedUsageMinutes
    ? Math.round((actualUsageMinutes / plannedUsageMinutes) * 100)
    : 0;

  const activeStations = stations.filter((station) =>
    permittedStation(station.code),
  );
  const effectiveAnnouncementTemplates = DEFAULT_ANNOUNCEMENT_TEMPLATES.map(
    (fallback) => ({
      ...fallback,
      ...announcementTemplates.find((row) => row.id === fallback.id),
    }),
  );
  const activeAnnouncements = displayAnnouncements
    .filter(
      (row) =>
        row.status === "Active" &&
        activityMillis(row.expiresAt) > announcementClock &&
        (stationFilter === "ALL" || row.station === stationFilter),
    )
    .sort((a, b) => b.priority - a.priority);
  const roomName = (id: string) =>
    rooms.find((room) => room.id === id)?.name || "Belum dipetakan";
  const latestDisplayCommand = (deviceId: string) =>
    displayCommands
      .filter((row) => row.deviceId === deviceId)
      .sort(
        (a, b) => activityMillis(b.createdAt) - activityMillis(a.createdAt),
      )[0];
  const pilotResult = (deviceId: string, checkId: string) =>
    displayPilotTests.find(
      (row) => row.deviceId === deviceId && row.checkId === checkId,
    );
  const pilotRequiredPassed = (deviceId: string) =>
    DISPLAY_UAT_CHECKS.filter((check) => check.required).filter(
      (check) => pilotResult(deviceId, check.id)?.status === "Pass",
    ).length;
  const canApproveBooking = APPROVER_ROLES.includes(account.role);
  const canSuperviseOperations = APPROVER_ROLES.includes(account.role);
  const canCreateBooking = account.role !== "HO Admin";
  const canOperateRoom = account.role !== "HO Admin";
  const editingDeviceRecord = editingDevice
    ? devices.find((device) => device.id === editingDevice)
    : undefined;

  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure || !permittedStation(roomDraft.station)) return;
    if (!roomDraft.name.trim() || !roomDraft.area.trim()) {
      setNotice({ kind: "warn", text: "Nama room dan area wajib diisi." });
      return;
    }
    const id = editingRoom || recordId("room");
    const facilities = roomFacilitiesInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    await saveRecord("rooms", {
      id,
      ...roomDraft,
      facilities,
      capacity: Math.max(1, Number(roomDraft.capacity) || 1),
    });
    setNotice({
      kind: "ok",
      text: `Room ${roomDraft.name} berhasil disimpan.`,
    });
    setRoomDraft({
      ...EMPTY_ROOM,
      station: globalScope ? "CGK" : account.station,
    });
    setRoomFacilitiesInput("");
    setEditingRoom(null);
    setShowRoomForm(false);
  }

  async function saveDevice(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure || !permittedStation(deviceDraft.station)) return;
    if (!deviceDraft.name.trim()) {
      setNotice({ kind: "warn", text: "Nama device wajib diisi." });
      return;
    }
    const id = editingDevice || recordId("display");
    await saveRecord("displayDevices", {
      id,
      ...deviceDraft,
      approvalStatus: canonicalApprovalStatus(deviceDraft.approvalStatus),
    });
    setNotice({
      kind: "ok",
      text: `Device ${deviceDraft.name} berhasil disimpan sebagai inventory. Lanjutkan approval dan enrollment melalui TV & Digital Signage > Monitor.`,
    });
    setDeviceDraft({
      ...EMPTY_DEVICE,
      station: globalScope ? "CGK" : account.station,
    });
    setEditingDevice(null);
    setShowDeviceForm(false);
  }

  async function approveDevice(device: DeviceRecord) {
    if (!canConfigure || !permittedStation(device.station)) return;
    await saveRecord("displayDevices", {
      ...device,
      approvalStatus: "Approved",
      status: device.status === "Unregistered" ? "Offline" : device.status,
      approvedBy: account.name,
      approvedAt: new Date().toISOString(),
    });
    setNotice({
      kind: "ok",
      text: `${device.name} disetujui. Klik Enroll Player pada tab Monitor, buat kode, lalu masukkan kode tersebut di halaman /player pada perangkat.`,
    });
  }

  async function deleteDevice(device: DeviceRecord) {
    if (
      !window.confirm(
        `Hapus device ${device.name}? Enrollment dan credential player pada device ini juga akan dicabut.`,
      )
    )
      return;
    setDeletingDeviceId(device.id);
    try {
      await manageDisplayDevice(user, {
        action: "delete",
        deviceId: device.id,
      });
      setShowDeviceForm(false);
      setEditingDevice(null);
      setNotice({
        kind: "ok",
        text: `Device ${device.name} berhasil dihapus.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Device tidak dapat dihapus.",
      });
    } finally {
      setDeletingDeviceId(null);
    }
  }

  function openDisplayDialog(kind: "content" | "channel" | "schedule") {
    setDisplayMediaFile(null);
    if (kind === "content") {
      setEditingContent(null);
      setContentDraft({
        ...EMPTY_CONTENT,
        station: globalScope ? "ALL" : account.station,
      });
    } else if (kind === "channel") {
      setEditingChannel(null);
      setChannelDraft(EMPTY_CHANNEL);
    } else {
      const station =
        stationFilter !== "ALL"
          ? stationFilter
          : activeStations[0]?.code || account.station;
      setEditingSchedule(null);
      setScheduleDraft({
        ...EMPTY_SCHEDULE,
        station,
        channelId:
          displayChannels.find((row) => row.status === "Active")?.id || "",
      });
    }
    setDisplayDialog(kind);
  }

  async function saveDisplayItem(event: FormEvent) {
    event.preventDefault();
    if (!displayDialog) return;
    setSavingDisplay(true);
    try {
      if (displayDialog === "content") {
        const id = editingContent || recordId("display-content");
        let sourceUrl = contentDraft.sourceUrl.trim();
        let storagePath = contentDraft.storagePath || "";
        if (displayMediaFile) {
          const uploaded = await uploadDisplayMedia(
            contentDraft.station,
            id,
            displayMediaFile,
          );
          sourceUrl = uploaded.url;
          storagePath = uploaded.storagePath;
        }
        await manageDisplayContent(user, {
          action: "savecontent",
          ...contentDraft,
          id,
          sourceUrl,
          storagePath,
          requestId:
            globalThis.crypto?.randomUUID?.() || recordId("content-request"),
        });
      } else if (displayDialog === "channel") {
        await manageDisplayContent(user, {
          action: "savechannel",
          ...channelDraft,
          id: editingChannel || undefined,
          requestId:
            globalThis.crypto?.randomUUID?.() || recordId("channel-request"),
        });
      } else {
        await manageDisplayContent(user, {
          action: "saveschedule",
          ...scheduleDraft,
          id: editingSchedule || undefined,
          requestId:
            globalThis.crypto?.randomUUID?.() || recordId("schedule-request"),
        });
      }
      setNotice({
        kind: "ok",
        text: "Data TV & Digital Signage berhasil disimpan.",
      });
      setDisplayDialog(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Data display tidak dapat disimpan.",
      });
    } finally {
      setSavingDisplay(false);
    }
  }

  async function deleteDisplayItem(
    kind: "content" | "channel" | "schedule",
    id: string,
    label: string,
  ) {
    if (!window.confirm(`Hapus ${label}?`)) return;
    try {
      await manageDisplayContent(user, { action: "delete", kind, id });
      setNotice({ kind: "ok", text: `${label} berhasil dihapus.` });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Data display tidak dapat dihapus.",
      });
    }
  }

  function openOutputGroup(group?: DisplayOutputGroup) {
    if (group) {
      setEditingOutputGroup(group.id);
      setOutputGroupDraft({
        station: group.station,
        name: group.name,
        description: group.description || "",
        deviceIds: stringArray(group.deviceIds),
        status: group.status,
        sourceMode: group.sourceMode || "Managed Channel",
        sessionStatus: group.sessionStatus || "Idle",
        activeSourceName: group.activeSourceName || "",
        updatedAt: group.updatedAt,
      });
    } else {
      setEditingOutputGroup(null);
      setOutputGroupDraft({
        ...EMPTY_OUTPUT_GROUP,
        station:
          stationFilter !== "ALL"
            ? stationFilter
            : activeStations[0]?.code || account.station,
      });
    }
    setShowOutputGroupForm(true);
  }

  async function saveOutputGroup(event: FormEvent) {
    event.preventDefault();
    setSavingOutputGroup(true);
    try {
      await manageDisplayDevice(user, {
        action: "saveoutputgroup",
        id: editingOutputGroup || undefined,
        ...outputGroupDraft,
      });
      setNotice({
        kind: "ok",
        text: `Output Group ${outputGroupDraft.name} berhasil disimpan.`,
      });
      setShowOutputGroupForm(false);
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Output Group tidak dapat disimpan.",
      });
    } finally {
      setSavingOutputGroup(false);
    }
  }

  async function deleteOutputGroup(group: DisplayOutputGroup) {
    if (
      !window.confirm(
        `Hapus ${group.name}? Device tidak akan dihapus dari inventory.`,
      )
    )
      return;
    try {
      await manageDisplayDevice(user, {
        action: "deleteoutputgroup",
        id: group.id,
      });
      setNotice({ kind: "ok", text: `${group.name} berhasil dihapus.` });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Output Group tidak dapat dihapus.",
      });
    }
  }

  function updateShareDeviceState(
    groupId: string,
    deviceId: string,
    status: string,
  ) {
    setActiveShares((current) => {
      const share = current[groupId];
      if (!share) return current;
      return {
        ...current,
        [groupId]: {
          ...share,
          deviceStates: { ...share.deviceStates, [deviceId]: status },
        },
      };
    });
  }

  function releaseShareRuntime(groupId: string) {
    const runtime = shareRuntimes.current.get(groupId);
    if (!runtime) return;
    runtime.peers.forEach((peer) => peer.close());
    shareRuntimes.current.delete(groupId);
    const streamStillUsed = [...shareRuntimes.current.values()].some(
      (row) => row.stream === runtime.stream,
    );
    if (!streamStillUsed)
      runtime.stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    setActiveShares((current) => {
      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  async function stopOutputShare(groupId: string, quiet = false) {
    const runtime = shareRuntimes.current.get(groupId);
    if (!runtime) return;
    try {
      await manageDisplayDevice(user, {
        action: "stopsharesession",
        sessionId: runtime.sessionId,
      });
      if (!quiet)
        setNotice({
          kind: "ok",
          text: `Live screen share ${runtime.group.name} berhasil dihentikan.`,
        });
    } catch (error) {
      if (!quiet)
        setNotice({
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "Screen share tidak dapat dihentikan.",
        });
    } finally {
      releaseShareRuntime(groupId);
    }
  }

  async function stopAllOutputShares() {
    const groupIds = [...shareRuntimes.current.keys()];
    await Promise.all(groupIds.map((groupId) => stopOutputShare(groupId, true)));
    setNotice({ kind: "ok", text: "Semua live screen share dihentikan." });
  }

  function stopSharesUsingStream(stream: MediaStream) {
    const groupIds = [...shareRuntimes.current.entries()]
      .filter(([, runtime]) => runtime.stream === stream)
      .map(([groupId]) => groupId);
    void Promise.all(groupIds.map((groupId) => stopOutputShare(groupId, true)));
  }

  async function startOutputShare(event: FormEvent) {
    event.preventDefault();
    if (!shareGroup) return;
    const reusedRuntime =
      shareSourceSelection === "NEW"
        ? null
        : shareRuntimes.current.get(shareSourceSelection) || null;
    if (!reusedRuntime && !navigator.mediaDevices?.getDisplayMedia) {
      setNotice({
        kind: "error",
        text: "Browser ini tidak mendukung screen capture. Gunakan Chrome atau Edge melalui HTTPS.",
      });
      return;
    }
    setShareStarting(true);
    let capturedStream: MediaStream | null = null;
    let sessionId = "";
    try {
      capturedStream = reusedRuntime
        ? reusedRuntime.stream
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 24, max: 30 } },
            audio: true,
          });
      if (!capturedStream) throw new Error("Screen capture tidak tersedia.");
      const result = await manageDisplayDevice(user, {
        action: "startsharesession",
        outputGroupId: shareGroup.id,
        sourceName: reusedRuntime?.sourceName || shareSourceName,
      });
      sessionId = result.sessionId || result.id || "";
      if (!sessionId || !result.deviceIds?.length)
        throw new Error("Target Player untuk screen share tidak tersedia.");
      const peers = new Map<string, RTCPeerConnection>();
      const runtime: ShareRuntime = {
        group: shareGroup,
        sessionId,
        sourceName: reusedRuntime?.sourceName || shareSourceName,
        stream: capturedStream,
        peers,
      };
      shareRuntimes.current.set(shareGroup.id, runtime);
      setActiveShares((current) => ({
        ...current,
        [shareGroup.id]: {
          groupId: shareGroup.id,
          groupName: shareGroup.name,
          sessionId,
          sourceName: runtime.sourceName,
          deviceStates: Object.fromEntries(
            result.deviceIds?.map((id) => [id, "Creating offer"]) || [],
          ),
        },
      }));
      await Promise.all(
        result.deviceIds.map(async (deviceId) => {
          const peer = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          });
          peers.set(deviceId, peer);
          capturedStream?.getTracks().forEach((track) =>
            peer.addTrack(track, capturedStream as MediaStream),
          );
          peer.onconnectionstatechange = () =>
            updateShareDeviceState(
              shareGroup.id,
              deviceId,
              peer.connectionState,
            );
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await waitForPeerIce(peer);
          if (!peer.localDescription)
            throw new Error(`WebRTC offer gagal untuk ${deviceId}.`);
          await manageDisplayDevice(user, {
            action: "shareoffer",
            sessionId,
            deviceId,
            offerSdp: JSON.stringify(peer.localDescription),
          });
          updateShareDeviceState(
            shareGroup.id,
            deviceId,
            "Waiting for Player",
          );
        }),
      );
      const videoTrack = capturedStream.getVideoTracks()[0];
      if (videoTrack && !reusedRuntime)
        videoTrack.onended = () => stopSharesUsingStream(capturedStream!);
      setNotice({
        kind: "ok",
        text: `Screen share ${runtime.sourceName} dikirim ke ${result.deviceIds.length} Player pada ${shareGroup.name}.`,
      });
      setShareSourceSelection("NEW");
    } catch (error) {
      if (sessionId) {
        await manageDisplayDevice(user, {
          action: "stopsharesession",
          sessionId,
        }).catch(() => undefined);
      }
      if (shareGroup) releaseShareRuntime(shareGroup.id);
      if (capturedStream && !reusedRuntime)
        capturedStream.getTracks().forEach((track) => track.stop());
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Live screen share tidak dapat dimulai.",
      });
    } finally {
      setShareStarting(false);
    }
  }

  function openRemoteControl(device: DeviceRecord, mode: "enroll" | "command") {
    setRemoteDevice(device);
    setRemoteMode(mode);
    setEnrollmentCode(null);
    setRemoteType("PLAY_CHANNEL");
    setRemoteChannelId(
      displayChannels.find((row) => row.status === "Active")?.id || "",
    );
    setRemoteOverlayText("");
    setRemoteDuration(60);
  }

  function openQuickAnnouncementDialog() {
    const station =
      stationFilter !== "ALL"
        ? stationFilter
        : activeStations[0]?.code || account.station;
    const template =
      effectiveAnnouncementTemplates.find((row) => row.status === "Active") ||
      DEFAULT_ANNOUNCEMENT_TEMPLATES[0];
    setQuickAnnouncement({
      station,
      outputGroupId: "",
      templateId: template.id,
      flightId: "",
      flightNumber: "",
      route: "",
      etd: "",
      oldGate: "",
      newGate: "",
      message: "",
      durationMinutes: template.defaultDurationMinutes,
      deviceIds: devices
        .filter(
          (device) => device.station === station && isDeviceEnrolled(device),
        )
        .map((device) => device.id),
    });
    setShowQuickAnnouncement(true);
  }

  async function sendQuickAnnouncement(event: FormEvent) {
    event.preventDefault();
    setSavingAnnouncement(true);
    try {
      const result = await manageDisplayDevice(user, {
        action: "announce",
        ...quickAnnouncement,
      });
      setNotice({
        kind: "ok",
        text: `Quick announcement aktif sampai ${result.expiresAt ? new Date(result.expiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "durasi berakhir"}.`,
      });
      setShowQuickAnnouncement(false);
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Quick announcement tidak dapat dikirim.",
      });
    } finally {
      setSavingAnnouncement(false);
    }
  }

  async function clearQuickAnnouncements() {
    const targetStations =
      stationFilter !== "ALL"
        ? [stationFilter]
        : [...new Set(activeAnnouncements.map((row) => row.station))];
    if (
      !window.confirm(
        `Hentikan seluruh ${activeAnnouncements.length} running text aktif pada scope ini?`,
      )
    )
      return;
    try {
      await Promise.all(
        targetStations.map((station) =>
          manageDisplayDevice(user, {
            action: "clearannouncements",
            station,
          }),
        ),
      );
      setNotice({
        kind: "ok",
        text: "Running text aktif berhasil dihentikan.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Running text tidak dapat dihentikan.",
      });
    }
  }

  async function stopQuickAnnouncement(announcement: DisplayAnnouncement) {
    if (
      !window.confirm(
        `Hentikan running text “${announcement.templateName}” untuk ${announcement.flightNumber || announcement.station}?`,
      )
    )
      return;
    try {
      await manageDisplayDevice(user, {
        action: "stopannouncement",
        announcementId: announcement.id,
      });
      setNotice({
        kind: "ok",
        text: "Running text berhasil dihentikan tanpa memengaruhi announcement lain.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Running text tidak dapat dihentikan.",
      });
    }
  }

  async function editQuickAnnouncementDuration(
    announcement: DisplayAnnouncement,
  ) {
    const value = window.prompt(
      "Durasi baru dihitung dari sekarang (menit):",
      String(announcement.durationMinutes || 10),
    );
    if (value === null) return;
    const durationMinutes = Number(value);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setNotice({ kind: "error", text: "Durasi minimal 1 menit." });
      return;
    }
    try {
      await manageDisplayDevice(user, {
        action: "updateannouncementduration",
        announcementId: announcement.id,
        durationMinutes,
      });
      setNotice({
        kind: "ok",
        text: `Durasi ${announcement.templateName} diperbarui menjadi ${durationMinutes} menit dari sekarang.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Durasi running text tidak dapat diperbarui.",
      });
    }
  }

  function updateAnnouncementTemplate(
    id: string,
    changes: Partial<AnnouncementTemplate>,
  ) {
    setAnnouncementTemplates((rows) => {
      const base =
        rows.find((row) => row.id === id) ||
        effectiveAnnouncementTemplates.find((row) => row.id === id)!;
      const next = { ...base, ...changes };
      return rows.some((row) => row.id === id)
        ? rows.map((row) => (row.id === id ? next : row))
        : [...rows, next];
    });
  }

  async function saveAnnouncementTemplate(template: AnnouncementTemplate) {
    try {
      await manageDisplayDevice(user, {
        action: "savetemplate",
        templateId: template.id,
        ...template,
      });
      setNotice({
        kind: "ok",
        text: `Template ${template.name} berhasil disimpan.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Template tidak dapat disimpan.",
      });
    }
  }

  async function submitRemoteControl(event: FormEvent) {
    event.preventDefault();
    if (!remoteDevice) return;
    setSavingRemote(true);
    try {
      if (remoteMode === "enroll") {
        const result = await manageDisplayDevice(user, {
          action: "createenrollment",
          deviceId: remoteDevice.id,
        });
        if (result.code && result.expiresAt)
          setEnrollmentCode({ code: result.code, expiresAt: result.expiresAt });
        setNotice({
          kind: "ok",
          text: "Kode enrollment dibuat dan berlaku selama 10 menit.",
        });
      } else {
        const result = await manageDisplayDevice(user, {
          action: "command",
          deviceId: remoteDevice.id,
          type: remoteType,
          channelId: remoteChannelId,
          overlayText: remoteOverlayText,
          durationMinutes: remoteDuration,
        });
        setNotice({
          kind: "ok",
          text: `Command dikirim dengan status ${result.status}.`,
        });
        setRemoteDevice(null);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Remote command tidak dapat diproses.",
      });
    } finally {
      setSavingRemote(false);
    }
  }

  async function revokeDevice(device: DeviceRecord) {
    if (
      !window.confirm(
        `Cabut enrollment ${device.name}? Player akan terputus dan memerlukan kode baru.`,
      )
    )
      return;
    try {
      await manageDisplayDevice(user, {
        action: "revoke",
        deviceId: device.id,
      });
      setNotice({
        kind: "ok",
        text: `Enrollment ${device.name} berhasil dicabut.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Enrollment tidak dapat dicabut.",
      });
    }
  }

  function openPilotTest(device: DeviceRecord, checkId: string) {
    const existing = displayPilotTests.find(
      (row) => row.deviceId === device.id && row.checkId === checkId,
    );
    setPilotDialog({ device, checkId });
    setPilotFeedback(null);
    setPilotStatus(
      existing?.status ||
        (checkId === "native-screenshot" && device.capabilities?.browserPlayer
          ? "N/A"
          : "Pass"),
    );
    setPilotNote(existing?.note || "");
  }

  async function savePilotTest(event: FormEvent) {
    event.preventDefault();
    if (!pilotDialog) return;
    setSavingPilot(true);
    setPilotFeedback(null);
    try {
      await manageDisplayPilot(user, {
        action: "savetest",
        deviceId: pilotDialog.device.id,
        checkId: pilotDialog.checkId,
        status: pilotStatus,
        note: pilotNote,
      });
      setNotice({ kind: "ok", text: "Hasil Pilot UAT berhasil disimpan." });
      setPilotDialog(null);
    } catch (error) {
      setPilotFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Hasil Pilot UAT tidak dapat disimpan.",
      });
    } finally {
      setSavingPilot(false);
    }
  }

  async function certifyRollout(device: DeviceRecord) {
    const note =
      window.prompt("Catatan rollout certification (opsional):") ?? "";
    setSavingPilot(true);
    try {
      const result = await manageDisplayPilot(user, {
        action: "certify",
        deviceId: device.id,
        note,
      });
      setNotice({ kind: "ok", text: `${device.name}: ${result.status}.` });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Rollout certification gagal.",
      });
    } finally {
      setSavingPilot(false);
    }
  }

  function openNewBooking() {
    const defaultStation =
      stationFilter !== "ALL"
        ? stationFilter
        : activeStations[0]?.code || account.station;
    const firstRoom = rooms.find(
      (room) => room.station === defaultStation && room.status === "Active",
    );
    setEditingBooking(null);
    setEditingBookingStatus(null);
    setBookingRequestId(
      globalThis.crypto?.randomUUID?.() || recordId("booking-request"),
    );
    setBookingDraft({
      ...EMPTY_BOOKING,
      station: defaultStation,
      roomId: firstRoom?.id || "",
      organizer: account.name,
      localDate: bookingAnchor,
    });
    setShowBookingForm(true);
  }

  function editDraft(booking: RoomBooking) {
    setEditingBooking(booking.id);
    setEditingBookingStatus(booking.status);
    setBookingDraft({
      station: booking.station,
      roomId: booking.roomId,
      title: booking.title,
      purpose: booking.purpose || "",
      organizer: booking.organizer || account.name,
      contact: booking.contact || "",
      attendees: booking.attendees || 1,
      localDate: booking.localDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      bufferBeforeMinutes: booking.bufferBeforeMinutes || 0,
      bufferAfterMinutes: booking.bufferAfterMinutes || 0,
      recurrenceType: "None",
      recurrenceCount: 1,
      visitorReference: booking.visitorReference || "",
      notes: booking.notes || "",
    });
    setShowBookingForm(true);
  }

  async function saveBooking(submit: boolean) {
    const stationData = stations.find(
      (item) => item.code === bookingDraft.station,
    );
    if (
      !bookingDraft.roomId ||
      !bookingDraft.title.trim() ||
      !stationData?.timeZone
    ) {
      setNotice({
        kind: "warn",
        text: "Room, judul, dan timezone station wajib tersedia.",
      });
      return;
    }
    setSavingBooking(true);
    try {
      const booking = {
        ...bookingDraft,
        stationTimeZone: stationData.timeZone,
        startAt: localDateTimeToIso(
          bookingDraft.localDate,
          bookingDraft.startTime,
          stationData.timeZone,
        ),
        endAt: localDateTimeToIso(
          bookingDraft.localDate,
          bookingDraft.endTime,
          stationData.timeZone,
        ),
        submit,
        requestId: bookingRequestId,
      };
      let result = await manageRoomBooking(
        user,
        editingBooking
          ? { action: "update", id: editingBooking, booking }
          : { action: "create", booking },
      );
      if (editingBooking && submit && editingBookingStatus === "Draft") {
        result = await manageRoomBooking(user, {
          action: "submit",
          id: editingBooking,
        });
      }
      setNotice({
        kind: "ok",
        text: submit
          ? `Booking berhasil dikirim untuk approval (${result.status}).`
          : "Booking berhasil disimpan sebagai Draft.",
      });
      setShowBookingForm(false);
      setEditingBooking(null);
      setEditingBookingStatus(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Room booking tidak dapat disimpan.",
      });
    } finally {
      setSavingBooking(false);
    }
  }

  async function bookingAction(
    booking: RoomBooking,
    action: "submit" | "approve" | "reject" | "cancel",
  ) {
    const reason = ["reject", "cancel"].includes(action)
      ? window.prompt(
          action === "reject" ? "Alasan penolakan:" : "Alasan pembatalan:",
        )
      : "";
    if (["reject", "cancel"].includes(action) && reason === null) return;
    if (["reject", "cancel"].includes(action) && !reason?.trim()) {
      setNotice({
        kind: "warn",
        text: "Alasan penolakan atau pembatalan wajib diisi.",
      });
      return;
    }
    try {
      const result = await manageRoomBooking(user, {
        action,
        id: booking.id,
        reason: reason || "",
      });
      setNotice({
        kind: "ok",
        text: `Booking ${booking.title} berubah menjadi ${result.status}.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Status booking tidak dapat diubah.",
      });
    }
  }

  function openOperationDialog(
    type: OperationDialog["type"],
    booking?: RoomBooking,
    room?: RoomRecord,
  ) {
    const sourceRoom =
      room || rooms.find((item) => item.id === booking?.roomId);
    const firstTarget = rooms.find(
      (item) =>
        item.station === (booking?.station || sourceRoom?.station) &&
        item.id !== sourceRoom?.id &&
        item.status === "Active" &&
        !["Occupied", "Maintenance"].includes(item.operationalState),
    );
    setOperationRequestId(
      globalThis.crypto?.randomUUID?.() || recordId("room-operation"),
    );
    setOperationForm({
      ...EMPTY_OPERATION,
      targetRoomId: firstTarget?.id || "",
      handoverTo: account.name,
    });
    setOperationDialog({ type, booking, room: sourceRoom });
  }

  async function quickOperation(
    action: "noshow" | "endmaintenance",
    target: RoomBooking | RoomMaintenance,
  ) {
    const message =
      action === "noshow" ? "Alasan No Show:" : "Resolution maintenance:";
    const reason = window.prompt(message);
    if (!reason?.trim()) return;
    setSavingOperation(true);
    try {
      const result = await manageRoomOperation(
        user,
        action === "noshow"
          ? { action, bookingId: target.id, reason }
          : { action, maintenanceId: target.id, resolution: reason },
      );
      setNotice({
        kind: "ok",
        text: `Room operation berhasil: ${result.status}.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Room operation gagal diproses.",
      });
    } finally {
      setSavingOperation(false);
    }
  }

  async function submitRoomOperation() {
    if (!operationDialog) return;
    const { type, booking, room } = operationDialog;
    const common = booking ? { bookingId: booking.id } : {};
    let payload: Record<string, unknown>;
    if (type === "checkin") {
      payload = {
        action: "checkin",
        ...common,
        checklist: {
          clean: operationForm.clean,
          avReady: operationForm.avReady,
          amenitiesReady: operationForm.amenitiesReady,
          safetyChecked: operationForm.safetyChecked,
          tvReady: operationForm.tvReady,
        },
        readinessNote: operationForm.readinessNote,
        overrideReason: operationForm.overrideReason,
      };
    } else if (type === "checkout") {
      payload = {
        action: "checkout",
        ...common,
        handoverTo: operationForm.handoverTo,
        handoverNote: operationForm.handoverNote,
        issueSummary: operationForm.issueSummary,
      };
    } else if (type === "cleaning") {
      payload = {
        action: "completecleaning",
        ...common,
        cleaningChecklist: {
          clean: operationForm.cleaningClean,
          amenities: operationForm.cleaningAmenities,
          damageChecked: operationForm.cleaningDamageChecked,
        },
        cleaningNote: operationForm.cleaningNote,
      };
    } else if (type === "move") {
      payload = {
        action: "moveroom",
        ...common,
        targetRoomId: operationForm.targetRoomId,
        reason: operationForm.reason,
      };
    } else if (type === "maintenance") {
      payload = {
        action: "startmaintenance",
        roomId: room?.id,
        category: operationForm.category,
        reason: operationForm.reason,
        requestId: operationRequestId,
      };
    } else {
      payload = {
        action: "reportincident",
        roomId: room?.id || booking?.roomId,
        bookingId: booking?.id || "",
        category: operationForm.category,
        severity: operationForm.severity,
        description: operationForm.description,
        requestId: operationRequestId,
      };
    }
    setSavingOperation(true);
    try {
      const result = await manageRoomOperation(user, payload);
      setNotice({
        kind: "ok",
        text: `Room operation berhasil: ${result.status}.`,
      });
      setOperationDialog(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Room operation gagal diproses.",
      });
    } finally {
      setSavingOperation(false);
    }
  }

  function moveBookingAnchor(direction: -1 | 1) {
    const date = new Date(`${bookingAnchor}T00:00:00`);
    if (bookingView === "Day") date.setDate(date.getDate() + direction);
    else if (bookingView === "Week")
      date.setDate(date.getDate() + direction * 7);
    else date.setMonth(date.getMonth() + direction);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    setBookingAnchor(local.toISOString().slice(0, 10));
  }

  async function downloadFacilityReport(
    kind: "usage" | "rooms" | "displays",
  ) {
    const XLSX = await import("xlsx");
    const rows =
      kind === "usage"
        ? usageBookings.map((booking) => {
            const operation = scopedOperations.find(
              (row) => row.bookingId === booking.id,
            );
            const checkedIn = activityMillis(
              operation?.checkedInAt || booking.checkedInAt,
            );
            const checkedOut = activityMillis(
              operation?.checkedOutAt || booking.checkedOutAt,
            );
            return {
              Station: booking.station,
              Room: booking.roomName,
              Date: booking.localDate,
              Start: booking.startTime,
              End: booking.endTime,
              Status: booking.status,
              "Planned Minutes": Math.max(
                0,
                Math.round(
                  (Date.parse(booking.endAt) - Date.parse(booking.startAt)) /
                    60_000,
                ),
              ),
              "Actual Minutes":
                checkedIn && checkedOut && checkedOut > checkedIn
                  ? Math.round((checkedOut - checkedIn) / 60_000)
                  : 0,
              Organizer: booking.organizer,
              Purpose: booking.purpose,
              Attendees: booking.attendees,
            };
          })
        : kind === "rooms"
          ? scopedRooms.map((room) => ({
              Station: room.station,
              Room: room.name,
              Area: room.area,
              Type: room.roomType,
              Capacity: room.capacity,
              Facilities: room.facilities.join(", "),
              "Operational State": room.operationalState,
              Status: room.status,
            }))
          : scopedDevices.map((device) => ({
              Station: device.station,
              Device: device.name,
              Room: roomName(device.roomId),
              Platform: device.platform,
              Connection: device.connectionType,
              Status: playerOperationalStatus(device),
              Enrollment: device.enrollmentStatus || "Not Enrolled",
              "Now Playing": device.nowPlaying || "",
              "Playback Mode": device.playbackMode || "",
              "Cache Status": device.cacheStatus || "Not reported",
              "Cached Items": device.cachedContentCount || 0,
              "Last Heartbeat": readableHeartbeat(device.lastHeartbeat),
              "Rollout Status": device.rolloutStatus || "Testing",
            }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      kind === "usage"
        ? "Room Usage"
        : kind === "rooms"
          ? "Room Directory"
          : "TV Signage",
    );
    XLSX.writeFile(
      workbook,
      `GAES_${kind === "usage" ? "Room_Usage" : kind === "rooms" ? "Room_Directory" : "TV_Signage"}_${usageDateFrom}_${usageDateTo}.xlsx`,
    );
  }

  const tabs: ModuleTab[] = [
    "Overview",
    "Room Booking",
    "Room Operations",
    "TV & Digital Signage",
    "Master & Configuration",
    "Activity Log",
  ];
  const roomStates: RoomState[] = [
    "Available",
    "Reserved",
    "Occupied",
    "Cleaning",
    "Maintenance",
  ];
  const selectedActiveShare = shareGroup
    ? activeShares[shareGroup.id]
    : undefined;
  const selectedShareRuntime = shareGroup
    ? shareRuntimes.current.get(shareGroup.id)
    : undefined;

  return (
    <div className="facilityModule">
      <div className="title facilityTitle">
        <div>
          <p>FACILITY &amp; ROOM OPERATIONS</p>
          <h1>Facility &amp; Room Operations</h1>
          <span>
            Kesiapan ruangan, fondasi pemesanan, serta monitoring TV dan digital
            signage sesuai scope akun.
          </span>
        </div>
        <label className="facilityStationFilter">
          <span>Station</span>
          <select
            value={stationFilter}
            onChange={(event) => setStationFilter(event.target.value)}
            disabled={!globalScope}
          >
            {globalScope && <option value="ALL">All Stations</option>}
            {activeStations.map((station) => (
              <option key={station.code} value={station.code}>
                {station.code} — {station.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="subTabs facilityTabs"
        role="tablist"
        aria-label="Facility operations navigation"
      >
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={activeTab === item}
            className={activeTab === item ? "active" : ""}
            onClick={() => setActiveTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Tutup notifikasi"
          >
            ×
          </button>
        </div>
      )}

      {activeTab === "Overview" && (
        <>
          <div className="facilityKpis">
            <article>
              <span>Total Room</span>
              <strong>{scopedRooms.length}</strong>
              <small>
                {scopedRooms.filter((room) => room.status === "Active").length}{" "}
                active
              </small>
            </article>
            <article>
              <span>Available</span>
              <strong>
                {
                  scopedRooms.filter(
                    (room) => room.operationalState === "Available",
                  ).length
                }
              </strong>
              <small>Ready to use</small>
            </article>
            <article>
              <span>Occupied</span>
              <strong>
                {
                  scopedRooms.filter(
                    (room) => room.operationalState === "Occupied",
                  ).length
                }
              </strong>
              <small>In operation</small>
            </article>
            <article>
              <span>Cleaning / Maintenance</span>
              <strong>
                {
                  scopedRooms.filter((room) =>
                    ["Cleaning", "Maintenance"].includes(room.operationalState),
                  ).length
                }
              </strong>
              <small>Need attention</small>
            </article>
            <article>
              <span>Display Online</span>
              <strong>
                {scopedDevices.filter(isOnline).length}/{scopedDevices.length}
              </strong>
              <small>
                {
                  scopedDevices.filter(
                    (device) =>
                      canonicalApprovalStatus(device.approvalStatus) ===
                      "Pending",
                  ).length
                }{" "}
                pending approval
              </small>
            </article>
            <article>
              <span>{"Today's Booking"}</span>
              <strong>
                {
                  scopedBookings.filter(
                    (booking) =>
                      booking.localDate === localToday() &&
                      !["Rejected", "Cancelled"].includes(booking.status),
                  ).length
                }
              </strong>
              <small>Across visible rooms</small>
            </article>
            <article>
              <span>Actual Usage</span>
              <strong>{Math.round(actualUsageMinutes / 60)}h</strong>
              <small>{Math.round(plannedUsageMinutes / 60)}h planned</small>
            </article>
            <article>
              <span>Plan Realization</span>
              <strong>{utilizationPercent}%</strong>
              <small>Actual occupied vs planned</small>
            </article>
          </div>
          <div className="facilityAnalyticsToolbar card">
            <div className="bookingViewSwitch" role="tablist" aria-label="Usage aggregation">
              {(["Daily", "Weekly", "Monthly"] as const).map((grain) => (
                <button
                  key={grain}
                  type="button"
                  role="tab"
                  aria-selected={usageGrain === grain}
                  className={usageGrain === grain ? "active" : ""}
                  onClick={() => setUsageGrain(grain)}
                >
                  {grain}
                </button>
              ))}
            </div>
            <label>
              <span>From</span>
              <input type="date" value={usageDateFrom} onChange={(event) => setUsageDateFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={usageDateTo} onChange={(event) => setUsageDateTo(event.target.value)} />
            </label>
            <div className="facilityExportActions">
              <button type="button" onClick={() => void downloadFacilityReport("usage")}>Room Usage XLSX</button>
              <button type="button" onClick={() => void downloadFacilityReport("rooms")}>Room List XLSX</button>
              <button type="button" onClick={() => void downloadFacilityReport("displays")}>TV &amp; Signage XLSX</button>
            </div>
          </div>
          <div className="facilityOverviewGrid">
            <article className="card">
              <div className="cardHeading">
                <div>
                  <small>USAGE ANALYTICS</small>
                  <h2>Planned vs Actual Usage</h2>
                </div>
              </div>
              {!usageAnalytics.series.length ? (
                <EmptyState text="Belum ada data penggunaan pada periode ini." />
              ) : (
                <div className="facilityUsageChart">
                  {usageAnalytics.series.map((row) => {
                    const maximum = Math.max(
                      1,
                      ...usageAnalytics.series.map((item) => item.plannedMinutes),
                    );
                    return (
                      <div key={row.label}>
                        <span>{row.label}</span>
                        <div>
                          <i style={{ width: `${Math.max(2, (row.plannedMinutes / maximum) * 100)}%` }} />
                          <b style={{ width: `${Math.max(0, (row.actualMinutes / maximum) * 100)}%` }} />
                        </div>
                        <small>{Math.round(row.plannedMinutes / 60)}h plan · {Math.round(row.actualMinutes / 60)}h actual</small>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
            <article className="card">
              <div className="cardHeading">
                <div>
                  <small>ROOM CHARACTERISTICS</small>
                  <h2>Most Used Rooms &amp; Peak Hour</h2>
                </div>
              </div>
              {!usageAnalytics.rooms.length ? (
                <EmptyState text="Actual check-in/check-out belum tersedia pada periode ini." />
              ) : (
                <div className="facilityRoomRanking">
                  <div className="peakHourSummary">
                    <span>Peak booking start</span>
                    <strong>{String(usageAnalytics.peakHour.hour).padStart(2, "0")}:00</strong>
                    <small>{usageAnalytics.peakHour.count} booking</small>
                  </div>
                  {usageAnalytics.rooms.map((room, index) => (
                    <div key={room.label}>
                      <b>{index + 1}. {room.label}</b>
                      <span>{Math.round(room.minutes / 60)} actual hours</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      )}

      {activeTab === "Room Booking" && (
        <article className="card roomBookingCard">
          <div className="cardHeading facilityActionHeading">
            <div>
              <small>ROOM BOOKING</small>
              <h2>Booking Calendar</h2>
              <p>
                Booking yang diajukan langsung mengunci waktu room termasuk
                preparation dan cleaning buffer.
              </p>
            </div>
            {canCreateBooking && (
              <button className="primary" type="button" onClick={openNewBooking}>
                + New Booking
              </button>
            )}
          </div>

          <div className="bookingToolbar">
            <div
              className="bookingViewSwitch"
              role="tablist"
              aria-label="Calendar view"
            >
              {(["Day", "Week", "Month", "List"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={bookingView === view}
                  className={bookingView === view ? "active" : ""}
                  onClick={() => setBookingView(view)}
                >
                  {view}
                </button>
              ))}
            </div>
            <div className="bookingPeriodNav">
              <button
                type="button"
                onClick={() => moveBookingAnchor(-1)}
                aria-label="Previous period"
              >
                ‹
              </button>
              <input
                type="date"
                value={bookingAnchor}
                onChange={(event) => setBookingAnchor(event.target.value)}
              />
              <button
                type="button"
                onClick={() => moveBookingAnchor(1)}
                aria-label="Next period"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setBookingAnchor(localToday())}
              >
                Today
              </button>
            </div>
            <label>
              <span>Room</span>
              <select
                value={bookingRoomFilter}
                onChange={(event) => setBookingRoomFilter(event.target.value)}
              >
                <option value="ALL">All Rooms</option>
                {scopedRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={bookingStatusFilter}
                onChange={(event) => setBookingStatusFilter(event.target.value)}
              >
                <option value="ALL">All Status</option>
                {[
                  "Draft",
                  "Requested",
                  "Approved",
                  "Rejected",
                  "Cancelled",
                  "Checked-in",
                  "Completed",
                  "No Show",
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>

          <BookingCalendar
            view={bookingView}
            anchor={bookingAnchor}
            bookings={scopedBookings}
            currentUserId={account.id}
            canApprove={canApproveBooking}
            ownerCanCancel={account.role !== "Lounge Officer"}
            onOpen={setBookingDetail}
            onEdit={editDraft}
            onAction={(booking, action) => void bookingAction(booking, action)}
          />
        </article>
      )}

      {activeTab === "Room Operations" && (
        <div className="roomOperationsPage">
          <article className="card facilitySectionCard">
            <div className="facilitySectionHeader">
              <div>
                <small>LIVE ROOM OPERATIONS</small>
                <h2>Operational Control</h2>
                <p>
                  Check-in, check-out, cleaning turnaround, maintenance, and
                  incidents in one workflow.
                </p>
              </div>
              <div className="facilityHeaderActions">
                {canOperateRoom && (
                  <button
                    type="button"
                    onClick={() =>
                      openOperationDialog("incident", undefined, scopedRooms[0])
                    }
                    disabled={!scopedRooms.length}
                  >
                    Report Incident
                  </button>
                )}
                {canSuperviseOperations && (
                  <button
                    className="primary"
                    type="button"
                    onClick={() =>
                      openOperationDialog(
                        "maintenance",
                        undefined,
                        scopedRooms[0],
                      )
                    }
                    disabled={!scopedRooms.length}
                  >
                    Start Maintenance
                  </button>
                )}
              </div>
            </div>
            <div className="operationsKpis">
              <div>
                <span>Approved</span>
                <strong>
                  {
                    scopedBookings.filter((row) => row.status === "Approved")
                      .length
                  }
                </strong>
              </div>
              <div>
                <span>Occupied</span>
                <strong>
                  {
                    scopedRooms.filter(
                      (row) => row.operationalState === "Occupied",
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span>Cleaning</span>
                <strong>
                  {
                    scopedRooms.filter(
                      (row) => row.operationalState === "Cleaning",
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span>Maintenance</span>
                <strong>
                  {
                    scopedMaintenance.filter((row) => row.status === "Open")
                      .length
                  }
                </strong>
              </div>
              <div>
                <span>Open Incident</span>
                <strong>
                  {
                    scopedIncidents.filter((row) => row.status === "Open")
                      .length
                  }
                </strong>
              </div>
            </div>
          </article>

          <article className="card facilitySectionCard">
            <div className="facilitySectionHeader compact">
              <div>
                <small>BOOKING EXECUTION</small>
                <h2>Active Operations</h2>
              </div>
              <span className="scopeBadge">
                {stationFilter === "ALL" ? "All Stations" : stationFilter}
              </span>
            </div>
            <div className="tableWrap">
              <table className="facilityTable operationTable">
                <thead>
                  <tr>
                    <th>Schedule</th>
                    <th>Room</th>
                    <th>Booking</th>
                    <th>Status</th>
                    <th>Readiness / Handover</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedBookings.filter(
                    (booking) =>
                      ["Approved", "Checked-in"].includes(booking.status) ||
                      (booking.status === "Completed" &&
                        booking.localDate === localToday()),
                  ).length ? (
                    scopedBookings
                      .filter(
                        (booking) =>
                          ["Approved", "Checked-in"].includes(booking.status) ||
                          (booking.status === "Completed" &&
                            booking.localDate === localToday()),
                      )
                      .map((booking) => {
                        const operation = scopedOperations.find(
                          (row) => row.bookingId === booking.id,
                        );
                        return (
                          <tr key={booking.id}>
                            <td>
                              <b>{booking.localDate}</b>
                              <small>
                                {booking.startTime}–{booking.endTime}
                              </small>
                            </td>
                            <td>
                              <b>{booking.roomName}</b>
                              <small>{booking.station}</small>
                            </td>
                            <td>
                              <b>{booking.title}</b>
                              <small>
                                {booking.organizer} · {booking.attendees} pax
                              </small>
                            </td>
                            <td>
                              <span
                                className={`bookingStatus status-${booking.status.toLowerCase()}`}
                              >
                                {operation?.status || booking.status}
                              </span>
                            </td>
                            <td>
                              <small>
                                {operation?.checkedInByName
                                  ? `Check-in: ${operation.checkedInByName}`
                                  : "Awaiting readiness"}
                              </small>
                              <small>
                                {operation?.handoverTo
                                  ? `Handover: ${operation.handoverTo}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <div className="bookingActions">
                                {canOperateRoom && booking.status === "Approved" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openOperationDialog("checkin", booking)
                                    }
                                  >
                                    Check-in
                                  </button>
                                )}
                                {booking.status === "Approved" &&
                                  canSuperviseOperations && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openOperationDialog("move", booking)
                                      }
                                    >
                                      Move Room
                                    </button>
                                  )}
                                {booking.status === "Approved" &&
                                  canSuperviseOperations && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void quickOperation("noshow", booking)
                                      }
                                    >
                                      No Show
                                    </button>
                                  )}
                                {canOperateRoom && booking.status === "Checked-in" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openOperationDialog("checkout", booking)
                                    }
                                  >
                                    Check-out
                                  </button>
                                )}
                                {canOperateRoom && booking.status === "Checked-in" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openOperationDialog("incident", booking)
                                    }
                                  >
                                    Incident
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <div className="tableEmpty">
                          Belum ada booking aktif pada scope ini.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <div className="operationsColumns">
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>TURNAROUND</small>
                  <h2>Cleaning Queue</h2>
                </div>
              </div>
              <div className="operationQueue">
                {scopedOperations.filter((row) => row.status === "Cleaning")
                  .length ? (
                  scopedOperations
                    .filter((row) => row.status === "Cleaning")
                    .map((operation) => {
                      const booking = bookings.find(
                        (row) => row.id === operation.bookingId,
                      );
                      return (
                        <div key={operation.id}>
                          <span className="statusDot state-cleaning" />
                          <div>
                            <b>{operation.roomName}</b>
                            <small>
                              {operation.issueSummary ||
                                "Menunggu cleaning completion"}
                            </small>
                          </div>
                          {booking && (
                            <button
                              type="button"
                              onClick={() =>
                                openOperationDialog("cleaning", booking)
                              }
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      );
                    })
                ) : (
                  <EmptyState text="Tidak ada room dalam antrean cleaning." />
                )}
              </div>
            </article>
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>ROOM AVAILABILITY</small>
                  <h2>Open Maintenance</h2>
                </div>
              </div>
              <div className="operationQueue">
                {scopedMaintenance.filter((row) => row.status === "Open")
                  .length ? (
                  scopedMaintenance
                    .filter((row) => row.status === "Open")
                    .map((row) => (
                      <div key={row.id}>
                        <span className="statusDot state-maintenance" />
                        <div>
                          <b>{row.roomName}</b>
                          <small>
                            {row.category} · {row.reason}
                          </small>
                        </div>
                        {canSuperviseOperations && (
                          <button
                            type="button"
                            onClick={() =>
                              void quickOperation("endmaintenance", row)
                            }
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    ))
                ) : (
                  <EmptyState text="Tidak ada maintenance aktif." />
                )}
              </div>
            </article>
          </div>

          <article className="card facilitySectionCard">
            <div className="facilitySectionHeader compact">
              <div>
                <small>ISSUE CONTROL</small>
                <h2>Open Incidents</h2>
              </div>
              <span className="scopeBadge">
                {scopedIncidents.filter((row) => row.status === "Open").length}{" "}
                open
              </span>
            </div>
            <div className="incidentGrid">
              {scopedIncidents.filter((row) => row.status === "Open").length ? (
                scopedIncidents
                  .filter((row) => row.status === "Open")
                  .map((row) => (
                    <div
                      key={row.id}
                      className={`incidentCard severity-${row.severity.toLowerCase()}`}
                    >
                      <div>
                        <span>{row.severity}</span>
                        <small>{row.category}</small>
                      </div>
                      <b>{row.roomName}</b>
                      <p>{row.description}</p>
                      <small>
                        Reported by {row.reportedByName || "Operator"}
                      </small>
                    </div>
                  ))
              ) : (
                <EmptyState text="Tidak ada incident terbuka." />
              )}
            </div>
          </article>
        </div>
      )}

      {activeTab === "TV & Digital Signage" && (
        <div className="displayManagementPage">
          <article className="card facilitySectionCard">
            <div className="facilitySectionHeader">
              <div>
                <small>TV &amp; DIGITAL SIGNAGE</small>
                <h2>Content &amp; Schedule Management</h2>
                <p>
                  Manage scheduled playback, connected players, running text,
                  and remote commands per device.
                </p>
              </div>
              <div className="facilityHeaderActions">
                {displaySection === "Monitor" && canControl && (
                  <button
                    className="primary"
                    type="button"
                    onClick={openQuickAnnouncementDialog}
                  >
                    + Quick Announcement
                  </button>
                )}
                {displaySection === "Monitor" &&
                  canControl &&
                  activeAnnouncements.length > 0 && (
                    <button type="button" onClick={clearQuickAnnouncements}>
                      Clear Running Text
                    </button>
                  )}
                {displaySection === "Monitor" && canConfigure && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDevice(null);
                      setDeviceDraft({
                        ...EMPTY_DEVICE,
                        station: globalScope ? "CGK" : account.station,
                      });
                      setShowDeviceForm(true);
                    }}
                  >
                    + Add Device
                  </button>
                )}
                {displaySection === "Output Groups" && canConfigure && (
                  <button
                    className="primary"
                    type="button"
                    onClick={() => openOutputGroup()}
                  >
                    + New Output Group
                  </button>
                )}
                {displaySection === "Schedules" && canControl && (
                  <button
                    className="primary"
                    type="button"
                    onClick={() => openDisplayDialog("schedule")}
                  >
                    + New Schedule
                  </button>
                )}
                {displaySection === "Channels" && canConfigure && (
                  <button
                    className="primary"
                    type="button"
                    onClick={() => openDisplayDialog("channel")}
                  >
                    + New Channel
                  </button>
                )}
                {displaySection === "Content Library" && canConfigure && (
                  <button
                    className="primary"
                    type="button"
                    onClick={() => openDisplayDialog("content")}
                  >
                    + Add Content
                  </button>
                )}
              </div>
            </div>
            <div
              className="displaySubTabs"
              role="tablist"
              aria-label="TV content management"
            >
              {(
                [
                  { key: "Monitor", label: "Monitor" },
                  { key: "Output Groups", label: "Output Groups" },
                  { key: "Schedules", label: "Jadwal" },
                  { key: "Channels", label: "Channels" },
                  { key: "Content Library", label: "Content Library" },
                  {
                    key: "Pilot & Rollout",
                    label: "Testing & Activation",
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={displaySection === item.key}
                  className={displaySection === item.key ? "active" : ""}
                  onClick={() => setDisplaySection(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {displaySection === "Monitor" && (
              <section
                className="deviceEnrollmentGuide"
                aria-label="Device registration guide"
              >
                <div>
                  <small>DEVICE ONBOARDING</small>
                  <h3>Device Registration Guide</h3>
                  <p>
                    Lengkapi inventory, setujui, lalu hubungkan player
                    menggunakan kode sekali pakai.
                  </p>
                </div>
                <ol>
                  <li>
                    <span>1</span>
                    <b>Add and save device</b>
                  </li>
                  <li>
                    <span>2</span>
                    <b>Approve device inventory</b>
                  </li>
                  <li>
                    <span>3</span>
                    <b>Generate enrollment code</b>
                  </li>
                  <li>
                    <span>4</span>
                    <b>Open Player on device</b>
                  </li>
                  <li>
                    <span>5</span>
                    <b>Enter code within 10 minutes</b>
                  </li>
                  <li>
                    <span>6</span>
                    <b>Confirm Online status</b>
                  </li>
                </ol>
                <a href="/player" target="_blank" rel="noreferrer">
                  Open Player
                </a>
              </section>
            )}
          </article>

          {displaySection === "Monitor" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>DEVICE CONTROL CENTER</small>
                  <h2>Display Monitoring</h2>
                </div>
                <span className="scopeBadge">
                  {scopedDevices.filter(isOnline).length}/{scopedDevices.length}{" "}
                  online
                </span>
              </div>
              <div className="deviceHealthKpis">
                <div>
                  <span>Healthy</span>
                  <strong>
                    {
                      scopedDevices.filter(
                        (row) =>
                          row.healthStatus === "Healthy" || isOnline(row),
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>Degraded</span>
                  <strong>
                    {
                      scopedDevices.filter(
                        (row) => row.healthStatus === "Degraded",
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>Offline</span>
                  <strong>
                    {
                      scopedDevices.filter(
                        (row) =>
                          row.enrollmentStatus === "Enrolled" && !isOnline(row),
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>Not Enrolled</span>
                  <strong>
                    {
                      scopedDevices.filter(
                        (row) => row.enrollmentStatus !== "Enrolled",
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>Ready for Operations</span>
                  <strong>
                    {
                      scopedDevices.filter(
                        (row) => row.rolloutStatus === "Ready for Operations",
                      ).length
                    }
                  </strong>
                </div>
              </div>
              {scopedOutputGroups.length > 0 && (
                <section className="outputGroupMonitor">
                  <div>
                    <small>OUTPUT ROUTING</small>
                    <b>Configured Output Groups</b>
                  </div>
                  <div>
                    {scopedOutputGroups.map((group) => {
                      const groupDeviceIds = stringArray(group.deviceIds);
                      const online = devices.filter(
                        (device) =>
                          groupDeviceIds.includes(device.id) &&
                          isOnline(device),
                      ).length;
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => setDisplaySection("Output Groups")}
                        >
                          <b>{group.name}</b>
                          <span>
                            {online}/{groupDeviceIds.length} online ·{" "}
                            {group.sessionStatus || "Idle"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              <section className="announcementQueue" aria-live="polite">
                <div className="announcementQueueHeading">
                  <div>
                    <small>RUNNING TEXT QUEUE</small>
                    <h3>Active Announcements</h3>
                  </div>
                  <span className="scopeBadge">
                    {activeAnnouncements.length} active
                  </span>
                </div>
                {activeAnnouncements.length ? (
                  <div className="announcementQueueList">
                    {activeAnnouncements.map((announcement) => (
                      <div
                        className={`announcementQueueItem ${announcement.priority >= 100 ? "emergency" : ""}`}
                        key={announcement.id}
                      >
                        <div>
                          <span className="announcementPriority">
                            Priority {announcement.priority}
                          </span>
                          <b>{announcement.templateName}</b>
                          <p>{announcement.message}</p>
                        </div>
                        <div className="announcementQueueMeta">
                          <small>
                            {announcement.station} ·{" "}
                            {stringArray(announcement.deviceIds).length} screen
                            · until{" "}
                            {new Date(
                              activityMillis(announcement.expiresAt),
                            ).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                          <div>
                            {canConfigure && (
                              <button
                                type="button"
                                onClick={() =>
                                  void editQuickAnnouncementDuration(
                                    announcement,
                                  )
                                }
                              >
                                Edit Duration
                              </button>
                            )}
                            {canControl && (
                              <button
                                className="danger"
                                type="button"
                                onClick={() =>
                                  void stopQuickAnnouncement(announcement)
                                }
                              >
                                Stop
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="announcementQueueEmpty">
                    Tidak ada running text aktif. Pesan terjadwal tetap berjalan
                    sesuai jadwal layar.
                  </p>
                )}
              </section>
              {!scopedDevices.length ? (
                <EmptyState text="Belum ada device. Tambahkan inventory device lalu buat kode enrollment untuk menghubungkan player." />
              ) : (
                <div className="tableWrap">
                  <table className="facilityTable">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>Now Playing</th>
                        <th>Offline Cache</th>
                        <th>Running Text</th>
                        <th>Last Heartbeat</th>
                        <th>Last Command</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedDevices.map((device) => {
                        const lastCommand = latestDisplayCommand(device.id);
                        return (
                          <tr key={device.id}>
                            <td>
                              <b>{device.name}</b>
                              <small>
                                {device.platform} · {device.connectionType}
                              </small>
                            </td>
                            <td>
                              {device.station}
                              <small>{roomName(device.roomId)}</small>
                            </td>
                            <td>
                              <span
                                className={`deviceStatus ${playerStatusClass(device)}`}
                              >
                                {canonicalApprovalStatus(
                                  device.approvalStatus,
                                ) === "Pending"
                                  ? "Pending Approval"
                                  : playerOperationalStatus(device)}
                              </span>
                              <small>
                                {device.enrollmentStatus || "Not Enrolled"}
                                {device.visibilityState
                                  ? ` · ${device.visibilityState}`
                                  : ""}
                                {device.fullscreen === false
                                  ? " · Windowed"
                                  : device.fullscreen
                                    ? " · Fullscreen"
                                    : ""}
                                {device.lastError
                                  ? ` · ${device.lastError}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              {device.nowPlaying || "—"}
                              <small>
                                {device.playbackMode || "Unknown mode"}
                                {device.overrideUntil
                                  ? ` · Override until ${new Date(device.overrideUntil).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <b>{device.cacheStatus || "Not reported"}</b>
                              <small>
                                {device.cacheStatus === "Downloading"
                                  ? `${device.cacheProgress || 0}% · `
                                  : ""}
                                {device.cachedContentCount || 0} local item
                                {device.storageQuotaBytes
                                  ? ` · ${Math.round(((device.storageUsageBytes || 0) / device.storageQuotaBytes) * 100)}% storage`
                                  : ""}
                                {device.persistentStorage
                                  ? " · Persistent"
                                  : " · Best effort"}
                              </small>
                            </td>
                            <td>
                              {device.overlayText || "—"}
                              {device.activeAnnouncementId && (
                                <small>Quick announcement active</small>
                              )}
                            </td>
                            <td>{readableHeartbeat(device.lastHeartbeat)}</td>
                            <td>
                              {lastCommand ? (
                                <>
                                  <b>{lastCommand.type}</b>
                                  <small>
                                    {lastCommand.status}
                                    {lastCommand.message
                                      ? ` · ${lastCommand.message}`
                                      : ""}
                                  </small>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <div className="tableActions">
                                {canConfigure &&
                                  canonicalApprovalStatus(
                                    device.approvalStatus,
                                  ) === "Pending" && (
                                    <button
                                      type="button"
                                      onClick={() => void approveDevice(device)}
                                    >
                                      Approve
                                    </button>
                                  )}
                                {canConfigure && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingDevice(device.id);
                                      setDeviceDraft({
                                        ...device,
                                        approvalStatus: canonicalApprovalStatus(
                                          device.approvalStatus,
                                        ),
                                      });
                                      setShowDeviceForm(true);
                                    }}
                                  >
                                    Edit
                                  </button>
                                )}
                                {canControl &&
                                  isDeviceApproved(device) &&
                                  !isDeviceEnrolled(device) && (
                                    <button
                                      className="primary"
                                      type="button"
                                      onClick={() =>
                                        openRemoteControl(device, "enroll")
                                      }
                                    >
                                      Enroll Player
                                    </button>
                                  )}
                                {canControl && isDeviceEnrolled(device) && (
                                  <button
                                    className="primary"
                                    type="button"
                                    onClick={() =>
                                      openRemoteControl(device, "command")
                                    }
                                  >
                                    Remote Control
                                  </button>
                                )}
                                {canControl && isDeviceEnrolled(device) && (
                                  <button
                                    type="button"
                                    disabled={!device.capabilities?.screenshot}
                                    title={
                                      device.capabilities?.screenshot
                                        ? "Request player screenshot"
                                        : "Browser player tidak mendukung unattended screenshot"
                                    }
                                    onClick={() => {
                                      setRemoteDevice(device);
                                      setRemoteMode("command");
                                      setRemoteType("REQUEST_SCREENSHOT");
                                    }}
                                  >
                                    Screenshot
                                  </button>
                                )}
                                {canControl && isDeviceEnrolled(device) && (
                                  <button
                                    type="button"
                                    onClick={() => void revokeDevice(device)}
                                  >
                                    Revoke
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}

          {displaySection === "Output Groups" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader">
                <div>
                  <small>SCREEN OUTPUT ROUTING</small>
                  <h2>Output Groups</h2>
                  <p>
                    Kelompokkan beberapa display menjadi satu tujuan output.
                    Tahap berikutnya, satu screen share dapat dikirim ke seluruh
                    device di dalam group tanpa menghilangkan running text.
                  </p>
                </div>
                <span className="scopeBadge">
                  {scopedOutputGroups.length} group
                </span>
              </div>
              {Object.values(activeShares).length > 0 && (
                <section className="activeShareDock">
                  <div className="activeShareDockHead">
                    <div>
                      <small>ACTIVE OUTPUT SESSIONS</small>
                      <b>{Object.values(activeShares).length} live session</b>
                    </div>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => void stopAllOutputShares()}
                    >
                      Stop All
                    </button>
                  </div>
                  <div className="activeShareDockList">
                    {Object.values(activeShares).map((share) => (
                      <div key={share.groupId}>
                        <span className="statusDot state-available" />
                        <button
                          type="button"
                          onClick={() => {
                            const group = displayOutputGroups.find(
                              (row) => row.id === share.groupId,
                            );
                            if (group) setShareGroup(group);
                          }}
                        >
                          <b>{share.groupName}</b>
                          <small>{share.sourceName}</small>
                        </button>
                        <button
                          className="danger"
                          type="button"
                          onClick={() => void stopOutputShare(share.groupId)}
                        >
                          Stop
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {scopedOutputGroups.length ? (
                <div className="outputGroupGrid">
                  {scopedOutputGroups.map((group) => {
                    const groupDevices = stringArray(group.deviceIds)
                      .map((id) => devices.find((device) => device.id === id))
                      .filter((device): device is DeviceRecord =>
                        Boolean(device),
                      );
                    const onlineCount = groupDevices.filter(isOnline).length;
                    return (
                      <section className="outputGroupCard" key={group.id}>
                        <header>
                          <div>
                            <span
                              className={`statusDot state-${group.sessionStatus === "Sharing" ? "available" : "reserved"}`}
                            />
                            <div>
                              <h3>{group.name}</h3>
                              <small>
                                {group.station} · {group.status}
                              </small>
                            </div>
                          </div>
                          <span className="scopeBadge">
                            {group.sessionStatus || "Idle"}
                          </span>
                        </header>
                        <p>{group.description || "No description."}</p>
                        <div className="outputGroupSummary">
                          <div>
                            <span>Devices</span>
                            <b>{groupDevices.length}</b>
                          </div>
                          <div>
                            <span>Online</span>
                            <b>{onlineCount}</b>
                          </div>
                          <div>
                            <span>Source</span>
                            <b>{group.activeSourceName || "Not sharing"}</b>
                          </div>
                          <div>
                            <span>Mode</span>
                            <b>{group.sourceMode || "Managed Channel"}</b>
                          </div>
                        </div>
                        <div className="outputGroupDevices">
                          {groupDevices.length ? (
                            groupDevices.map((device) => (
                              <span key={device.id}>
                                <i
                                  className={`deviceStatusDot ${isOnline(device) ? "online" : "offline"}`}
                                />
                                {device.name} · {roomName(device.roomId)}
                              </span>
                            ))
                          ) : (
                            <small>No device assigned.</small>
                          )}
                        </div>
                        <footer>
                          <button
                            className="primary"
                            type="button"
                            disabled={
                              !canControl ||
                              group.status !== "Active" ||
                              groupDevices.length === 0
                            }
                            title={
                              group.sessionStatus === "Sharing" &&
                              !activeShares[group.id]
                                ? "Buka kontrol; sesi tanpa heartbeat dapat diambil alih setelah 30 detik"
                                : "Bagikan tab, jendela, atau layar ke semua Player di group"
                            }
                            onClick={() => {
                              setShareGroup(group);
                              setShareSourceName(
                                group.activeSourceName || "Operator Screen",
                              );
                              setShareSourceSelection("NEW");
                            }}
                          >
                            {activeShares[group.id]
                              ? "Open Share Control"
                              : group.sessionStatus === "Sharing"
                                ? "View / Recover Share"
                                : "Start Screen Share"}
                          </button>
                          {canConfigure && (
                            <>
                              <button
                                type="button"
                                onClick={() => openOutputGroup(group)}
                              >
                                Edit
                              </button>
                              <button
                                className="danger"
                                type="button"
                                onClick={() => void deleteOutputGroup(group)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </footer>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="Belum ada Output Group. Buat Output A, B, atau C lalu pilih device yang akan menerima sumber layar yang sama." />
              )}
            </article>
          )}

          {displaySection === "Schedules" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>PROGRAM GRID</small>
                  <h2>Display Schedules</h2>
                </div>
                <span className="scopeBadge">
                  {
                    scopedDisplaySchedules.filter(
                      (row) => row.status === "Active",
                    ).length
                  }{" "}
                  active
                </span>
              </div>
              <div className="tableWrap">
                <table className="facilityTable">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>Station</th>
                      <th>Channel</th>
                      <th>Date &amp; Time</th>
                      <th>Devices</th>
                      <th>Overlay</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedDisplaySchedules.length ? (
                      scopedDisplaySchedules.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <b>{row.title}</b>
                            <small>
                              {row.priority} · {row.status}
                            </small>
                          </td>
                          <td>{row.station}</td>
                          <td>{row.channelName}</td>
                          <td>
                            {row.startDate} — {row.endDate}
                            <small>
                              {row.startTime}–{row.endTime} ·{" "}
                              {numberArray(row.daysOfWeek)
                                .map(dayLabel)
                                .join(", ") || "—"}
                            </small>
                          </td>
                          <td>{stringArray(row.deviceIds).length} device</td>
                          <td>
                            {row.overlayEnabled
                              ? row.overlayText || "Enabled"
                              : "Off"}
                          </td>
                          <td>
                            <div className="tableActions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSchedule(row.id);
                                  setScheduleDraft({
                                    ...row,
                                    deviceIds: stringArray(row.deviceIds),
                                    daysOfWeek: numberArray(row.daysOfWeek),
                                  });
                                  setDisplayDialog("schedule");
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void deleteDisplayItem(
                                    "schedule",
                                    row.id,
                                    row.title,
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7}>
                          <div className="tableEmpty">
                            Belum ada schedule pada scope ini.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {displaySection === "Channels" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>PLAYLIST BUILDER</small>
                  <h2>Channels</h2>
                </div>
                <span className="scopeBadge">
                  {displayChannels.length} channel
                </span>
              </div>
              <div className="contentCardGrid">
                {displayChannels.length ? (
                  displayChannels.map((row) => (
                    <div className="contentCard" key={row.id}>
                      <div>
                        <span className="bookingStatus">{row.status}</span>
                        <small>
                          {stringArray(row.contentIds).length} content
                        </small>
                      </div>
                      <h3>{row.name}</h3>
                      <p>{row.description || "No description"}</p>
                      <ol>
                        {stringArray(row.contentIds).map((id) => (
                          <li key={id}>
                            {displayContents.find(
                              (content) => content.id === id,
                            )?.title || "Content unavailable"}
                          </li>
                        ))}
                      </ol>
                      {canConfigure && (
                        <div className="contentCardActions">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingChannel(row.id);
                              setChannelDraft({
                                ...row,
                                contentIds: stringArray(row.contentIds),
                              });
                              setDisplayDialog("channel");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void deleteDisplayItem(
                                "channel",
                                row.id,
                                row.name,
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyState text="Belum ada channel. Tambahkan content terlebih dahulu lalu susun urutannya dalam channel." />
                )}
              </div>
            </article>
          )}

          {displaySection === "Content Library" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>MEDIA SOURCE</small>
                  <h2>Content Library</h2>
                </div>
                <span className="scopeBadge">
                  {scopedDisplayContents.length} content
                </span>
              </div>
              <div className="contentCardGrid">
                {scopedDisplayContents.length ? (
                  scopedDisplayContents.map((row) => (
                    <div className="contentCard" key={row.id}>
                      <div>
                        <span className="bookingStatus">{row.contentType}</span>
                        <small>
                          {row.station === "ALL" ? "All Stations" : row.station}
                        </small>
                      </div>
                      <h3>{row.title}</h3>
                      <p>{row.description || row.sourceUrl}</p>
                      <small>
                        {row.durationSeconds
                          ? `${row.durationSeconds} seconds`
                          : "Continuous source"}{" "}
                        · {row.status}
                      </small>
                      {canConfigure && (
                        <div className="contentCardActions">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingContent(row.id);
                              setContentDraft(row);
                              setDisplayMediaFile(null);
                              setDisplayDialog("content");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void deleteDisplayItem(
                                "content",
                                row.id,
                                row.title,
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyState text="Belum ada content. Tambahkan Live TV, video, image, atau web URL." />
                )}
              </div>
            </article>
          )}

          {displaySection === "Pilot & Rollout" && (
            <article className="card facilitySectionCard">
              <div className="facilitySectionHeader">
                <div>
                  <small>DEVICE READINESS</small>
                  <h2>Device Testing &amp; Activation</h2>
                  <p>
                    Complete the required device checks before activating the
                    screen for daily operations.
                  </p>
                </div>
                <span className="scopeBadge">
                  {
                    scopedDevices.filter(
                      (row) => row.rolloutStatus === "Ready for Operations",
                    ).length
                  }
                  /{scopedDevices.length} ready
                </span>
              </div>
              <div className="pilotDeviceList">
                {scopedDevices.length ? (
                  scopedDevices.map((device) => {
                    const passed = pilotRequiredPassed(device.id);
                    const approval = displayRollouts.find(
                      (row) => row.deviceId === device.id,
                    );
                    return (
                      <section className="pilotDeviceCard" key={device.id}>
                        <header>
                          <div>
                            <span
                              className={`statusDot state-${isOnline(device) ? "available" : "maintenance"}`}
                            />
                            <div>
                              <h3>{device.name}</h3>
                              <small>
                                {device.station} · {roomName(device.roomId)} ·{" "}
                                {device.platform}
                              </small>
                            </div>
                          </div>
                          <span
                            className={`rolloutBadge ${device.rolloutStatus === "Ready for Operations" ? "ready" : "testing"}`}
                          >
                            {device.rolloutStatus || "Testing"}
                          </span>
                        </header>
                        <div className="pilotProgress">
                          <progress value={passed} max={12}>
                            {passed}/12
                          </progress>
                          <b>{passed}/12 required checks passed</b>
                        </div>
                        <div className="pilotChecklist">
                          {DISPLAY_UAT_CHECKS.map((check) => {
                            const result = pilotResult(device.id, check.id);
                            return (
                              <button
                                type="button"
                                key={check.id}
                                onClick={() => openPilotTest(device, check.id)}
                              >
                                <span
                                  className={`pilotStatus status-${(result?.status || "Not Tested").toLowerCase().replaceAll(" ", "-").replace("/", "")}`}
                                >
                                  {result?.status || "Not Tested"}
                                </span>
                                <b>{check.label}</b>
                                <small>
                                  {check.required ? "Required" : "Optional"}
                                  {result?.testedByName
                                    ? ` · ${result.testedByName}`
                                    : ""}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                        <footer>
                          <small>
                            {approval
                              ? `Activated by ${approval.certifiedByName || "Approver"} · ${formatActivityTime(approval.certifiedAt)}`
                              : "The device is not yet activated for operations."}
                          </small>
                          {canSuperviseOperations && (
                            <button
                              className="primary"
                              type="button"
                              disabled={
                                savingPilot ||
                                passed < 12 ||
                                device.enrollmentStatus !== "Enrolled"
                              }
                              onClick={() => void certifyRollout(device)}
                            >
                              Activate for Operations
                            </button>
                          )}
                        </footer>
                      </section>
                    );
                  })
                ) : (
                  <EmptyState text="Belum ada display device untuk diuji." />
                )}
              </div>
            </article>
          )}
        </div>
      )}

      {activeTab === "Master & Configuration" && (
        <article className="card">
          <div className="cardHeading facilityActionHeading">
            <div>
              <small>ROOM &amp; DEVICE INVENTORY</small>
              <h2>Master Configuration</h2>
              <p>
                Configuration changes are limited to authorized HO
                administrators.
              </p>
            </div>
            {canConfigure && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingRoom(null);
                    setRoomDraft({
                      ...EMPTY_ROOM,
                      station: globalScope ? "CGK" : account.station,
                    });
                    setRoomFacilitiesInput("");
                    setShowRoomForm(true);
                  }}
                >
                  + Add Room
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingDevice(null);
                    setDeviceDraft({
                      ...EMPTY_DEVICE,
                      station: globalScope ? "CGK" : account.station,
                    });
                    setShowDeviceForm(true);
                  }}
                >
                  + Add Device
                </button>
              </div>
            )}
          </div>
          <div className="tableWrap">
            <table className="facilityTable">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Station / Area</th>
                  <th>Type</th>
                  <th>Capacity</th>
                  <th>Facilities</th>
                  <th>Operational State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {scopedRooms.length ? (
                  scopedRooms.map((room) => (
                    <tr key={room.id}>
                      <td>
                        <b>{room.name}</b>
                        <small>{room.status}</small>
                      </td>
                      <td>
                        {room.station}
                        <small>{room.area}</small>
                      </td>
                      <td>{room.roomType}</td>
                      <td>{room.capacity}</td>
                      <td>{room.facilities.join(", ") || "—"}</td>
                      <td>{room.operationalState}</td>
                      <td>
                        <div className="tableActions">
                          {canConfigure && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRoom(room.id);
                                  setRoomDraft(room);
                                  setRoomFacilitiesInput(
                                    room.facilities.join(", "),
                                  );
                                  setShowRoomForm(true);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(`Hapus room ${room.name}?`)
                                  )
                                    void removeRecord("rooms", room.id);
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>Belum ada room pada scope ini.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="facilitySectionHeader compact masterDeviceHeading">
            <div>
              <small>DISPLAY PLAYER INVENTORY</small>
              <h2>Registered Devices</h2>
              <p>
                Approve and enroll each display player from the same
                configuration page.
              </p>
            </div>
            <span className="scopeBadge">{scopedDevices.length} device</span>
          </div>
          <div className="tableWrap">
            <table className="facilityTable">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Station / Room</th>
                  <th>Approval</th>
                  <th>Enrollment</th>
                  <th>Connection</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {scopedDevices.length ? (
                  scopedDevices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <b>{device.name}</b>
                        <small>{device.platform}</small>
                      </td>
                      <td>
                        {device.station}
                        <small>{roomName(device.roomId)}</small>
                      </td>
                      <td>{canonicalApprovalStatus(device.approvalStatus)}</td>
                      <td>{device.enrollmentStatus || "Not Enrolled"}</td>
                      <td>
                        {device.connectionType}
                        <small>{device.status}</small>
                      </td>
                      <td>
                        <div className="tableActions">
                          {canConfigure &&
                            canonicalApprovalStatus(device.approvalStatus) ===
                              "Pending" && (
                              <button
                                type="button"
                                onClick={() => void approveDevice(device)}
                              >
                                Approve
                              </button>
                            )}
                          {canConfigure && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingDevice(device.id);
                                setDeviceDraft({
                                  ...device,
                                  approvalStatus: canonicalApprovalStatus(
                                    device.approvalStatus,
                                  ),
                                });
                                setShowDeviceForm(true);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {canConfigure && (
                            <button
                              className="danger"
                              type="button"
                              disabled={deletingDeviceId === device.id}
                              onClick={() => void deleteDevice(device)}
                            >
                              {deletingDeviceId === device.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          )}
                          {canControl &&
                            isDeviceApproved(device) &&
                            !isDeviceEnrolled(device) && (
                              <button
                                className="primary"
                                type="button"
                                onClick={() =>
                                  openRemoteControl(device, "enroll")
                                }
                              >
                                Enroll Player
                              </button>
                            )}
                          {canControl && isDeviceEnrolled(device) && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab("TV & Digital Signage");
                                setDisplaySection("Monitor");
                              }}
                            >
                              Open Monitor
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      Belum ada display device pada scope ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canConfigure && (
            <section className="announcementTemplateConfig">
              <div className="facilitySectionHeader compact">
                <div>
                  <small>OPERATOR QUICK ACTIONS</small>
                  <h2>Quick Announcement Templates</h2>
                  <p>
                    Atur teks, durasi, prioritas, dan jumlah pengulangan yang
                    dipakai petugas lounge. Priority 100 ditampilkan eksklusif.
                  </p>
                </div>
              </div>
              <div className="tableWrap">
                <table className="facilityTable announcementTemplateTable">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Message Format</th>
                      <th>Duration</th>
                      <th>Priority</th>
                      <th>Repeat</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveAnnouncementTemplates.map((template) => (
                      <tr key={template.id}>
                        <td>
                          <b>{template.name}</b>
                          <small>{template.id}</small>
                        </td>
                        <td>
                          <input
                            aria-label={`${template.name} message format`}
                            value={template.messageTemplate}
                            onChange={(event) =>
                              updateAnnouncementTemplate(template.id, {
                                messageTemplate: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${template.name} duration minutes`}
                            type="number"
                            min="1"
                            max="480"
                            value={template.defaultDurationMinutes}
                            onChange={(event) =>
                              updateAnnouncementTemplate(template.id, {
                                defaultDurationMinutes: Number(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                          <small>minutes</small>
                        </td>
                        <td>
                          <input
                            aria-label={`${template.name} priority`}
                            type="number"
                            min="1"
                            max="100"
                            value={template.priority}
                            onChange={(event) =>
                              updateAnnouncementTemplate(template.id, {
                                priority: Number(event.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${template.name} repeat count`}
                            type="number"
                            min="1"
                            max="5"
                            value={template.repeatCount}
                            onChange={(event) =>
                              updateAnnouncementTemplate(template.id, {
                                repeatCount: Number(event.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`${template.name} status`}
                            value={template.status}
                            onChange={(event) =>
                              updateAnnouncementTemplate(template.id, {
                                status: event.target.value as
                                  "Active" | "Inactive",
                              })
                            }
                          >
                            <option>Active</option>
                            <option>Inactive</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              void saveAnnouncementTemplate(template)
                            }
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </article>
      )}

      {activeTab === "Activity Log" && (
        <article className="card facilitySectionCard">
          <div className="facilitySectionHeader">
            <div>
              <small>AUDIT TRAIL</small>
              <h2>Room Activity Log</h2>
              <p>
                Riwayat operasional dibuat oleh backend dan tidak dapat diedit
                dari browser.
              </p>
            </div>
            <label className="activitySearch">
              <span>Search</span>
              <input
                value={activityQuery}
                onChange={(event) => setActivityQuery(event.target.value)}
                placeholder="Action, operator, room, booking"
              />
            </label>
          </div>
          <div className="tableWrap">
            <table className="facilityTable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Station / Room</th>
                  <th>Booking</th>
                  <th>Operator</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {scopedActivities.length ? (
                  scopedActivities.map((row) => (
                    <tr key={row.id}>
                      <td>{formatActivityTime(row.createdAt)}</td>
                      <td>
                        <b>{activityLabel(row.action)}</b>
                      </td>
                      <td>
                        {row.station}
                        <small>{roomName(row.roomId)}</small>
                      </td>
                      <td>{row.bookingId || "—"}</td>
                      <td>{row.actorName || "System"}</td>
                      <td>{row.reason || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="tableEmpty">
                        Belum ada activity log pada scope ini.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {pilotDialog && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setPilotDialog(null)
          }
        >
          <div className="modal pilotTestModal">
            <div className="modalHead">
              <div>
                <small>DEVICE TEST</small>
                <h2>Record Check Result</h2>
              </div>
              <button type="button" onClick={() => setPilotDialog(null)}>
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => void savePilotTest(event)}
            >
              <div className="operationContext full">
                <div>
                  <span>Device</span>
                  <b>{pilotDialog.device.name}</b>
                </div>
                <div>
                  <span>Station</span>
                  <b>{pilotDialog.device.station}</b>
                </div>
                <div>
                  <span>Check Item</span>
                  <b>
                    {
                      DISPLAY_UAT_CHECKS.find(
                        (row) => row.id === pilotDialog.checkId,
                      )?.label
                    }
                  </b>
                </div>
              </div>
              <label>
                <span>Result</span>
                <select
                  value={pilotStatus}
                  onChange={(event) =>
                    setPilotStatus(
                      event.target.value as DisplayPilotTest["status"],
                    )
                  }
                >
                  <option>Not Tested</option>
                  <option>Pass</option>
                  <option>Fail</option>
                  <option>Blocked</option>
                  {!DISPLAY_UAT_CHECKS.find(
                    (row) => row.id === pilotDialog.checkId,
                  )?.required && <option>N/A</option>}
                </select>
              </label>
              <label className="full">
                <span>Evidence / Test Note</span>
                <textarea
                  value={pilotNote}
                  onChange={(event) => setPilotNote(event.target.value)}
                  placeholder="Skenario yang diuji, hasil aktual, kendala, dan tindak lanjut"
                  required={pilotStatus !== "Pass" && pilotStatus !== "N/A"}
                />
              </label>
              <div className="notice warn full">
                <span>
                  Changing a check result returns the device to Testing until
                  all required checks pass and it is activated again.
                </span>
              </div>
              {pilotFeedback && (
                <div className={`notice ${pilotFeedback.kind} full`} role="alert">
                  <span>{pilotFeedback.text}</span>
                </div>
              )}
              <div className="modalActions full">
                <button type="button" onClick={() => setPilotDialog(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={savingPilot}
                >
                  {savingPilot ? "Saving..." : "Save Check Result"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOutputGroupForm && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            setShowOutputGroupForm(false)
          }
        >
          <div className="modal outputGroupModal">
            <div className="modalHead">
              <div>
                <small>SCREEN OUTPUT ROUTING</small>
                <h2>
                  {editingOutputGroup
                    ? "Edit Output Group"
                    : "New Output Group"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowOutputGroupForm(false)}
              >
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => void saveOutputGroup(event)}
            >
              <label>
                <span>Station</span>
                <select
                  value={outputGroupDraft.station}
                  disabled={Boolean(editingOutputGroup) || !globalScope}
                  onChange={(event) =>
                    setOutputGroupDraft({
                      ...outputGroupDraft,
                      station: event.target.value,
                      deviceIds: [],
                    })
                  }
                >
                  {activeStations.map((station) => (
                    <option key={station.code} value={station.code}>
                      {station.code} — {station.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select
                  value={outputGroupDraft.status}
                  onChange={(event) =>
                    setOutputGroupDraft({
                      ...outputGroupDraft,
                      status: event.target.value as "Active" | "Inactive",
                    })
                  }
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </label>
              <label className="full">
                <span>Preferred Source Mode</span>
                <select
                  value={outputGroupDraft.sourceMode || "Managed Channel"}
                  onChange={(event) =>
                    setOutputGroupDraft({
                      ...outputGroupDraft,
                      sourceMode: event.target.value as OutputSourceMode,
                    })
                  }
                >
                  <option>Cached Playlist</option>
                  <option>Managed Channel</option>
                  <option>Live Screen Share</option>
                  <option>External TV/IPTV</option>
                  <option>Emergency Override</option>
                </select>
                <small>
                  {outputGroupDraft.sourceMode === "Cached Playlist"
                    ? "Video/image disiapkan di cache Player agar tetap berjalan saat koneksi putus."
                    : outputGroupDraft.sourceMode === "Live Screen Share"
                      ? "Operator memilih tab, window, atau layar; distribusi langsung memakai WebRTC."
                      : outputGroupDraft.sourceMode === "External TV/IPTV"
                        ? "Memakai URL/provider yang memang mengizinkan playback pada browser atau aplikasi perangkat."
                        : outputGroupDraft.sourceMode === "Emergency Override"
                          ? "Konten prioritas mengambil alih output sampai override dihentikan atau berakhir."
                          : "Channel dan jadwal dikelola terpusat; media kompatibel dapat disimpan lokal oleh Player."}
                </small>
              </label>
              <label className="full">
                <span>Output Group Name</span>
                <input
                  value={outputGroupDraft.name}
                  onChange={(event) =>
                    setOutputGroupDraft({
                      ...outputGroupDraft,
                      name: event.target.value,
                    })
                  }
                  placeholder="Output A — Main Lounge"
                  required
                />
              </label>
              <label className="full">
                <span>Description</span>
                <textarea
                  value={outputGroupDraft.description}
                  onChange={(event) =>
                    setOutputGroupDraft({
                      ...outputGroupDraft,
                      description: event.target.value,
                    })
                  }
                  placeholder="Layar utama area lounge dan gate information wall"
                />
              </label>
              <fieldset className="full quickDevicePicker outputGroupPicker">
                <legend>Assigned Devices</legend>
                {devices.filter(
                  (device) =>
                    device.station === outputGroupDraft.station &&
                    isDeviceApproved(device),
                ).length ? (
                  devices
                    .filter(
                      (device) =>
                        device.station === outputGroupDraft.station &&
                        isDeviceApproved(device),
                    )
                    .map((device) => (
                      <label key={device.id}>
                        <input
                          type="checkbox"
                          checked={outputGroupDraft.deviceIds.includes(
                            device.id,
                          )}
                          onChange={(event) =>
                            setOutputGroupDraft({
                              ...outputGroupDraft,
                              deviceIds: event.target.checked
                                ? [...outputGroupDraft.deviceIds, device.id]
                                : outputGroupDraft.deviceIds.filter(
                                    (id) => id !== device.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <b>{device.name}</b>
                          <small>
                            {roomName(device.roomId)} ·{" "}
                            {device.enrollmentStatus || "Not Enrolled"}
                          </small>
                        </span>
                      </label>
                    ))
                ) : (
                  <p>No approved device is available at this station.</p>
                )}
              </fieldset>
              <div className="notice warn full">
                <span>
                  Satu device hanya dapat menerima satu live output pada waktu
                  yang sama. Running text tetap dikelola sebagai overlay
                  terpisah.
                </span>
              </div>
              <div className="modalActions full">
                <button
                  type="button"
                  onClick={() => setShowOutputGroupForm(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    savingOutputGroup || outputGroupDraft.deviceIds.length === 0
                  }
                >
                  {savingOutputGroup ? "Saving..." : "Save Output Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {shareGroup && (
        <div
          className="back"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            setShareGroup(null);
          }}
        >
          <div className="modal shareControlModal">
            <div className="modalHead">
              <div>
                <small>LIVE OUTPUT CONTROL</small>
                <h2>{shareGroup.name}</h2>
              </div>
              <button
                type="button"
                title={selectedActiveShare ? "Minimize; session tetap berjalan" : "Close"}
                onClick={() => setShareGroup(null)}
              >
                ×
              </button>
            </div>
            <form
              className="form shareControlForm"
              onSubmit={(event) => void startOutputShare(event)}
            >
              <div className="shareControlSummary full">
                <div>
                  <span>Station</span>
                  <b>{shareGroup.station}</b>
                </div>
                <div>
                  <span>Target Players</span>
                  <b>{stringArray(shareGroup.deviceIds).length}</b>
                </div>
                <div>
                  <span>Status</span>
                  <b>{selectedActiveShare ? "Sharing" : "Ready"}</b>
                </div>
              </div>

              {!selectedActiveShare ? (
                <>
                  <label className="full">
                    <span>Source Name</span>
                    <input
                      value={shareSourceName}
                      maxLength={160}
                      required
                      onChange={(event) =>
                        setShareSourceName(event.target.value)
                      }
                      placeholder="Operator Screen"
                    />
                  </label>
                  <label className="full">
                    <span>Share Source</span>
                    <select
                      value={shareSourceSelection}
                      onChange={(event) =>
                        setShareSourceSelection(event.target.value)
                      }
                    >
                      <option value="NEW">Choose new tab / window / screen</option>
                      {Object.values(activeShares)
                        .filter((share) => share.groupId !== shareGroup.id)
                        .map((share) => (
                          <option key={share.groupId} value={share.groupId}>
                            Use {share.groupName} — {share.sourceName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="notice warn full">
                    <span>
                      Browser akan meminta Anda memilih tab, jendela, atau
                      layar. Media dikirim langsung melalui WebRTC dan tidak
                      diunggah ke Firebase Storage. Running text tetap tampil
                      sebagai overlay.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="sharePreview full">
                    <video
                      ref={(node) => {
                        if (
                          node &&
                          node.srcObject !== selectedShareRuntime?.stream
                        )
                          node.srcObject = selectedShareRuntime?.stream || null;
                      }}
                      autoPlay
                      muted
                      playsInline
                    />
                    <span>
                      LIVE PREVIEW · {selectedActiveShare.sourceName}
                    </span>
                  </div>
                  <div className="shareTargetList full">
                    {stringArray(shareGroup.deviceIds).map((deviceId) => {
                      const device = devices.find((row) => row.id === deviceId);
                      const state =
                        selectedActiveShare.deviceStates[deviceId] || "Waiting";
                      return (
                        <div key={deviceId}>
                          <span
                            className={`deviceStatusDot ${state === "connected" ? "online" : "offline"}`}
                          />
                          <div>
                            <b>{device?.name || deviceId}</b>
                            <small>
                              {device
                                ? roomName(device.roomId)
                                : "Unknown device"}
                            </small>
                          </div>
                          <strong>{state}</strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="modalActions full">
                {!selectedActiveShare ? (
                  <>
                    <button type="button" onClick={() => setShareGroup(null)}>
                      Cancel
                    </button>
                    <button
                      className="primary"
                      type="submit"
                      disabled={shareStarting}
                    >
                      {shareStarting
                        ? "Starting..."
                        : shareSourceSelection === "NEW"
                          ? "Choose Screen & Start"
                          : "Add Group to Existing Share"}
                    </button>
                  </>
                ) : (
                  <button
                    className="danger"
                    type="button"
                    onClick={() => void stopOutputShare(shareGroup.id)}
                  >
                    Stop Screen Share
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickAnnouncement && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            setShowQuickAnnouncement(false)
          }
        >
          <div className="modal quickAnnouncementModal">
            <div className="modalHead">
              <div>
                <small>FRONT OFFICE QUICK ACTION</small>
                <h2>Send Running Text</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickAnnouncement(false)}
              >
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => void sendQuickAnnouncement(event)}
            >
              <label>
                <span>Station</span>
                <select
                  value={quickAnnouncement.station}
                  disabled={!globalScope}
                  onChange={(event) => {
                    const station = event.target.value;
                    setQuickAnnouncement({
                      ...quickAnnouncement,
                      station,
                      outputGroupId: "",
                      flightId: "",
                      flightNumber: "",
                      route: "",
                      deviceIds: devices
                        .filter(
                          (device) =>
                            device.station === station &&
                            isDeviceEnrolled(device),
                        )
                        .map((device) => device.id),
                    });
                  }}
                >
                  {activeStations.map((station) => (
                    <option key={station.code} value={station.code}>
                      {station.code} — {station.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Announcement Type</span>
                <select
                  value={quickAnnouncement.templateId}
                  onChange={(event) => {
                    const template = effectiveAnnouncementTemplates.find(
                      (row) => row.id === event.target.value,
                    );
                    setQuickAnnouncement({
                      ...quickAnnouncement,
                      templateId: event.target.value,
                      durationMinutes:
                        template?.defaultDurationMinutes ||
                        quickAnnouncement.durationMinutes,
                    });
                  }}
                >
                  {effectiveAnnouncementTemplates
                    .filter((template) => template.status === "Active")
                    .map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                </select>
              </label>
              {!["emergency", "custom"].includes(
                quickAnnouncement.templateId,
              ) && (
                <label className="full">
                  <span>Flight</span>
                  <select
                    value={quickAnnouncement.flightId}
                    onChange={(event) => {
                      const flight = flights.find(
                        (row) => row.id === event.target.value,
                      );
                      setQuickAnnouncement({
                        ...quickAnnouncement,
                        flightId: event.target.value,
                        flightNumber:
                          flight?.flight || quickAnnouncement.flightNumber,
                        route: flight
                          ? `${flight.origin}-${flight.destination}`
                          : quickAnnouncement.route,
                        etd:
                          flight?.etd || flight?.std || quickAnnouncement.etd,
                      });
                    }}
                  >
                    <option value="">Select flight or enter manually</option>
                    {flights
                      .filter(
                        (flight) =>
                          flight.origin === quickAnnouncement.station &&
                          flight.date >= localToday(),
                      )
                      .sort((a, b) =>
                        `${a.date}${a.etd || a.std}`.localeCompare(
                          `${b.date}${b.etd || b.std}`,
                        ),
                      )
                      .slice(0, 100)
                      .map((flight) => (
                        <option key={flight.id} value={flight.id}>
                          {flight.date} · {flight.flight} · {flight.origin}-
                          {flight.destination} · {flight.etd || flight.std}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {!["emergency", "custom"].includes(
                quickAnnouncement.templateId,
              ) && (
                <>
                  <label>
                    <span>Flight Number</span>
                    <input
                      value={quickAnnouncement.flightNumber}
                      onChange={(event) =>
                        setQuickAnnouncement({
                          ...quickAnnouncement,
                          flightNumber: event.target.value,
                        })
                      }
                      placeholder="GA 123"
                      required
                    />
                  </label>
                  <label>
                    <span>Route</span>
                    <input
                      value={quickAnnouncement.route}
                      onChange={(event) =>
                        setQuickAnnouncement({
                          ...quickAnnouncement,
                          route: event.target.value,
                        })
                      }
                      placeholder="CGK-PLM"
                      required
                    />
                  </label>
                </>
              )}
              {quickAnnouncement.templateId === "delay" && (
                <label>
                  <span>New ETD</span>
                  <input
                    type="time"
                    value={quickAnnouncement.etd}
                    onChange={(event) =>
                      setQuickAnnouncement({
                        ...quickAnnouncement,
                        etd: event.target.value,
                      })
                    }
                    required
                  />
                </label>
              )}
              {quickAnnouncement.templateId === "gate-change" && (
                <>
                  <label>
                    <span>Previous Gate</span>
                    <input
                      value={quickAnnouncement.oldGate}
                      onChange={(event) =>
                        setQuickAnnouncement({
                          ...quickAnnouncement,
                          oldGate: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>New Gate</span>
                    <input
                      value={quickAnnouncement.newGate}
                      onChange={(event) =>
                        setQuickAnnouncement({
                          ...quickAnnouncement,
                          newGate: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                </>
              )}
              {["emergency", "custom"].includes(
                quickAnnouncement.templateId,
              ) && (
                <label className="full">
                  <span>Message</span>
                  <textarea
                    value={quickAnnouncement.message}
                    onChange={(event) =>
                      setQuickAnnouncement({
                        ...quickAnnouncement,
                        message: event.target.value,
                      })
                    }
                    placeholder="Type the message shown on screen"
                    required
                  />
                </label>
              )}
              <label className="full">
                <span>Output Group (optional)</span>
                <select
                  value={quickAnnouncement.outputGroupId}
                  onChange={(event) => {
                    const outputGroupId = event.target.value;
                    const group = displayOutputGroups.find(
                      (row) => row.id === outputGroupId,
                    );
                    setQuickAnnouncement({
                      ...quickAnnouncement,
                      outputGroupId,
                      deviceIds: group
                        ? stringArray(group.deviceIds).filter((id) =>
                            devices.some(
                              (device) =>
                                device.id === id && isDeviceEnrolled(device),
                            ),
                          )
                        : quickAnnouncement.deviceIds,
                    });
                  }}
                >
                  <option value="">Custom screen selection</option>
                  {displayOutputGroups
                    .filter(
                      (group) =>
                        group.station === quickAnnouncement.station &&
                        group.status === "Active",
                    )
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} · {stringArray(group.deviceIds).length}{" "}
                        device
                      </option>
                    ))}
                </select>
              </label>
              <fieldset className="full quickDevicePicker">
                <legend>Target Screens</legend>
                {devices.filter(
                  (device) =>
                    device.station === quickAnnouncement.station &&
                    isDeviceEnrolled(device),
                ).length ? (
                  devices
                    .filter(
                      (device) =>
                        device.station === quickAnnouncement.station &&
                        isDeviceEnrolled(device),
                    )
                    .map((device) => (
                      <label key={device.id}>
                        <input
                          type="checkbox"
                          checked={quickAnnouncement.deviceIds.includes(
                            device.id,
                          )}
                          onChange={(event) =>
                            setQuickAnnouncement({
                              ...quickAnnouncement,
                              outputGroupId: "",
                              deviceIds: event.target.checked
                                ? [...quickAnnouncement.deviceIds, device.id]
                                : quickAnnouncement.deviceIds.filter(
                                    (id) => id !== device.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <b>{device.name}</b>
                          <small>{roomName(device.roomId)}</small>
                        </span>
                      </label>
                    ))
                ) : (
                  <p>No enrolled screen is available at this station.</p>
                )}
              </fieldset>
              <label>
                <span>Duration</span>
                {canConfigure ? (
                  <input
                    type="number"
                    min="1"
                    max="480"
                    value={quickAnnouncement.durationMinutes}
                    onChange={(event) =>
                      setQuickAnnouncement({
                        ...quickAnnouncement,
                        durationMinutes: Number(event.target.value),
                      })
                    }
                  />
                ) : (
                  <input
                    value={`${quickAnnouncement.durationMinutes} minutes`}
                    readOnly
                  />
                )}
              </label>
              <div className="quickAnnouncementPreview full">
                <small>SCREEN PREVIEW</small>
                <strong>
                  {announcementPreview(
                    effectiveAnnouncementTemplates.find(
                      (row) => row.id === quickAnnouncement.templateId,
                    ),
                    quickAnnouncement,
                  )}
                </strong>
                <span>
                  Multiple active flights rotate automatically by priority.
                  Emergency messages temporarily take over the queue.
                </span>
              </div>
              <div className="modalActions full">
                <button
                  type="button"
                  onClick={() => setShowQuickAnnouncement(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    savingAnnouncement ||
                    quickAnnouncement.deviceIds.length === 0
                  }
                >
                  {savingAnnouncement ? "Sending..." : "Send Now"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {remoteDevice && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setRemoteDevice(null)
          }
        >
          <div className="modal remoteControlModal">
            <div className="modalHead">
              <div>
                <small>DISPLAY PLAYER</small>
                <h2>
                  {remoteMode === "enroll" ? "Enroll Player" : "Remote Control"}
                </h2>
              </div>
              <button type="button" onClick={() => setRemoteDevice(null)}>
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => void submitRemoteControl(event)}
            >
              <div className="operationContext full">
                <div>
                  <span>Device</span>
                  <b>{remoteDevice.name}</b>
                </div>
                <div>
                  <span>Location</span>
                  <b>
                    {remoteDevice.station} · {roomName(remoteDevice.roomId)}
                  </b>
                </div>
                <div>
                  <span>Status</span>
                  <b>{remoteDevice.enrollmentStatus || "Not Enrolled"}</b>
                </div>
              </div>
              {remoteMode === "enroll" ? (
                <>
                  <div className="notice warn full">
                    <span>
                      Buka <b>/player</b> pada laptop, mini PC, Android player,
                      atau browser Smart TV. Masukkan kode di bawah dalam 10
                      menit.
                    </span>
                  </div>
                  {enrollmentCode ? (
                    <div className="enrollmentCode full">
                      <small>ONE-TIME ENROLLMENT CODE</small>
                      <strong>{enrollmentCode.code}</strong>
                      <span>
                        Expires{" "}
                        {new Date(enrollmentCode.expiresAt).toLocaleString(
                          "id-ID",
                        )}
                      </span>
                    </div>
                  ) : (
                    <div className="playerCapabilityNote full">
                      <b>Secure enrollment</b>
                      <span>
                        Kode hanya dapat digunakan satu kali. Device secret
                        dibuat setelah player berhasil melakukan claim.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="full">
                    <span>Command</span>
                    <select
                      value={remoteType}
                      onChange={(event) => setRemoteType(event.target.value)}
                    >
                      <option value="PLAY_CHANNEL">Play Channel Now</option>
                      <option value="SET_OVERLAY">Set Running Text</option>
                      <option value="CLEAR_OVERLAY">Clear Running Text</option>
                      <option value="STOP_PLAYBACK">Stop &amp; Standby</option>
                      <option value="PAUSE">Pause Screen</option>
                      <option value="RESUME">Resume Screen</option>
                      <option value="REFRESH">Refresh Player</option>
                      <option
                        value="REQUEST_SCREENSHOT"
                        disabled={!remoteDevice.capabilities?.screenshot}
                      >
                        Request Screenshot
                      </option>
                    </select>
                  </label>
                  {remoteType === "PLAY_CHANNEL" && (
                    <>
                      <label>
                        <span>Channel</span>
                        <select
                          value={remoteChannelId}
                          onChange={(event) =>
                            setRemoteChannelId(event.target.value)
                          }
                          required
                        >
                          <option value="">Select channel</option>
                          {displayChannels
                            .filter((row) => row.status === "Active")
                            .map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <span>Override Duration</span>
                        <select
                          value={remoteDuration}
                          onChange={(event) =>
                            setRemoteDuration(Number(event.target.value))
                          }
                        >
                          {[15, 30, 60, 120, 240, 480].map((value) => (
                            <option key={value} value={value}>
                              {value} minutes
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {remoteType === "STOP_PLAYBACK" && (
                    <label>
                      <span>Standby Duration</span>
                      <select
                        value={remoteDuration}
                        onChange={(event) =>
                          setRemoteDuration(Number(event.target.value))
                        }
                      >
                        {[15, 30, 60, 120, 240, 480].map((value) => (
                          <option key={value} value={value}>
                            {value} minutes
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {remoteType === "SET_OVERLAY" && (
                    <>
                      <label className="full">
                        <span>Running Text</span>
                        <textarea
                          value={remoteOverlayText}
                          onChange={(event) =>
                            setRemoteOverlayText(event.target.value)
                          }
                          placeholder="Boarding information, final call, or lounge message"
                          required
                        />
                      </label>
                      <label>
                        <span>Display Duration</span>
                        <select
                          value={remoteDuration}
                          onChange={(event) =>
                            setRemoteDuration(Number(event.target.value))
                          }
                        >
                          {[5, 10, 15, 30, 60, 120].map((value) => (
                            <option key={value} value={value}>
                              {value} minutes
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {remoteDevice.capabilities?.browserPlayer &&
                    !remoteDevice.capabilities?.screenshot && (
                      <div className="playerCapabilityNote full">
                        <b>Browser player capability</b>
                        <span>
                          Playback, schedule, running text, pause, resume, dan
                          refresh tersedia. Unattended screenshot memerlukan
                          Android/native player.
                        </span>
                      </div>
                    )}
                </>
              )}
              <div className="modalActions full">
                <button type="button" onClick={() => setRemoteDevice(null)}>
                  Close
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    savingRemote ||
                    (remoteMode === "enroll" && Boolean(enrollmentCode))
                  }
                >
                  {savingRemote
                    ? "Processing..."
                    : remoteMode === "enroll"
                      ? enrollmentCode
                        ? "Code Generated"
                        : "Generate Code"
                      : "Send Command"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {displayDialog && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDisplayDialog(null)
          }
        >
          <div className="modal displayManagementModal">
            <div className="modalHead">
              <div>
                <small>TV &amp; DIGITAL SIGNAGE</small>
                <h2>
                  {displayDialog === "content"
                    ? editingContent
                      ? "Edit Content"
                      : "Add Content"
                    : displayDialog === "channel"
                      ? editingChannel
                        ? "Edit Channel"
                        : "New Channel"
                      : editingSchedule
                        ? "Edit Schedule"
                        : "New Schedule"}
                </h2>
              </div>
              <button type="button" onClick={() => setDisplayDialog(null)}>
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => void saveDisplayItem(event)}
            >
              {displayDialog === "content" && (
                <>
                  <label>
                    <span>Content Title</span>
                    <input
                      value={contentDraft.title}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          title: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Content Type</span>
                    <select
                      value={contentDraft.contentType}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          contentType: event.target
                            .value as DisplayContent["contentType"],
                        })
                      }
                    >
                      <option>Live TV</option>
                      <option>Video</option>
                      <option>Image</option>
                      <option>Web URL</option>
                    </select>
                  </label>
                  <label>
                    <span>Scope</span>
                    <select
                      value={contentDraft.station}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          station: event.target.value,
                        })
                      }
                      disabled={!globalScope}
                    >
                      <option value="ALL">All Stations</option>
                      {activeStations.map((station) => (
                        <option key={station.code} value={station.code}>
                          {station.code} — {station.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Duration (seconds)</span>
                    <input
                      type="number"
                      min="0"
                      max="86400"
                      value={contentDraft.durationSeconds}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          durationSeconds: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="full">
                    <span>Source URL</span>
                    <input
                      type="text"
                      inputMode="url"
                      value={contentDraft.sourceUrl}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          sourceUrl: event.target.value,
                        })
                      }
                      placeholder="https://... atau /demo-media/nama-file.mp4"
                    />
                    <small>
                      Demo lokal dapat menggunakan /demo-media/nama-file.jpg
                      atau .mp4 dari folder public/demo-media.
                    </small>
                  </label>
                  {!["Live TV", "Web URL"].includes(
                    contentDraft.contentType,
                  ) && (
                    <label className="full">
                      <span>Upload Media (optional)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                        onChange={(event) =>
                          setDisplayMediaFile(event.target.files?.[0] || null)
                        }
                      />
                      <small>
                        JPG, PNG, WEBP, MP4, atau WEBM · maksimal 200 MB
                      </small>
                    </label>
                  )}
                  <label>
                    <span>Status</span>
                    <select
                      value={contentDraft.status}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          status: event.target
                            .value as DisplayContent["status"],
                        })
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </label>
                  <label className="full">
                    <span>Description</span>
                    <textarea
                      value={contentDraft.description}
                      onChange={(event) =>
                        setContentDraft({
                          ...contentDraft,
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              )}

              {displayDialog === "channel" && (
                <>
                  <label>
                    <span>Channel Name</span>
                    <input
                      value={channelDraft.name}
                      onChange={(event) =>
                        setChannelDraft({
                          ...channelDraft,
                          name: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={channelDraft.status}
                      onChange={(event) =>
                        setChannelDraft({
                          ...channelDraft,
                          status: event.target
                            .value as DisplayChannel["status"],
                        })
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </label>
                  <label className="full">
                    <span>Description</span>
                    <textarea
                      value={channelDraft.description}
                      onChange={(event) =>
                        setChannelDraft({
                          ...channelDraft,
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                  {channelDraft.contentIds.length > 0 && (
                    <div className="channelSequence full">
                      <b>Playback Order</b>
                      {channelDraft.contentIds.map((id, index) => (
                        <div key={id}>
                          <span>{index + 1}</span>
                          <b>
                            {displayContents.find((row) => row.id === id)
                              ?.title || "Content unavailable"}
                          </b>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => {
                              const next = [...channelDraft.contentIds];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              setChannelDraft({
                                ...channelDraft,
                                contentIds: next,
                              });
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={
                              index === channelDraft.contentIds.length - 1
                            }
                            onClick={() => {
                              const next = [...channelDraft.contentIds];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              setChannelDraft({
                                ...channelDraft,
                                contentIds: next,
                              });
                            }}
                          >
                            ↓
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="checklistPanel full">
                    <b>Channel Content</b>
                    {displayContents
                      .filter((row) => row.status === "Active")
                      .map((row) => (
                        <label key={row.id}>
                          <input
                            type="checkbox"
                            checked={channelDraft.contentIds.includes(row.id)}
                            onChange={(event) =>
                              setChannelDraft({
                                ...channelDraft,
                                contentIds: event.target.checked
                                  ? [...channelDraft.contentIds, row.id]
                                  : channelDraft.contentIds.filter(
                                      (id) => id !== row.id,
                                    ),
                              })
                            }
                          />
                          <span>
                            {row.title} · {row.contentType}
                          </span>
                        </label>
                      ))}
                    {!displayContents.some(
                      (row) => row.status === "Active",
                    ) && <small>Belum ada content aktif.</small>}
                  </div>
                </>
              )}

              {displayDialog === "schedule" && (
                <>
                  <label>
                    <span>Schedule Title</span>
                    <input
                      value={scheduleDraft.title}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          title: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Station</span>
                    <select
                      value={scheduleDraft.station}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          station: event.target.value,
                          deviceIds: [],
                        })
                      }
                      disabled={!globalScope}
                    >
                      {activeStations.map((station) => (
                        <option key={station.code} value={station.code}>
                          {station.code} — {station.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Channel</span>
                    <select
                      value={scheduleDraft.channelId}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          channelId: event.target.value,
                        })
                      }
                      required
                    >
                      <option value="">Select channel</option>
                      {displayChannels
                        .filter((row) => row.status === "Active")
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={scheduleDraft.priority}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          priority: event.target
                            .value as DisplaySchedule["priority"],
                        })
                      }
                    >
                      <option>Normal</option>
                      <option>High</option>
                      <option>Emergency</option>
                    </select>
                  </label>
                  <label>
                    <span>Start Date</span>
                    <input
                      type="date"
                      value={scheduleDraft.startDate}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          startDate: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>End Date</span>
                    <input
                      type="date"
                      value={scheduleDraft.endDate}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          endDate: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Start Time</span>
                    <input
                      type="time"
                      value={scheduleDraft.startTime}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          startTime: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>End Time</span>
                    <input
                      type="time"
                      value={scheduleDraft.endTime}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          endTime: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <div className="checklistPanel full compactChecklist">
                    <b>Operating Days</b>
                    <div>
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                        <label key={day}>
                          <input
                            type="checkbox"
                            checked={scheduleDraft.daysOfWeek.includes(day)}
                            onChange={(event) =>
                              setScheduleDraft({
                                ...scheduleDraft,
                                daysOfWeek: event.target.checked
                                  ? [...scheduleDraft.daysOfWeek, day].sort()
                                  : scheduleDraft.daysOfWeek.filter(
                                      (value) => value !== day,
                                    ),
                              })
                            }
                          />
                          <span>{dayLabel(day)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="checklistPanel full">
                    <b>Target Devices</b>
                    {devices
                      .filter(
                        (row) =>
                          row.station === scheduleDraft.station &&
                          isDeviceApproved(row),
                      )
                      .map((row) => (
                        <label key={row.id}>
                          <input
                            type="checkbox"
                            checked={scheduleDraft.deviceIds.includes(row.id)}
                            onChange={(event) =>
                              setScheduleDraft({
                                ...scheduleDraft,
                                deviceIds: event.target.checked
                                  ? [...scheduleDraft.deviceIds, row.id]
                                  : scheduleDraft.deviceIds.filter(
                                      (id) => id !== row.id,
                                    ),
                              })
                            }
                          />
                          <span>
                            {row.name} · {roomName(row.roomId)}
                          </span>
                        </label>
                      ))}
                    {!devices.some(
                      (row) =>
                        row.station === scheduleDraft.station &&
                        isDeviceApproved(row),
                    ) && (
                      <small>Belum ada device Approved di station ini.</small>
                    )}
                  </div>
                  <label className="full inlineCheck">
                    <input
                      type="checkbox"
                      checked={scheduleDraft.overlayEnabled}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          overlayEnabled: event.target.checked,
                        })
                      }
                    />
                    <span>Enable scheduled running text</span>
                  </label>
                  {scheduleDraft.overlayEnabled && (
                    <label className="full">
                      <span>Running Text</span>
                      <textarea
                        value={scheduleDraft.overlayText}
                        onChange={(event) =>
                          setScheduleDraft({
                            ...scheduleDraft,
                            overlayText: event.target.value,
                          })
                        }
                        placeholder="Informasi boarding, final call, atau pesan lounge"
                      />
                    </label>
                  )}
                  <label>
                    <span>Status</span>
                    <select
                      value={scheduleDraft.status}
                      onChange={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          status: event.target
                            .value as DisplaySchedule["status"],
                        })
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </label>
                </>
              )}

              <div className="modalActions full">
                <button type="button" onClick={() => setDisplayDialog(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={savingDisplay}
                >
                  {savingDisplay ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {operationDialog && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setOperationDialog(null)
          }
        >
          <div className="modal operationModal">
            <div className="modalHead">
              <div>
                <small>ROOM OPERATIONS</small>
                <h2>{operationDialogTitle(operationDialog.type)}</h2>
              </div>
              <button type="button" onClick={() => setOperationDialog(null)}>
                ×
              </button>
            </div>
            <form
              className="form operationForm"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRoomOperation();
              }}
            >
              {operationDialog.booking && (
                <div className="operationContext full">
                  <div>
                    <span>Booking</span>
                    <b>{operationDialog.booking.title}</b>
                  </div>
                  <div>
                    <span>Room</span>
                    <b>{operationDialog.booking.roomName}</b>
                  </div>
                  <div>
                    <span>Schedule</span>
                    <b>
                      {operationDialog.booking.localDate} ·{" "}
                      {operationDialog.booking.startTime}–
                      {operationDialog.booking.endTime}
                    </b>
                  </div>
                </div>
              )}

              {operationDialog.type === "checkin" && (
                <>
                  <div className="checklistPanel full">
                    <b>Readiness Checklist</b>
                    {[
                      ["clean", "Room clean and ready"],
                      ["avReady", "AV / meeting equipment ready"],
                      ["amenitiesReady", "Amenities complete"],
                      ["safetyChecked", "Safety check completed"],
                      ["tvReady", "TV / display ready"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            operationForm[key as keyof OperationForm],
                          )}
                          onChange={(event) =>
                            setOperationForm({
                              ...operationForm,
                              [key]: event.target.checked,
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="full">
                    <span>Readiness Note</span>
                    <textarea
                      value={operationForm.readinessNote}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          readinessNote: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="full">
                    <span>Supervisor Override Reason</span>
                    <textarea
                      value={operationForm.overrideReason}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          overrideReason: event.target.value,
                        })
                      }
                      placeholder="Wajib bila checklist belum seluruhnya ready atau check-in di luar operational window"
                    />
                  </label>
                </>
              )}

              {operationDialog.type === "checkout" && (
                <>
                  <label>
                    <span>Handover To</span>
                    <input
                      value={operationForm.handoverTo}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          handoverTo: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Issue Summary</span>
                    <input
                      value={operationForm.issueSummary}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          issueSummary: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="full">
                    <span>Handover Note</span>
                    <textarea
                      value={operationForm.handoverNote}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          handoverNote: event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              )}

              {operationDialog.type === "cleaning" && (
                <>
                  <div className="checklistPanel full">
                    <b>Cleaning Completion</b>
                    {[
                      ["cleaningClean", "Room has been cleaned"],
                      ["cleaningAmenities", "Amenities have been replenished"],
                      [
                        "cleaningDamageChecked",
                        "Damage check has been completed",
                      ],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            operationForm[key as keyof OperationForm],
                          )}
                          onChange={(event) =>
                            setOperationForm({
                              ...operationForm,
                              [key]: event.target.checked,
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="full">
                    <span>Cleaning Note</span>
                    <textarea
                      value={operationForm.cleaningNote}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          cleaningNote: event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              )}

              {operationDialog.type === "move" && (
                <>
                  <label className="full">
                    <span>Target Room</span>
                    <select
                      value={operationForm.targetRoomId}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          targetRoomId: event.target.value,
                        })
                      }
                      required
                    >
                      <option value="">Select target room</option>
                      {rooms
                        .filter(
                          (room) =>
                            room.station === operationDialog.booking?.station &&
                            room.id !== operationDialog.booking?.roomId &&
                            room.status === "Active" &&
                            !["Occupied", "Maintenance"].includes(
                              room.operationalState,
                            ),
                        )
                        .map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name} · Capacity {room.capacity} ·{" "}
                            {room.operationalState}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="full">
                    <span>Movement Reason</span>
                    <textarea
                      value={operationForm.reason}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          reason: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                </>
              )}

              {["maintenance", "incident"].includes(operationDialog.type) && (
                <label className="full">
                  <span>Room</span>
                  <select
                    value={operationDialog.room?.id || ""}
                    onChange={(event) =>
                      setOperationDialog({
                        ...operationDialog,
                        room: rooms.find(
                          (room) => room.id === event.target.value,
                        ),
                      })
                    }
                    required
                  >
                    <option value="">Select room</option>
                    {scopedRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} · {room.station} · {room.operationalState}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {operationDialog.type === "maintenance" && (
                <>
                  <label>
                    <span>Category</span>
                    <select
                      value={operationForm.category}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          category: event.target.value,
                        })
                      }
                    >
                      <option>General</option>
                      <option>Electrical</option>
                      <option>Furniture</option>
                      <option>HVAC</option>
                      <option>AV / TV</option>
                      <option>Safety</option>
                      <option>Plumbing</option>
                    </select>
                  </label>
                  <label className="full">
                    <span>Maintenance Reason</span>
                    <textarea
                      value={operationForm.reason}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          reason: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                </>
              )}

              {operationDialog.type === "incident" && (
                <>
                  <label>
                    <span>Category</span>
                    <select
                      value={operationForm.category}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          category: event.target.value,
                        })
                      }
                    >
                      <option>General</option>
                      <option>Damage</option>
                      <option>Safety</option>
                      <option>Equipment</option>
                      <option>Guest Complaint</option>
                      <option>Service Disruption</option>
                    </select>
                  </label>
                  <label>
                    <span>Severity</span>
                    <select
                      value={operationForm.severity}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          severity: event.target
                            .value as OperationForm["severity"],
                        })
                      }
                    >
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                      <option>Critical</option>
                    </select>
                  </label>
                  <label className="full">
                    <span>Description</span>
                    <textarea
                      value={operationForm.description}
                      onChange={(event) =>
                        setOperationForm({
                          ...operationForm,
                          description: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                </>
              )}

              <div className="modalActions full">
                <button type="button" onClick={() => setOperationDialog(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={savingOperation}
                >
                  {savingOperation
                    ? "Processing..."
                    : operationSubmitLabel(operationDialog.type)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBookingForm && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShowBookingForm(false)
          }
        >
          <div className="modal facilityModal bookingModal">
            <div className="modalHead">
              <div>
                <small>ROOM BOOKING</small>
                <h2>
                  {editingBooking
                    ? editingBookingStatus === "Draft"
                      ? "Edit Draft Booking"
                      : "Edit Submitted Booking"
                    : "New Room Booking"}
                </h2>
              </div>
              <button type="button" onClick={() => setShowBookingForm(false)}>
                ×
              </button>
            </div>
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveBooking(false);
              }}
            >
              <label>
                <span>Station</span>
                <select
                  value={bookingDraft.station}
                  onChange={(event) => {
                    const nextStation = event.target.value;
                    setBookingDraft({
                      ...bookingDraft,
                      station: nextStation,
                      roomId:
                        rooms.find(
                          (room) =>
                            room.station === nextStation &&
                            room.status === "Active",
                        )?.id || "",
                    });
                  }}
                  disabled={Boolean(editingBooking)}
                >
                  {activeStations.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Room</span>
                <select
                  value={bookingDraft.roomId}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      roomId: event.target.value,
                    })
                  }
                  required
                >
                  <option value="">Select room</option>
                  {rooms
                    .filter(
                      (room) =>
                        room.station === bookingDraft.station &&
                        room.status === "Active",
                    )
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} · Capacity {room.capacity}
                      </option>
                    ))}
                </select>
              </label>
              <label className="full">
                <span>Booking Title</span>
                <input
                  value={bookingDraft.title}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      title: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label className="full">
                <span>Purpose</span>
                <input
                  value={bookingDraft.purpose}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      purpose: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Organizer</span>
                <input
                  value={bookingDraft.organizer}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      organizer: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Contact</span>
                <input
                  value={bookingDraft.contact}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      contact: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Date</span>
                <input
                  type="date"
                  value={bookingDraft.localDate}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      localDate: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                <span>Attendees</span>
                <input
                  type="number"
                  min="1"
                  value={bookingDraft.attendees}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      attendees: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Start Time</span>
                <input
                  type="time"
                  step="900"
                  value={bookingDraft.startTime}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      startTime: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                <span>End Time</span>
                <input
                  type="time"
                  step="900"
                  value={bookingDraft.endTime}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      endTime: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                <span>Preparation Buffer</span>
                <select
                  value={bookingDraft.bufferBeforeMinutes}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      bufferBeforeMinutes: Number(event.target.value),
                    })
                  }
                >
                  {[0, 15, 30, 45, 60].map((value) => (
                    <option key={value} value={value}>
                      {value} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Cleaning Buffer</span>
                <select
                  value={bookingDraft.bufferAfterMinutes}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      bufferAfterMinutes: Number(event.target.value),
                    })
                  }
                >
                  {[0, 15, 30, 45, 60, 90, 120].map((value) => (
                    <option key={value} value={value}>
                      {value} minutes
                    </option>
                  ))}
                </select>
              </label>
              {!editingBooking && (
                <>
                  <label>
                    <span>Recurrence</span>
                    <select
                      value={bookingDraft.recurrenceType}
                      onChange={(event) =>
                        setBookingDraft({
                          ...bookingDraft,
                          recurrenceType: event.target
                            .value as BookingDraft["recurrenceType"],
                          recurrenceCount:
                            event.target.value === "None"
                              ? 1
                              : bookingDraft.recurrenceCount,
                        })
                      }
                    >
                      <option>None</option>
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                    </select>
                  </label>
                  <label>
                    <span>Occurrences</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      disabled={bookingDraft.recurrenceType === "None"}
                      value={bookingDraft.recurrenceCount}
                      onChange={(event) =>
                        setBookingDraft({
                          ...bookingDraft,
                          recurrenceCount: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label className="full">
                <span>Visitor / Flight Reference (optional)</span>
                <input
                  value={bookingDraft.visitorReference}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      visitorReference: event.target.value,
                    })
                  }
                />
              </label>
              <label className="full">
                <span>Notes</span>
                <textarea
                  value={bookingDraft.notes}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      notes: event.target.value,
                    })
                  }
                />
              </label>
              <div className="notice warn full">
                <span>
                  Booking yang diajukan akan menahan seluruh slot waktu termasuk
                  buffer. Sistem menolak booking yang berbenturan.
                </span>
              </div>
              <div className="modalActions full">
                <button type="button" onClick={() => setShowBookingForm(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={savingBooking}>
                  {savingBooking
                    ? "Saving..."
                    : editingBookingStatus && editingBookingStatus !== "Draft"
                      ? "Save Changes"
                      : "Save Draft"}
                </button>
                {(!editingBookingStatus || editingBookingStatus === "Draft") && (
                  <button
                    className="primary"
                    type="button"
                    disabled={savingBooking}
                    onClick={() => void saveBooking(true)}
                  >
                    Submit for Approval
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {bookingDetail && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setBookingDetail(null)
          }
        >
          <div className="modal bookingDetailModal">
            <div className="modalHead">
              <div>
                <small>BOOKING DETAIL</small>
                <h2>{bookingDetail.title}</h2>
              </div>
              <button type="button" onClick={() => setBookingDetail(null)}>
                ×
              </button>
            </div>
            <div className="bookingDetailGrid">
              <div>
                <span>Status</span>
                <b>{bookingDetail.status}</b>
              </div>
              <div>
                <span>Room</span>
                <b>
                  {bookingDetail.station} · {bookingDetail.roomName}
                </b>
              </div>
              <div>
                <span>Date &amp; Time</span>
                <b>
                  {bookingDetail.localDate} · {bookingDetail.startTime}–
                  {bookingDetail.endTime}
                </b>
              </div>
              <div>
                <span>Organizer</span>
                <b>{bookingDetail.organizer || "—"}</b>
              </div>
              <div>
                <span>Contact</span>
                <b>{bookingDetail.contact || "—"}</b>
              </div>
              <div>
                <span>Attendees</span>
                <b>{bookingDetail.attendees}</b>
              </div>
              <div>
                <span>Purpose</span>
                <b>{bookingDetail.purpose || "—"}</b>
              </div>
              <div>
                <span>Preparation / Cleaning Buffer</span>
                <b>
                  {bookingDetail.bufferBeforeMinutes} /{" "}
                  {bookingDetail.bufferAfterMinutes} minutes
                </b>
              </div>
              <div className="full">
                <span>Notes</span>
                <b>{bookingDetail.notes || "—"}</b>
              </div>
            </div>
            <div className="bookingDetailActions">
              <BookingActions
                booking={bookingDetail}
                currentUserId={account.id}
                canApprove={canApproveBooking}
                ownerCanCancel={account.role !== "Lounge Officer"}
                onEdit={(booking) => {
                  setBookingDetail(null);
                  editDraft(booking);
                }}
                onAction={(booking, action) => {
                  void bookingAction(booking, action);
                  setBookingDetail(null);
                }}
              />
              <button type="button" onClick={() => setBookingDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRoomForm && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShowRoomForm(false)
          }
        >
          <div className="modal facilityModal">
            <div className="modalHead">
              <div>
                <small>MASTER CONFIGURATION</small>
                <h2>{editingRoom ? "Edit Room" : "Add Room"}</h2>
              </div>
              <button type="button" onClick={() => setShowRoomForm(false)}>
                ×
              </button>
            </div>
            <form className="form" onSubmit={(event) => void saveRoom(event)}>
              <label>
                <span>Station</span>
                <select
                  value={roomDraft.station}
                  onChange={(event) =>
                    setRoomDraft({ ...roomDraft, station: event.target.value })
                  }
                >
                  {activeStations.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Room Name</span>
                <input
                  value={roomDraft.name}
                  onChange={(event) =>
                    setRoomDraft({ ...roomDraft, name: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span>Area / Location</span>
                <input
                  value={roomDraft.area}
                  onChange={(event) =>
                    setRoomDraft({ ...roomDraft, area: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span>Room Type</span>
                <select
                  value={roomDraft.roomType}
                  onChange={(event) =>
                    setRoomDraft({ ...roomDraft, roomType: event.target.value })
                  }
                >
                  <option>Meeting Room</option>
                  <option>VIP Room</option>
                  <option>Private Room</option>
                  <option>Prayer Room</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                <span>Capacity</span>
                <input
                  type="number"
                  min="1"
                  value={roomDraft.capacity}
                  onChange={(event) =>
                    setRoomDraft({
                      ...roomDraft,
                      capacity: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Operational State</span>
                <select
                  value={roomDraft.operationalState}
                  onChange={(event) =>
                    setRoomDraft({
                      ...roomDraft,
                      operationalState: event.target.value as RoomState,
                    })
                  }
                >
                  {roomStates.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                <span>Facilities (comma separated)</span>
                <input
                  value={roomFacilitiesInput}
                  onChange={(event) =>
                    setRoomFacilitiesInput(event.target.value)
                  }
                  placeholder="TV, HDMI, Conference Table"
                />
              </label>
              <div className="modalActions full">
                <button type="button" onClick={() => setShowRoomForm(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeviceForm && (
        <div
          className="back"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShowDeviceForm(false)
          }
        >
          <div className="modal facilityModal">
            <div className="modalHead">
              <div>
                <small>DISPLAY INVENTORY</small>
                <h2>{editingDevice ? "Edit Device" : "Add Device"}</h2>
              </div>
              <button type="button" onClick={() => setShowDeviceForm(false)}>
                ×
              </button>
            </div>
            <form className="form" onSubmit={(event) => void saveDevice(event)}>
              <label>
                <span>Station</span>
                <select
                  value={deviceDraft.station}
                  onChange={(event) =>
                    setDeviceDraft({
                      ...deviceDraft,
                      station: event.target.value,
                      roomId: "",
                    })
                  }
                >
                  {activeStations.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Device Name</span>
                <input
                  value={deviceDraft.name}
                  onChange={(event) =>
                    setDeviceDraft({ ...deviceDraft, name: event.target.value })
                  }
                  placeholder="CGK-T3-DOM-TV-01"
                  required
                />
              </label>
              <label>
                <span>Mapped Room</span>
                <select
                  value={deviceDraft.roomId}
                  onChange={(event) =>
                    setDeviceDraft({
                      ...deviceDraft,
                      roomId: event.target.value,
                    })
                  }
                >
                  <option value="">Belum dipetakan</option>
                  {rooms
                    .filter((room) => room.station === deviceDraft.station)
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Platform</span>
                <select
                  value={deviceDraft.platform}
                  onChange={(event) =>
                    setDeviceDraft({
                      ...deviceDraft,
                      platform: event.target.value as DeviceRecord["platform"],
                    })
                  }
                >
                  <option>Smart TV Browser</option>
                  <option>Android Signage Player</option>
                  <option>Mini PC</option>
                </select>
              </label>
              <label>
                <span>Connection</span>
                <select
                  value={deviceDraft.connectionType}
                  onChange={(event) =>
                    setDeviceDraft({
                      ...deviceDraft,
                      connectionType: event.target
                        .value as DeviceRecord["connectionType"],
                    })
                  }
                >
                  <option>LAN</option>
                  <option>Wi-Fi</option>
                </select>
              </label>
              <label>
                <span>Approval</span>
                <select
                  value={canonicalApprovalStatus(deviceDraft.approvalStatus)}
                  onChange={(event) =>
                    setDeviceDraft({
                      ...deviceDraft,
                      approvalStatus: event.target
                        .value as DeviceRecord["approvalStatus"],
                    })
                  }
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </label>
              <div className="deviceFormGuidance full">
                <b>Setelah inventory disimpan</b>
                <ol>
                  <li>Buka TV &amp; Digital Signage lalu pilih Monitor.</li>
                  <li>Jika status masih Pending, klik Approve.</li>
                  <li>Klik Enroll Player lalu Generate Code.</li>
                  <li>
                    Buka <b>/player</b> pada perangkat tujuan dan masukkan kode
                    dalam 10 menit.
                  </li>
                  <li>
                    Perangkat berhasil terdaftar ketika status berubah menjadi
                    Enrolled dan Online.
                  </li>
                </ol>
              </div>
              <div className="modalActions full">
                <button type="button" onClick={() => setShowDeviceForm(false)}>
                  Cancel
                </button>
                {editingDeviceRecord &&
                  canControl &&
                  isDeviceApproved(editingDeviceRecord) &&
                  !isDeviceEnrolled(editingDeviceRecord) && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeviceForm(false);
                        openRemoteControl(editingDeviceRecord, "enroll");
                      }}
                    >
                      Enroll Player
                    </button>
                  )}
                {editingDeviceRecord && canConfigure && (
                  <button
                    className="danger"
                    type="button"
                    disabled={deletingDeviceId === editingDeviceRecord.id}
                    onClick={() => void deleteDevice(editingDeviceRecord)}
                  >
                    {deletingDeviceId === editingDeviceRecord.id
                      ? "Deleting..."
                      : "Delete Device"}
                  </button>
                )}
                <button className="primary" type="submit">
                  Save Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="facilityEmpty">
      <strong>No operational data</strong>
      <span>{text}</span>
    </div>
  );
}

function operationDialogTitle(type: OperationDialog["type"]) {
  return {
    checkin: "Room Check-in",
    checkout: "Room Check-out & Handover",
    cleaning: "Cleaning Completion",
    move: "Move Room",
    maintenance: "Start Maintenance",
    incident: "Report Incident",
  }[type];
}

function operationSubmitLabel(type: OperationDialog["type"]) {
  return {
    checkin: "Confirm Check-in",
    checkout: "Confirm Check-out",
    cleaning: "Mark Room Available",
    move: "Move Booking",
    maintenance: "Start Maintenance",
    incident: "Submit Incident",
  }[type];
}

function activityMillis(value: unknown) {
  if (!value) return 0;
  const candidate = value as { toDate?: () => Date; seconds?: number };
  const date =
    typeof candidate.toDate === "function"
      ? candidate.toDate()
      : typeof candidate.seconds === "number"
        ? new Date(candidate.seconds * 1000)
        : new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatActivityTime(value: unknown) {
  if (!value) return "—";
  const candidate = value as { toDate?: () => Date; seconds?: number };
  const date =
    typeof candidate.toDate === "function"
      ? candidate.toDate()
      : typeof candidate.seconds === "number"
        ? new Date(candidate.seconds * 1000)
        : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function activityLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dayLabel(day: number) {
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day] || "—";
}

function dateValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function BookingCalendar({
  view,
  anchor,
  bookings,
  currentUserId,
  canApprove,
  ownerCanCancel,
  onOpen,
  onEdit,
  onAction,
}: {
  view: "Day" | "Week" | "Month" | "List";
  anchor: string;
  bookings: RoomBooking[];
  currentUserId: string;
  canApprove: boolean;
  ownerCanCancel: boolean;
  onOpen: (booking: RoomBooking) => void;
  onEdit: (booking: RoomBooking) => void;
  onAction: (
    booking: RoomBooking,
    action: "submit" | "approve" | "reject" | "cancel",
  ) => void;
}) {
  const byDate = (date: string) =>
    bookings.filter((booking) => booking.localDate === date);
  const card = (booking: RoomBooking, compact = false) => (
    <div
      className={`bookingEvent status-${booking.status.toLowerCase().replaceAll(" ", "-")} ${compact ? "compact" : ""}`}
      key={booking.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(booking)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen(booking);
      }}
    >
      <div>
        <b>
          {booking.startTime}–{booking.endTime}
        </b>
        <span className="bookingStatus">{booking.status}</span>
      </div>
      <strong>{booking.title}</strong>
      <small>
        {booking.roomName} · {booking.organizer}
      </small>
      {!compact && (
        <>
          <span>
            {booking.attendees} attendees · Buffer {booking.bufferBeforeMinutes}
            /{booking.bufferAfterMinutes} min
          </span>
          <div onClick={(event) => event.stopPropagation()}>
            <BookingActions
              booking={booking}
              currentUserId={currentUserId}
              canApprove={canApprove}
              ownerCanCancel={ownerCanCancel}
              onEdit={onEdit}
              onAction={onAction}
            />
          </div>
        </>
      )}
    </div>
  );

  if (view === "List") {
    return (
      <div className="tableWrap bookingList">
        <table>
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>Room</th>
              <th>Booking</th>
              <th>Organizer</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length ? (
              bookings.map((booking) => (
                <tr
                  key={booking.id}
                  className="bookingListRow"
                  onClick={() => onOpen(booking)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <b>{booking.localDate}</b>
                    <small>
                      {booking.startTime}–{booking.endTime}
                    </small>
                  </td>
                  <td>
                    {booking.station}
                    <small>{booking.roomName}</small>
                  </td>
                  <td>
                    <b>{booking.title}</b>
                    <small>{booking.purpose || "—"}</small>
                  </td>
                  <td>
                    {booking.organizer}
                    <small>{booking.attendees} attendees</small>
                  </td>
                  <td>
                    <span
                      className={`bookingStatus status-${booking.status.toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {booking.status}
                    </span>
                  </td>
                  <td>
                    <BookingActions
                      booking={booking}
                      currentUserId={currentUserId}
                      canApprove={canApprove}
                      ownerCanCancel={ownerCanCancel}
                      onEdit={onEdit}
                      onAction={onAction}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No booking found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === "Day") {
    const rows = byDate(anchor);
    return (
      <div className="bookingDay">
        <div className="bookingDateHeading">
          <strong>
            {new Date(`${anchor}T00:00:00`).toLocaleDateString("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </strong>
          <span>{rows.length} booking</span>
        </div>
        {rows.length ? (
          rows.map((booking) => card(booking))
        ) : (
          <EmptyState text="Belum ada booking pada tanggal ini." />
        )}
      </div>
    );
  }

  if (view === "Week") {
    const first = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
    return (
      <div className="bookingWeek">
        {days.map((day) => {
          const value = dateValue(day);
          const rows = byDate(value);
          return (
            <section
              key={value}
              className={value === localToday() ? "today" : ""}
            >
              <header>
                <b>{day.toLocaleDateString("id-ID", { weekday: "short" })}</b>
                <span>{day.getDate()}</span>
              </header>
              <div>
                {rows.length ? (
                  rows.map((booking) => card(booking, true))
                ) : (
                  <small>—</small>
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  const selected = new Date(`${anchor}T00:00:00`);
  const firstMonthDay = new Date(
    selected.getFullYear(),
    selected.getMonth(),
    1,
  );
  const gridStart = startOfWeek(dateValue(firstMonthDay));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  return (
    <div className="bookingMonth">
      <div className="bookingWeekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <b key={day}>{day}</b>
        ))}
      </div>
      <div className="bookingMonthGrid">
        {days.map((day) => {
          const value = dateValue(day);
          const rows = byDate(value);
          return (
            <section
              key={value}
              className={`${day.getMonth() !== selected.getMonth() ? "outside" : ""} ${value === localToday() ? "today" : ""}`}
            >
              <header>{day.getDate()}</header>
              <div>
                {rows.slice(0, 3).map((booking) => card(booking, true))}
                {rows.length > 3 && <small>+{rows.length - 3} more</small>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BookingActions({
  booking,
  currentUserId,
  canApprove,
  ownerCanCancel,
  onEdit,
  onAction,
}: {
  booking: RoomBooking;
  currentUserId: string;
  canApprove: boolean;
  ownerCanCancel: boolean;
  onEdit: (booking: RoomBooking) => void;
  onAction: (
    booking: RoomBooking,
    action: "submit" | "approve" | "reject" | "cancel",
  ) => void;
}) {
  const owner = booking.createdBy === currentUserId;
  return (
    <div className="bookingActions">
      {booking.status === "Draft" && (owner || canApprove) && (
        <>
          <button type="button" onClick={() => onEdit(booking)}>
            Edit
          </button>
          <button type="button" onClick={() => onAction(booking, "submit")}>
            Submit
          </button>
        </>
      )}
      {booking.status === "Requested" && canApprove && (
        <>
          <button type="button" onClick={() => onEdit(booking)}>
            Edit
          </button>
          <button type="button" onClick={() => onAction(booking, "approve")}>
            Approve
          </button>
          <button type="button" onClick={() => onAction(booking, "reject")}>
            Reject
          </button>
        </>
      )}
      {booking.status === "Approved" && canApprove && (
        <button type="button" onClick={() => onEdit(booking)}>
          Edit
        </button>
      )}
      {["Draft", "Requested", "Approved"].includes(booking.status) &&
        (canApprove ||
          (owner && (booking.status === "Draft" || ownerCanCancel))) && (
          <button type="button" onClick={() => onAction(booking, "cancel")}>
            Cancel
          </button>
        )}
    </div>
  );
}

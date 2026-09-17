"use client";
import { FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Link from "next/link";
import { browserLocalPersistence, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, setPersistence, signInWithEmailAndPassword, signOut, updatePassword, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "../lib/firebase/client";
import { completePasswordChange, createManagedUser, createVisitor, importManagedUsers, resolveUsername, syncSourceLounges, updateManagedUser } from "../lib/firebase/api";
import { removeRecord, saveRecord, subscribeCollection } from "../lib/firebase/repository";
import { uploadEvidence } from "../lib/firebase/evidence";

type Eligibility = "Y" | "N" | "";
type MainTab = "dashboard" | "dashboard-detail" | "access" | "reconciliation" | "flights" | "master";
type Visitor = {
  id: string;
  date: string;
  time: string;
  airport: string;
  lounge: string;
  name: string;
  flight: string;
  route: string;
  cabin: string;
  seat: string;
  seq: string;
  ticket: string;
  eligible: "Y" | "N";
  category: string;
  reference: string;
  currency: string;
  price: number;
  source: string;
  boStatus: "Pending" | "Accepted" | "Rejected";
  boReason: string;
  vendorStatus: "Pending" | "Confirmed" | "Rejected";
  travelDate?: string;
  scanTimestamp?: string;
  dateSource?: "Barcode" | "Schedule" | "Manual" | "Selected";
  companionCount?: number;
  companionCategory?: string;
  companionMembership?: string;
  verifier?: string;
  disputeCode?: string;
  evidenceName?: string;
  evidenceUrl?: string;
  reconciliationStatus?: "Open" | "Final";
  rawScan?: string;
  normalizedScan?: string;
  verifierOrganization?: string;
  parentVisitorId?: string;
  exceptionalStatus?: "Not Requested" | "Requested" | "Granted" | "Rejected";
  evidenceType?: "Boarding Pass" | "Membership Card" | "Other";
  evidenceUploadedAt?: string;
  reportRevision?: number;
};
type CustomColumn = {
  id: string;
  label: string;
  type: "Text" | "Number" | "Date" | "Currency" | "Calculated";
  formula: string;
  visible: boolean;
};
type BuilderItem = {
  id: string;
  surface: string;
  labelId: string;
  labelEn: string;
  kind: "Menu" | "Tab" | "Text" | "Number" | "Currency" | "Date" | "Time" | "Dropdown" | "Searchable Dropdown" | "Checkbox" | "Attachment" | "Calculated";
  visible: boolean;
  required: boolean;
  locked: boolean;
};

const formulaFields = [
  "Passenger Name", "Flight Number", "Date of Travel", "Origin", "Destination",
  "Route", "Cabin Class", "Check-in Sequence", "Ticket Number", "Access Category",
  "Reference", "Companion Count", "Unit Price", "Final Status",
];
const formulaOperators = ["+", "-", "×", "÷", "^", "(", ")", ","];
const formulaFunctions = ["CONCAT", "SQRT", "ABS", "ROUND", "MIN", "MAX", "POWER"];

const builderSeed: BuilderItem[] = [
  { id: "menu-dashboard", surface: "Main Navigation", labelId: "Dashboard", labelEn: "Dashboard", kind: "Menu", visible: true, required: false, locked: true },
  { id: "menu-access", surface: "Main Navigation", labelId: "Lounge/Tenant Access", labelEn: "Lounge/Tenant Access", kind: "Menu", visible: true, required: true, locked: true },
  { id: "menu-visitor", surface: "Main Navigation", labelId: "Visitor & Reconciliation", labelEn: "Visitor & Reconciliation", kind: "Menu", visible: true, required: true, locked: true },
  { id: "menu-flight", surface: "Main Navigation", labelId: "Flight Information", labelEn: "Flight Information", kind: "Menu", visible: true, required: true, locked: true },
  { id: "menu-master", surface: "Main Navigation", labelId: "Master Data", labelEn: "Master Data", kind: "Menu", visible: true, required: true, locked: true },
  { id: "field-dot", surface: "Lounge/Tenant Access", labelId: "Date of Travel", labelEn: "Date of Travel", kind: "Date", visible: true, required: true, locked: true },
  { id: "field-passenger", surface: "Lounge/Tenant Access", labelId: "Nama Penumpang", labelEn: "Passenger Name", kind: "Text", visible: true, required: true, locked: true },
  { id: "field-flight", surface: "Lounge/Tenant Access", labelId: "Flight Number", labelEn: "Flight Number", kind: "Text", visible: true, required: true, locked: true },
  { id: "column-ffp", surface: "Verifier Review", labelId: "Nomor FFP/Membership", labelEn: "FFP/Membership Number", kind: "Text", visible: true, required: false, locked: true },
  { id: "column-price", surface: "Visitor List", labelId: "Harga/Pax", labelEn: "Price/Pax", kind: "Currency", visible: true, required: false, locked: true },
  { id: "column-status", surface: "Visitor List", labelId: "Status", labelEn: "Status", kind: "Dropdown", visible: true, required: true, locked: true },
];

const interfaceTranslations: Record<string, string> = {
  "Profil Saya": "My Profile", "Notifikasi": "Notifications", "Ganti Password": "Change Password",
  "Keluar": "Sign Out", "Masuk": "Sign In", "Nama Pengguna": "Username", "Kata Sandi": "Password",
  "Gunakan Input Manual": "Use Manual Input", "Mulai Scan Camera": "Start Camera Scan",
  "Aktifkan Device Scanner": "Activate Device Scanner", "Langkah 1": "Step 1", "Langkah 2–3": "Steps 2–3",
  "Preview & Konfirmasi": "Preview & Confirmation", "Nama Penumpang": "Passenger Name",
  "Nomor Penerbangan": "Flight Number", "Kelas Kabin": "Cabin Class", "Pilih kelas": "Select class",
  "Pilih lounge": "Select lounge", "Simpan & Konfirmasi": "Save & Confirm", "Batal": "Cancel",
  "Tutup": "Close", "Ubah": "Update", "Hapus": "Delete", "Arsipkan": "Archive", "Proses": "Process",
  "Semua": "All", "Semua Station": "All Stations", "Semua Airport": "All Airports",
  "Semua Status": "All Status", "Tidak ada pilihan yang sesuai": "No matching options",
  "data ditemukan": "records found", "Tambah Data": "Add Data", "Tambah Station": "Add Station",
  "Tambah Akun": "Add Account", "Unduh Template CSV": "Download CSV Template",
  "Upload CSV": "Upload CSV", "Informasi Penerbangan": "Flight Information",
  "Daftar Penerbangan": "Flight List", "Tanggal": "Date", "Periode": "Period",
  "Mulai Tanggal": "Start Date", "Sampai Tanggal": "End Date", "Waktu": "Time",
  "Status": "Status", "Aksi": "Action", "Harga/Pax": "Price/Pax", "Pendamping": "Companion",
  "Jumlah Pendamping": "Companion Count", "Kategori Pendamping": "Companion Category",
  "Nomor Membership Pendamping": "Companion Membership Number", "Lainnya": "Other",
  "Rekonsiliasi": "Reconciliation", "Laporan Rekonsiliasi": "Reconciliation Report",
  "Kelola Laporan": "Manage Report", "Kelola Tabel": "Manage Table", "Judul Laporan": "Report Title",
  "Template Nama File": "File Name Template", "Informasi di Atas Tabel": "Information Above Table",
  "Kolom Tabel": "Table Columns", "Nama Kolom": "Column Name", "Tipe Data": "Data Type",
  "Field Formula": "Formula Field", "Tambah Field": "Add Field", "Tambah Operator": "Add Operator",
  "Tambah Fungsi": "Add Function", "Bersihkan Formula": "Clear Formula", "Preview": "Preview",
  "Belum ada custom column.": "No custom columns yet.", "Kolom Inti Sistem": "Core System Fields",
  "Aktif": "Active", "Nonaktif": "Inactive", "Diterima": "Accepted", "Ditolak": "Rejected",
  "Menunggu": "Pending", "Kirim Ulang ke Verifier": "Resubmit to Verifier",
  "Konfirmasi dan Kirim Evidence": "Confirm and Submit Evidence", "Lampiran evidence": "Evidence attachment",
  "Alasan Penolakan": "Rejection Reason", "Ganti bahasa": "Change language",
  "Daftar Lounge/Tenant": "Lounge/Tenant List", "Data referensi dan rule operasional sesuai kewenangan pengguna.": "Reference data and operational rules based on user authority.",
  "Data Kunjungan": "Visitor Data", "Aktifkan Filter": "Activate Filter", "Filter Aktif": "Filter Active",
  "Periode mulai": "Start period", "Periode akhir": "End period", "Jam mulai": "Start time", "Jam akhir": "End time",
  "Rata-rata/jam": "Average/hour", "seluruh Branch Office": "all Branch Offices", "Total Biaya": "Total Cost",
  "Kategori penumpang": "Passenger Category", "Status visitor": "Visitor Status", "Nama / flight / lounge": "Name / flight / lounge",
  "Penumpang": "Passenger", "Rute": "Route", "Pembaruan": "Updated", "Kategori": "Category", "Referensi": "Reference",
  "Unduh CSV": "Download CSV", "Unduh PDF": "Download PDF", "Kosongkan Data Uji": "Clear Test Data",
  "Hak pengelolaan": "Management Authority", "Tambah Lounge": "Add Lounge", "Tambah User": "Add User",
  "Simpan & Terapkan Rule": "Save & Apply Rule", "Rule efektif": "Effective Rule", "Referensi Waktu": "Time Reference",
  "Waktu transaksi mengikuti station aktif. Pilih Date of Travel sebelum scan agar flight schedule yang diperiksa tepat.": "Transaction time follows the active station. Select Date of Travel before scanning to confirm the correct flight schedule.",
  "Berhasil": "Success", "Perhatian": "Attention", "Tidak dapat diproses": "Cannot be processed",
  "Ya, Hapus Data": "Yes, Delete Data", "Tambah & Konfirmasi": "Add & Confirm",
  "Belum diverifikasi": "Not verified", "Kedaluwarsa": "Expired", "hari tersisa": "days remaining",
  "OPERASIONAL AKSES": "OPERATIONAL ACCESS", "Scan boarding pass atau gunakan fallback input manual saat scanner terkendala.": "Scan the boarding pass or use manual input if the scanner is unavailable.",
  "Pilih DOT & Baca Boarding Pass": "Select DOT & Scan Boarding Pass", "Siap": "Ready",
  "Pilih tanggal penerbangan sebelum memulai scan.": "Select the Date of Travel before starting the scan.",
  "MENUNGGU SCAN": "WAITING FOR SCAN", "TIDAK ELIGIBLE": "NOT ELIGIBLE",
  "Nama sesuai boarding pass": "Name as shown on the boarding pass", "Kamera belum aktif": "Camera is not active",
  "Posisikan kode di dalam bingkai": "Position the code inside the frame", "Hentikan Kamera": "Stop Camera",
  "Device Scanner Aktif": "Device Scanner Active", "ATAU INPUT STRING": "OR ENTER STRING",
  "Hasil scan / string boarding pass": "Scanned result / boarding pass string",
  "Baca String dan Tampilkan Data": "Read String and Display Data", "Scanner atau barcode bermasalah?": "Scanner or barcode unavailable?",
  "Data yang ditolak BO dikembalikan kepada petugas lounge.": "Rejected data is returned to the Lounge Officer for correction.",
  "Belum ada data dispute.": "No dispute data.", "Menunggu Respons Lounge": "Waiting for Lounge Response",
  "Menunggu koreksi petugas lounge": "Waiting for correction by Lounge Officer",
  "Total hanya menghitung visitor Accepted sesuai filter aktif.": "Total includes only Accepted visitors within the active filters.",
  "Verifikasi, dispute, rekonsiliasi, laporan, dan sign-off BO–Vendor dalam satu proses.": "Verification, dispute, reconciliation, reporting, and BO–Vendor sign-off in one process.",
  "Pilih per pax atau sekaligus, kemudian tentukan diterima atau ditolak.": "Select passengers individually or in bulk, then accept or reject them.",
  "Traffic per jam, Date of Travel, status rekonsiliasi, dan biaya sesuai kewenangan akun.": "Hourly traffic, Date of Travel, reconciliation status, and cost based on account authority.",
  "Terima": "Accept", "LANGKAH 1": "STEP 1", "LANGKAH 2–3": "STEPS 2–3", "dd/mm/tttt": "dd/mm/yyyy",
};
const interfaceIdTranslations: Record<string, string> = {
  "Manage Table": "Kelola Tabel", "Manage Report": "Kelola Laporan", "Save & Confirm": "Simpan & Konfirmasi",
  "Cancel": "Batal", "Close": "Tutup", "Add & Confirm": "Tambah & Konfirmasi", "Update & Confirm": "Perbarui & Konfirmasi",
  "Search Visitor": "Cari Visitor", "Passenger Category": "Kategori Penumpang", "Visitor Status": "Status Visitor",
  "Start Date": "Tanggal Mulai", "End Date": "Tanggal Akhir", "All Date": "Semua Tanggal",
  "Import Passenger List": "Impor Passenger List", "Passenger List — Manual Import": "Passenger List — Impor Manual",
  "Waiting for Lounge Response": "Menunggu Respons Lounge", "No dispute data.": "Belum ada data dispute.",
  "Total Cost": "Total Biaya", "records found": "data ditemukan", "Change Password": "Ganti Password",
  "Management & Monitoring": "Manajemen & Monitoring", "Executive Summary": "Ringkasan Eksekutif",
  "Visitor Composition": "Komposisi Pengunjung", "Top 10 Branch Offices": "10 Branch Office Teratas",
  "Provider Cost Analysis": "Analisis Biaya Provider", "Total Passenger": "Total Penumpang",
  "Confirmed Lounge Visitor": "Pengunjung Lounge Terkonfirmasi", "Average Cost / Visitor": "Rata-rata Biaya / Pengunjung",
  "All Areas": "Semua Area", "All BO": "Semua BO", "All Providers": "Semua Provider",
  "Passenger Volume Template": "Template Passenger Volume", "Import Passenger Volume": "Impor Passenger Volume",
};
type ReportColumnKey = "dot" | "accessTime" | "station" | "passenger" | "flight" | "route" | "category" | "reference" | "guest" | "verifier" | "status" | "price";
type ReportConfig = {
  title: string;
  fileName: string;
  columns: ReportColumnKey[];
  metadata: string[];
  includeCost: boolean;
  includeEvidenceAppendix: boolean;
};
type Lounge = {
  id: string;
  airport: string;
  name: string;
  type: string;
  currency: string;
  price: number;
  start: string;
  end: string;
  status: string;
};
type FlightStatus =
  "Scheduled" | "Delayed" | "Rescheduled" | "Postponed" | "Cancelled";
type Flight = {
  id: string;
  date: string;
  flight: string;
  origin: string;
  destination: string;
  std: string;
  etd: string;
  capacity?: string;
  status: FlightStatus;
  updatedBy: string;
  updatedAt: string;
};
type Account = {
  id: string;
  name: string;
  username: string;
  email?: string;
  password: string;
  role: "Super Admin" | "Admin" | "HO Admin" | "BO Admin" | "Lounge Officer" | "Lounge Manager" | "HO Ancillary Coordinator" | "HO Ancillary Verifier" | "Airline Coordinator" | "Airline Verifier" | "Report Viewer";
  station: string;
  scope: string;
  organization: string;
  verificationScopes: string[];
  status: "Aktif" | "Nonaktif";
  mustChangePassword?: boolean;
};
type Station = {
  code: string;
  name: string;
  timeZone: string;
  utcLabel: string;
  status: "Aktif" | "Nonaktif";
};
type Partnership = {
  id: string;
  type: string;
  name: string;
  reference: string;
  status: string;
  allowedRoles: string[];
  verifierOrganization: string;
  eligibleTiers: string;
  effectiveStart: string;
  effectiveEnd: string;
  stationScope: string;
  payer: string;
  priceRule: string;
  companionRule: string;
  apiReferenceFields: string;
  version: number;
};

type PermissionAction = "View" | "Add" | "Edit" | "Delete" | "Verify" | "Override" | "Download" | "Manage";
type RoleProfile = { role: Account["role"]; permissions: PermissionAction[]; scope: string };
type IntegrationStatus = {
  id: string; name: string; mode: "Mock" | "Live"; status: "Ready" | "Attention" | "Not Connected";
  lastSync: string; dataOwner: string; technicalOwner: string; fallback: string;
};
type Airline = { code: string; name: string; verifierOrganization: string; status: "Active" | "Inactive" };
type VerificationColumnKey = "passenger" | "flight" | "dot" | "ffpNumber" | "tier" | "verifier" | "evidence" | "price" | "status";
type DashboardWidget = {
  id: "summary" | "trend" | "composition" | "utilization" | "topBo" | "providerCost" | "workflow";
  titleId: string;
  titleEn: string;
  visible: boolean;
  roles: Account["role"][];
};
type MonitoringRow = {
  id: string; period: string; area: string; bo: string; station: string; provider: string;
  businessPax: number; economyPax: number; businessLounge: number; platinum: number;
  elitePlus: number; skyteam: number; partnership: number; dpr: number; paidAccess: number;
  other: number; unitPrice: number; source: "API/DCS" | "BO Import" | "Manual" | "Sample";
};

const partnershipSeed: Partnership[] = [
  { id: "p0", type: "Membership", name: "GarudaMiles Platinum", reference: "API membership / verifikasi HO Ancillary", status: "Aktif", allowedRoles: ["Super Admin", "Admin", "HO Ancillary Verifier", "Lounge Officer"], verifierOrganization: "HO Ancillary", eligibleTiers: "Platinum", effectiveStart: "2026-01-01", effectiveEnd: "2027-12-31", stationScope: "ALL", payer: "Garuda Indonesia", priceRule: "Lounge unit price", companionRule: "1 companion; linked to Parent Visitor ID", apiReferenceFields: "memberNumber,tier,status", version: 1 },
  { id: "p1", type: "Partnership", name: "Kerjasama MPA", reference: "Nomor agreement wajib", status: "Aktif", allowedRoles: ["Super Admin", "Admin", "Airline Verifier", "Lounge Officer"], verifierOrganization: "Designated Airline Representative", eligibleTiers: "As agreement", effectiveStart: "2026-01-01", effectiveEnd: "2027-12-31", stationScope: "Configured stations", payer: "Partner Airline", priceRule: "Agreement price", companionRule: "As agreement", apiReferenceFields: "agreementNumber,passengerStatus", version: 1 },
  { id: "p2", type: "EMD", name: "EMD Lounge Access", reference: "Validasi dan redemption coupon", status: "Aktif", allowedRoles: ["Super Admin", "Admin", "HO Ancillary Verifier", "Lounge Officer"], verifierOrganization: "HO Ancillary", eligibleTiers: "Valid coupon", effectiveStart: "2026-01-01", effectiveEnd: "2027-12-31", stationScope: "ALL", payer: "Passenger/Issuer", priceRule: "EMD amount", companionRule: "Not included", apiReferenceFields: "emdNumber,couponStatus,amount", version: 1 },
  { id: "p3", type: "Paid Access", name: "Paid Access", reference: "Menunggu payment integration", status: "Nonaktif", allowedRoles: ["Super Admin", "Admin", "HO Ancillary Verifier", "Lounge Officer"], verifierOrganization: "HO Ancillary", eligibleTiers: "Paid", effectiveStart: "2026-01-01", effectiveEnd: "2027-12-31", stationScope: "Configured stations", payer: "Passenger", priceRule: "Published price", companionRule: "Separate purchase", apiReferenceFields: "paymentId,paymentStatus,amount", version: 1 },
];
const roleProfileSeed: RoleProfile[] = [
  { role: "Super Admin", permissions: ["View", "Add", "Edit", "Delete", "Verify", "Override", "Download", "Manage"], scope: "All organizations, stations, programs" },
  { role: "Admin", permissions: ["View", "Add", "Edit", "Delete", "Verify", "Download", "Manage"], scope: "Operational configuration; approve reopen" },
  { role: "HO Admin", permissions: ["View", "Download"], scope: "All stations; monitoring" },
  { role: "BO Admin", permissions: ["View", "Add", "Edit", "Verify", "Download"], scope: "Assigned station; Business Class and VIP/CIP/VVIP" },
  { role: "Lounge Officer", permissions: ["View", "Add", "Edit", "Download"], scope: "Assigned lounge; input and evidence" },
  { role: "Lounge Manager", permissions: ["View", "Verify", "Download"], scope: "Assigned lounge; exceptional access" },
  { role: "HO Ancillary Coordinator", permissions: ["View", "Edit", "Download", "Manage"], scope: "HO Ancillary products" },
  { role: "HO Ancillary Verifier", permissions: ["View", "Verify", "Download"], scope: "GarudaMiles, EMD and Paid Access" },
  { role: "Airline Coordinator", permissions: ["View", "Edit", "Download", "Manage"], scope: "Assigned airline/program" },
  { role: "Airline Verifier", permissions: ["View", "Verify", "Download"], scope: "Assigned airline passengers only" },
  { role: "Report Viewer", permissions: ["View", "Download"], scope: "Configured reports only" },
];
const integrationSeed: IntegrationStatus[] = [
  { id: "flight", name: "Flight Schedule", mode: "Mock", status: "Not Connected", lastSync: "—", dataOwner: "Flight Operations", technicalOwner: "IT Integration", fallback: "CSV/XLSX import + manual flight" },
  { id: "pax", name: "Passenger List / DCS", mode: "Mock", status: "Not Connected", lastSync: "—", dataOwner: "Airport Operations", technicalOwner: "IT Integration", fallback: "Mapped CSV/XLSX import with preview" },
  { id: "gm", name: "GarudaMiles Membership", mode: "Mock", status: "Ready", lastSync: "Simulation", dataOwner: "HO Ancillary", technicalOwner: "IT Integration", fallback: "Manual verification + evidence" },
  { id: "emd", name: "EMD Lounge", mode: "Mock", status: "Ready", lastSync: "Simulation", dataOwner: "HO Ancillary", technicalOwner: "IT Integration", fallback: "Manual EMD verification" },
  { id: "partner", name: "Partner Airline / SkyTeam", mode: "Mock", status: "Attention", lastSync: "Simulation", dataOwner: "Partner Airline", technicalOwner: "IT Integration", fallback: "Scoped airline verifier" },
  { id: "payment", name: "Paid Access Payment", mode: "Mock", status: "Not Connected", lastSync: "—", dataOwner: "Commercial", technicalOwner: "IT Integration", fallback: "Receipt evidence" },
  { id: "evidence", name: "Evidence Storage", mode: "Mock", status: "Ready", lastSync: "Local prototype", dataOwner: "Operations", technicalOwner: "IT Infrastructure", fallback: "Metadata-only prototype" },
  { id: "notification", name: "Notification Service", mode: "Mock", status: "Ready", lastSync: "Simulation", dataOwner: "Operations", technicalOwner: "IT Integration", fallback: "In-app inbox" },
];
const airlineSeed: Airline[] = [
  { code: "GA", name: "Garuda Indonesia", verifierOrganization: "Garuda Indonesia", status: "Active" },
  { code: "KE", name: "Korean Air", verifierOrganization: "Korean Air", status: "Active" },
  { code: "KL", name: "KLM Royal Dutch Airlines", verifierOrganization: "KLM", status: "Active" },
  { code: "AF", name: "Air France", verifierOrganization: "Air France", status: "Active" },
  { code: "SV", name: "Saudia", verifierOrganization: "Saudia", status: "Active" },
];
const verificationColumnOptions: { key: VerificationColumnKey; label: string }[] = [
  { key: "passenger", label: "Passenger" }, { key: "flight", label: "Flight / Route" }, { key: "dot", label: "Date of Travel" },
  { key: "ffpNumber", label: "FFP / Membership Number" }, { key: "tier", label: "Tier / Product" }, { key: "verifier", label: "Verifier Organization" },
  { key: "evidence", label: "Evidence" }, { key: "price", label: "Price/Pax" }, { key: "status", label: "Status" },
];
const dashboardWidgetSeed: DashboardWidget[] = [
  { id: "summary", titleId: "Ringkasan Eksekutif", titleEn: "Executive Summary", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "trend", titleId: "Tren Jumlah Pengunjung Lounge", titleEn: "Lounge Visitor Trend", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "composition", titleId: "Komposisi Pengunjung", titleEn: "Visitor Composition", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "utilization", titleId: "Lounge Utilization", titleEn: "Lounge Utilization", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "topBo", titleId: "10 BO dengan Pengunjung Terbanyak", titleEn: "Top 10 BO by Lounge Visitors", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "providerCost", titleId: "Analisis Biaya Provider", titleEn: "Provider Cost Analysis", visible: true, roles: ["Super Admin", "Admin", "HO Admin", "Report Viewer"] },
  { id: "workflow", titleId: "Status Verifikasi & Rekonsiliasi", titleEn: "Verification & Reconciliation Status", visible: true, roles: ["Super Admin", "Admin", "HO Admin"] },
];
const monitoringSeed: MonitoringRow[] = [
  { id: "m1", period: "2026-08", area: "West Indonesia", bo: "CGK", station: "CGK", provider: "Garuda Indonesia Executive Lounge T3", businessPax: 12500, economyPax: 88500, businessLounge: 7380, platinum: 2140, elitePlus: 1270, skyteam: 680, partnership: 420, dpr: 95, paidAccess: 315, other: 140, unitPrice: 102800, source: "Sample" },
  { id: "m2", period: "2026-08", area: "East Indonesia", bo: "DPS", station: "DPS", provider: "Garuda Indonesia Executive Lounge DPS", businessPax: 4260, economyPax: 36400, businessLounge: 2510, platinum: 810, elitePlus: 440, skyteam: 390, partnership: 185, dpr: 35, paidAccess: 105, other: 60, unitPrice: 385000, source: "Sample" },
  { id: "m3", period: "2026-08", area: "West Indonesia", bo: "KNO", station: "KNO", provider: "Plaza Premium Lounge KNO", businessPax: 2820, economyPax: 25100, businessLounge: 1530, platinum: 520, elitePlus: 275, skyteam: 90, partnership: 75, dpr: 18, paidAccess: 34, other: 22, unitPrice: 190000, source: "Sample" },
  { id: "m4", period: "2026-08", area: "East Indonesia", bo: "SUB", station: "SUB", provider: "Concordia Lounge SUB", businessPax: 2980, economyPax: 27800, businessLounge: 1460, platinum: 610, elitePlus: 302, skyteam: 82, partnership: 76, dpr: 21, paidAccess: 42, other: 25, unitPrice: 107651, source: "Sample" },
  { id: "m5", period: "2026-08", area: "East Indonesia", bo: "UPG", station: "UPG", provider: "Concordia Lounge UPG", businessPax: 2310, economyPax: 21400, businessLounge: 1190, platinum: 470, elitePlus: 236, skyteam: 62, partnership: 51, dpr: 15, paidAccess: 27, other: 19, unitPrice: 107651, source: "Sample" },
  { id: "m6", period: "2026-08", area: "West Indonesia", bo: "BPN", station: "BPN", provider: "Blue Sky Lounge BPN", businessPax: 1910, economyPax: 18700, businessLounge: 995, platinum: 360, elitePlus: 204, skyteam: 44, partnership: 47, dpr: 12, paidAccess: 21, other: 15, unitPrice: 107651, source: "Sample" },
  { id: "m7", period: "2026-08", area: "Asia", bo: "SIN", station: "SIN", provider: "SATS Premier Lounge", businessPax: 1720, economyPax: 14200, businessLounge: 1040, platinum: 318, elitePlus: 191, skyteam: 176, partnership: 84, dpr: 4, paidAccess: 0, other: 20, unitPrice: 420000, source: "Sample" },
  { id: "m8", period: "2026-08", area: "Asia", bo: "KUL", station: "KUL", provider: "Plaza Premium Lounge KUL", businessPax: 1480, economyPax: 12800, businessLounge: 870, platinum: 289, elitePlus: 154, skyteam: 132, partnership: 69, dpr: 3, paidAccess: 0, other: 17, unitPrice: 580000, source: "Sample" },
  { id: "m9", period: "2026-08", area: "MEA", bo: "JED", station: "JED", provider: "Plaza Premium Lounge JED", businessPax: 1320, economyPax: 11800, businessLounge: 760, platinum: 205, elitePlus: 129, skyteam: 118, partnership: 96, dpr: 5, paidAccess: 0, other: 13, unitPrice: 690000, source: "Sample" },
  { id: "m10", period: "2026-08", area: "Europe", bo: "AMS", station: "AMS", provider: "KLM Crown Lounge", businessPax: 1120, economyPax: 10200, businessLounge: 705, platinum: 188, elitePlus: 116, skyteam: 208, partnership: 65, dpr: 2, paidAccess: 0, other: 11, unitPrice: 750000, source: "Sample" },
];
const stationSeed: Station[] = [
  { code: "CGK", name: "Soekarno-Hatta", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" },
  { code: "DJB", name: "Sultan Thaha", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" },
  { code: "SUB", name: "Juanda", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" },
  { code: "DPS", name: "I Gusti Ngurah Rai", timeZone: "Asia/Makassar", utcLabel: "UTC+8", status: "Aktif" },
  { code: "UPG", name: "Sultan Hasanuddin", timeZone: "Asia/Makassar", utcLabel: "UTC+8", status: "Aktif" },
  { code: "DJJ", name: "Sentani", timeZone: "Asia/Jayapura", utcLabel: "UTC+9", status: "Aktif" },
];
const disputeCodes = [
  "01 — Name mismatch",
  "02 — Membership not active",
  "03 — Membership tier not eligible",
  "04 — EMD invalid",
  "05 — EMD already used",
  "06 — Payment not found",
  "07 — Flight/route/date mismatch",
  "08 — Duplicate visitor",
  "09 — Service not provided",
  "10 — Supporting document incomplete",
  "11 — Price/category mismatch",
  "12 — Other airline confirmation required",
];
type SortState = { key: string; direction: "asc" | "desc" };

function sortData<T>(rows: T[], sort: SortState, getter: (row: T, key: string) => string | number) {
  return [...rows].sort((a, b) => {
    const av = getter(a, sort.key), bv = getter(b, sort.key);
    const result = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "id", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}
function nextSort(current: SortState, key: string): SortState {
  return { key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" };
}
const localDate = (timeZone = "Asia/Jakarta") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function localClock(timeZone: string, language: "ID" | "EN") {
  return new Intl.DateTimeFormat(language === "EN" ? "en-GB" : "id-ID", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateFromJulian(day: string, referenceDate: string) {
  if (!/^\d{3}$/.test(day)) return "";
  const refYear = Number(referenceDate.slice(0, 4));
  const candidates = [refYear - 1, refYear, refYear + 1].map((year) => {
    const d = new Date(Date.UTC(year, 0, Number(day)));
    return d.toISOString().slice(0, 10);
  });
  return candidates.sort((a, b) =>
    Math.abs(new Date(a).getTime() - new Date(referenceDate).getTime()) -
    Math.abs(new Date(b).getTime() - new Date(referenceDate).getTime()),
  )[0];
}
const seed: Lounge[] = [
  {
    id: "1",
    airport: "CGK",
    name: "Garuda Indonesia Executive Lounge T3 Domestik",
    type: "Lounge",
    currency: "IDR",
    price: 350000,
    start: "2026-01-01",
    end: "2026-12-31",
    status: "Aktif",
  },
  {
    id: "2",
    airport: "DPS",
    name: "Garuda Indonesia Executive Lounge DPS",
    type: "Lounge",
    currency: "IDR",
    price: 385000,
    start: "2026-01-01",
    end: "2027-12-31",
    status: "Aktif",
  },
  {
    id: "3",
    airport: "KUL",
    name: "Plaza Premium Lounge KUL",
    type: "Mitra",
    currency: "MYR",
    price: 165,
    start: "2026-01-01",
    end: "2026-11-30",
    status: "Aktif",
  },
  {
    id: "4",
    airport: "DJB",
    name: "Lounge/Tenant DJB (Data Uji)",
    type: "Lounge",
    currency: "IDR",
    price: 0,
    start: "2026-01-01",
    end: "2027-12-31",
    status: "Aktif",
  },
  {
    id: "5",
    airport: "CGK",
    name: "Garuda Indonesia Executive Lounge T3 Internasional",
    type: "Lounge",
    currency: "IDR",
    price: 350000,
    start: "2026-01-01",
    end: "2027-12-31",
    status: "Aktif",
  },
];
const flightSeed: Flight[] = [
  {
    id: "f1",
    date: localDate(),
    flight: "GA127",
    origin: "CGK",
    destination: "MEL",
    std: "09:30",
    etd: "09:30",
    capacity: "26C 367Y",
    status: "Scheduled",
    updatedBy: "System Schedule",
    updatedAt: "Auto-sync",
  },
  {
    id: "f2",
    date: localDate(),
    flight: "GA127",
    origin: "DJB",
    destination: "CGK",
    std: "10:10",
    etd: "10:10",
    capacity: "12C 150Y",
    status: "Scheduled",
    updatedBy: "System Schedule",
    updatedAt: "Auto-sync",
  },
  {
    id: "f3",
    date: localDate(),
    flight: "GA204",
    origin: "CGK",
    destination: "JOG",
    std: "08:40",
    etd: "09:25",
    capacity: "12C 150Y",
    status: "Delayed",
    updatedBy: "BO Admin CGK",
    updatedAt: "06:15",
  },
  {
    id: "f4",
    date: addDays(localDate(), 1),
    flight: "GA164",
    origin: "CGK",
    destination: "DPS",
    std: "01:00",
    etd: "01:00",
    capacity: "12C 150Y",
    status: "Scheduled",
    updatedBy: "System Schedule",
    updatedAt: "Auto-sync",
  },
];
const cats = [
  "Business Class",
  "VIP/CIP/VVIP",
  "Platinum",
  "Elite Plus",
  "Gold Privilege",
  "Elite",
  "GPS",
  "Kerjasama MPA",
  "EMD",
  "Paid Access",
  "Partner Airline / SkyTeam",
  "DPR",
  "Irregular Passenger",
].sort((a, b) => a.localeCompare(b));
const reportColumnOptions: { key: ReportColumnKey; label: string }[] = [
  { key: "dot", label: "Date of Travel" },
  { key: "accessTime", label: "Access Date & Time" },
  { key: "station", label: "Station" },
  { key: "passenger", label: "Passenger Name" },
  { key: "flight", label: "Flight Number" },
  { key: "route", label: "Route" },
  { key: "category", label: "Access Category" },
  { key: "reference", label: "Reference / Membership" },
  { key: "guest", label: "Companion" },
  { key: "verifier", label: "Verifier" },
  { key: "status", label: "Final Status" },
  { key: "price", label: "Price / Cost" },
];
const cash = (n: number, c: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(n);
function splitRoute(route: string) {
  const [origin = "", destination = ""] = route.toUpperCase().trim().split(/\s*(?:–|—|-|\/|>)\s*/).filter(Boolean);
  return { origin, destination };
}
function flightOperatorCode(flightNumber: string) {
  return flightNumber.toUpperCase().trim().match(/^([A-Z0-9]{2})(?=\s*\d)/)?.[1] || "";
}
async function imageDataUrl(path: string) {
  const blob = await fetch(path).then((r) => r.blob());
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function parse(raw: string) {
  const normalized = raw.replace(/[\u0000-\u001F\u007F]/g, "").trimEnd(),
    text = normalized.toUpperCase(),
    leg = text.match(
      /([A-Z]{3})([A-Z]{3})([A-Z0-9]{2})\s*(\d{4,5})\s*(\d{3})([A-Z])([0-9]{3}[A-Z])([0-9]{4,5})/,
    ),
    ticket = text.match(/2A(\d{13,14})/),
    finalToken = text.split(/\s+/).filter(Boolean).at(-1) || "",
    tailEligible = /^YA*$/i.test(finalToken);
  if (text.startsWith("M1") && leg) {
    const rawName = text.slice(2, leg.index).trim().split(/\s+/)[0],
      names = rawName.split("/");
    return {
      name: names.length > 1 ? `${names[1]} ${names[0]}` : rawName,
      flight: `${leg[3]}${Number(leg[4])}`,
      route: `${leg[1]}–${leg[2]}`,
      cabin: leg[6],
      seat: leg[7].replace(/^0+/, ""),
      seq: String(Number(leg[8])),
      ticket: ticket?.[1] || "",
      julianDay: leg[5],
      eligible: (tailEligible ? "Y" : "N") as Eligibility,
      normalized,
    };
  }
  const p = text
      .split(/[|;,\n]+/)
      .map((x) => x.trim())
      .filter(Boolean),
    k: Record<string, string> = {};
  p.forEach((x) => {
    const y = x.split(/[:=]/);
    if (y.length > 1)
      k[y[0].toLowerCase().replace(/\s/g, "")] = y.slice(1).join(":").trim();
  });
  const eligibility = (k.eligible || k.eligibility || finalToken).trim().toUpperCase();
  return {
    name: k.name || k.nama || k.passenger || p[0] || "",
    flight: (k.flight || k.penerbangan || p[1] || "").toUpperCase(),
    route: k.route || k.rute || "",
    cabin: k.cabin || k.kelas || "",
    seat: k.seat || k.kursi || "",
    seq: k.sequence || k.seq || k.urutan || p[2] || "",
    ticket: k.ticket || k.tiket || "",
    julianDay: k.julianday || k.dateofflight || "",
    eligible: (/^YA*$/i.test(eligibility) ? "Y" : "N") as Eligibility,
    normalized,
  };
}

export default function Home() {
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null),
    [firebaseUser, setFirebaseUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!auth || !db),
    [loginUser, setLoginUser] = useState(""),
    [loginPassword, setLoginPassword] = useState(""),
    [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<MainTab>("access"),
    [lounges, setLounges] = useState<Lounge[]>([]),
    [visitors, setVisitors] = useState<Visitor[]>([]),
    [flights, setFlights] = useState<Flight[]>([]);
  const [reconTab, setReconTab] = useState("Visitor List"),
    [flightTab, setFlightTab] = useState("Daily Flight"),
    [masterTab, setMasterTab] = useState("Master Lounge/Tenant");
  const [accessWindow, setAccessWindow] = useState(4),
    [manualVerificationSla, setManualVerificationSla] = useState(30),
    [evidenceBoRetention, setEvidenceBoRetention] = useState(3),
    [evidenceAdminRetention, setEvidenceAdminRetention] = useState(30),
    [ruleScope, setRuleScope] = useState("Semua BO"),
    [memberMode, setMemberMode] = useState("Hybrid"),
    [selectedBO, setSelectedBO] = useState(["CGK", "DPS"]),
    [ruleSaved, setRuleSaved] = useState(false);
  const [season, setSeason] = useState({
      flight: "GA204",
      origin: "CGK",
      destination: "JOG",
      start: localDate(),
      end: "2026-10-31",
      days: "1357",
      std: "08:30",
      capacity: "12C 150Y",
    }),
    [seasonNotice, setSeasonNotice] = useState("");
  const [boSigner, setBoSigner] = useState(""),
    [vendorSigner, setVendorSigner] = useState(""),
    [boSigned, setBoSigned] = useState(false),
    [vendorSigned, setVendorSigned] = useState(false);
  const [memberStatus, setMemberStatus] = useState("Belum diverifikasi"),
    [partnerRef, setPartnerRef] = useState("");
  const [role, setRole] = useState<Account["role"]>("Super Admin"),
    [station, setStation] = useState("CGK"),
    [flightFilter, setFlightFilter] = useState("Semua"),
    [flightStatusFilter, setFlightStatusFilter] = useState("Semua"),
    [flightQuery, setFlightQuery] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]),
    [partnerships, setPartnerships] = useState<Partnership[]>([]),
    [airlines, setAirlines] = useState<Airline[]>([]),
    [stations, setStations] = useState<Station[]>([]),
    [masterQuery, setMasterQuery] = useState(""),
    [masterSelect, setMasterSelect] = useState("Semua"),
    [masterSelect2, setMasterSelect2] = useState("Semua");
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>(roleProfileSeed),
    [integrations] = useState<IntegrationStatus[]>(integrationSeed),
    [showManageRole, setShowManageRole] = useState(false),
    [showIntegrationStatus, setShowIntegrationStatus] = useState(false),
    [showEligibilityRules, setShowEligibilityRules] = useState(false),
    [masterTableTarget, setMasterTableTarget] = useState<string | null>(null),
    [reopenStatus, setReopenStatus] = useState<"Closed" | "Requested" | "Approved">("Closed");
  const [builderItems, setBuilderItems] = useState<BuilderItem[]>(builderSeed),
    [builderSurface, setBuilderSurface] = useState("Main Navigation"),
    [builderDraft, setBuilderDraft] = useState<BuilderItem>({ id: "", surface: "Visitor List", labelId: "", labelEn: "", kind: "Text", visible: true, required: false, locked: false }),
    [builderNotice, setBuilderNotice] = useState(""),
    [portalSection, setPortalSection] = useState("Dashboard Manager"),
    [dashboardWidgets, setDashboardWidgets] = useState<DashboardWidget[]>(dashboardWidgetSeed),
    [dashboardAllowedRoles, setDashboardAllowedRoles] = useState<Account["role"][]>(["Super Admin", "Admin", "HO Admin", "Report Viewer"]),
    [languageFeatureEnabled, setLanguageFeatureEnabled] = useState(true),
    [monitoringRows, setMonitoringRows] = useState<MonitoringRow[]>([]),
    [dashboardPeriod, setDashboardPeriod] = useState("2026-08"),
    [dashboardArea, setDashboardArea] = useState("All Areas"),
    [dashboardBo, setDashboardBo] = useState("All BO"),
    [dashboardProvider, setDashboardProvider] = useState("All Providers"),
    [dashboardDetail, setDashboardDetail] = useState<"Business Pax" | "Economy Pax">("Business Pax"),
    [dashboardImportNotice, setDashboardImportNotice] = useState("");
  const [visitorSort, setVisitorSort] = useState<SortState>({ key: "date", direction: "desc" }),
    [flightSort, setFlightSort] = useState<SortState>({ key: "date", direction: "asc" }),
    [userSort, setUserSort] = useState<SortState>({ key: "name", direction: "asc" }),
    [activitySort, setActivitySort] = useState<SortState>({ key: "time", direction: "desc" }),
    [disputeSort, setDisputeSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [flightNotice, setFlightNotice] = useState(""),
    [passengerImportNotice, setPassengerImportNotice] = useState(""),
    [showAddFlight, setShowAddFlight] = useState(false),
    [editingFlight, setEditingFlight] = useState<string | null>(null),
    [newFlight, setNewFlight] = useState({
      flight: "",
      origin: "CGK",
      destination: "",
      date: localDate(),
      std: "",
      etd: "",
      capacity: "",
      status: "Scheduled" as FlightStatus,
    });
  const emptyPass = {
    name: "",
    flight: "",
    route: "",
    cabin: "",
    seat: "",
    seq: "",
    ticket: "",
    eligible: "" as Eligibility,
    julianDay: "",
    normalized: "",
    travelDate: "",
    dateSource: "" as "" | "Barcode" | "Schedule" | "Manual" | "Selected",
  };
  const [airport, setAirport] = useState("CGK"),
    [loungeId, setLoungeId] = useState("1"),
    [accessTravelDate, setAccessTravelDate] = useState(localDate()),
    [raw, setRaw] = useState(""),
    [pass, setPass] = useState(emptyPass),
    [rejected, setRejected] = useState<{
      reason:
        | "N"
        | "missing"
        | "airport"
        | "schedule"
        | "status"
        | "window"
        | "lounge";
      origin?: string;
      detail?: string;
    } | null>(null);
  const [category, setCategory] = useState("Business Class"),
    [reference, setReference] = useState(""),
    [notice, setNotice] = useState<{ kind: string; text: string } | null>(null),
    [camera, setCamera] = useState(false),
    [scanner, setScanner] = useState(false),
    [manualMode, setManualMode] = useState(false),
    [manualMember, setManualMember] = useState("Tidak Ada / Lainnya");
  const [companionCount, setCompanionCount] = useState(0),
    [companionCategory, setCompanionCategory] = useState("Lainnya"),
    [companionMembership, setCompanionMembership] = useState("");
  const [showLoungeForm, setShowLoungeForm] = useState(false),
    [editingLounge, setEditingLounge] = useState<string | null>(null),
    [loungeNotice, setLoungeNotice] = useState(""),
    [loungeDraft, setLoungeDraft] = useState<Omit<Lounge, "id">>({
      airport: "",
      name: "",
      type: "Lounge",
      currency: "IDR",
      price: 0,
      start: localDate(),
      end: "",
      status: "Aktif",
    });
  const [showUserForm, setShowUserForm] = useState(false),
    [savingUser, setSavingUser] = useState(false),
    [editingUser, setEditingUser] = useState<string | null>(null),
    [userDraft, setUserDraft] = useState<Omit<Account, "id">>({
      name: "", username: "", email: "", password: "", role: "BO Admin", station: "CGK", scope: "Station CGK", organization: "Branch Office CGK", verificationScopes: ["Business Class", "VIP/CIP/VVIP"], status: "Aktif",
    }),
    [showPartnershipForm, setShowPartnershipForm] = useState(false),
    [editingPartnership, setEditingPartnership] = useState<string | null>(null),
    [entitlementNotice, setEntitlementNotice] = useState(""),
    [partnershipDraft, setPartnershipDraft] = useState<Omit<Partnership, "id">>({
      type: "Partnership", name: "", reference: "", status: "Aktif", allowedRoles: ["Super Admin", "Admin"], verifierOrganization: "", eligibleTiers: "", effectiveStart: localDate(), effectiveEnd: "", stationScope: "ALL", payer: "", priceRule: "", companionRule: "", apiReferenceFields: "", version: 1,
    });
  const [filter, setFilter] = useState("Semua"),
    [visitorCategoryFilter, setVisitorCategoryFilter] = useState("Semua"),
    [visitorStatusFilter, setVisitorStatusFilter] = useState("All Status"),
    [visitorDateFrom, setVisitorDateFrom] = useState(""),
    [visitorDateTo, setVisitorDateTo] = useState(""),
    [visitorTimeFrom, setVisitorTimeFrom] = useState(""),
    [visitorTimeTo, setVisitorTimeTo] = useState(""),
    [reportLoungeFilter, setReportLoungeFilter] = useState("Semua"),
    [visitorFiltersActive, setVisitorFiltersActive] = useState(false),
    [query, setQuery] = useState(""),
    [edit, setEdit] = useState<Visitor | null>(null),
    [scanStatus, setScanStatus] = useState("");
  const [clockTick, setClockTick] = useState(0),
    [showInbox, setShowInbox] = useState(false),
    [showProfile, setShowProfile] = useState(false),
    [oldPassword, setOldPassword] = useState(""),
    [newPasswordValue, setNewPasswordValue] = useState(""),
    [confirmPasswordValue, setConfirmPasswordValue] = useState(""),
    [profileNotice, setProfileNotice] = useState(""),
    [deleteRequest, setDeleteRequest] = useState<null | { title: string; message: string; action: () => void }>(null),
    [flightDateFilter, setFlightDateFilter] = useState(localDate()),
    [evidenceVisitor, setEvidenceVisitor] = useState<Visitor | null>(null),
    [evidenceName, setEvidenceName] = useState(""),
    [evidenceFile, setEvidenceFile] = useState<File | null>(null),
    [evidenceType, setEvidenceType] = useState<Visitor["evidenceType"]>("Boarding Pass"),
    [stationDraft, setStationDraft] = useState<Station>({ code: "", name: "", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" }),
    [editingStation, setEditingStation] = useState<string | null>(null),
    [showStationForm, setShowStationForm] = useState(false),
    [stationNotice, setStationNotice] = useState(""),
    [airlineDraft, setAirlineDraft] = useState<Airline>({ code: "", name: "", verifierOrganization: "", status: "Active" }),
    [editingAirline, setEditingAirline] = useState<string | null>(null),
    [showAirlineForm, setShowAirlineForm] = useState(false),
    [airlineNotice, setAirlineNotice] = useState(""),
    [userUploadNotice, setUserUploadNotice] = useState(""),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [actionDialog, setActionDialog] = useState<null | { kind: "ok" | "error" | "warn"; text: string }>(null),
    [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState<"ID" | "EN">("ID"),
    [showProfileMenu, setShowProfileMenu] = useState(false),
    [showManageTable, setShowManageTable] = useState(false),
    [manageTableContext, setManageTableContext] = useState<"Visitor List" | "Verification">("Visitor List"),
    [verificationColumns, setVerificationColumns] = useState<VerificationColumnKey[]>(verificationColumnOptions.map((x) => x.key)),
    [showManageReport, setShowManageReport] = useState(false),
    [customColumns, setCustomColumns] = useState<CustomColumn[]>([]),
    [editingCustomColumn, setEditingCustomColumn] = useState<string | null>(null),
    [customColumnDraft, setCustomColumnDraft] = useState<CustomColumn>({ id: "", label: "", type: "Calculated", formula: "", visible: true }),
    [reportConfig, setReportConfig] = useState<ReportConfig>({
      title: "Reconciliation Report",
      fileName: "Reconciliation_Report_{Station}_{StartDate}_{EndDate}",
      columns: ["dot", "accessTime", "passenger", "flight", "route", "category", "reference", "verifier", "status"],
      metadata: ["Period", "Station", "Lounge/Tenant", "Airline/Payer", "Generated Date & Local Time"],
      includeCost: false,
      includeEvidenceAppendix: true,
    });
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    controls = useRef<IScannerControls | null>(null),
    buffer = useRef(""),
    keyTime = useRef(0),
    translatedNodesRef = useRef(new WeakMap<Text, string>()),
    translatedAttributesRef = useRef(new WeakMap<Element, Record<string, string>>());

  useEffect(() => {
    const translatedNodes = translatedNodesRef.current;
    const translatedAttributes = translatedAttributesRef.current;
    document.documentElement.lang = language === "EN" ? "en" : "id";
    const translateValue = (value: string) => {
      const dictionary = language === "EN" ? interfaceTranslations : interfaceIdTranslations;
      if (dictionary[value]) return dictionary[value];
      return Object.entries(dictionary)
        .sort(([a], [b]) => b.length - a.length)
        .reduce((result, [source, target]) => result.replaceAll(source, target), value);
    };
    const translate = (root: ParentNode) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        const parent = node.parentElement;
        if (parent && !["SCRIPT", "STYLE"].includes(parent.tagName)) {
          const original = translatedNodes.get(node) ?? node.data;
          translatedNodes.set(node, original);
          const trimmed = original.trim();
          const translated = translateValue(trimmed);
          node.data = translated !== trimmed ? original.replace(trimmed, translated) : original;
        }
        node = walker.nextNode() as Text | null;
      }
      root.querySelectorAll?.("[placeholder], [aria-label], [title]").forEach((element) => {
        const stored = translatedAttributes.get(element) ?? {};
        ["placeholder", "aria-label", "title"].forEach((attribute) => {
          const current = element.getAttribute(attribute);
          if (current != null && stored[attribute] == null) stored[attribute] = current;
          const original = stored[attribute];
          if (original != null) element.setAttribute(attribute, translateValue(original));
        });
        translatedAttributes.set(element, stored);
      });
    };
    translate(document.body);
    const observer = new MutationObserver(() => translate(document.body));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);
  useEffect(() => {
    if (!auth || !db) return;
    const activeAuth = auth, activeDb = db;
    return onAuthStateChanged(activeAuth, async (user) => {
      try {
        setFirebaseUser(user);
        if (!user) { setCurrentAccount(null); return; }
        const profile = await getDoc(doc(activeDb, "users", user.uid));
        if (!profile.exists() || profile.data().active !== true) { await signOut(activeAuth); return; }
        const data = profile.data();
        const account = { id: user.uid, password: "", status: "Aktif", ...data } as Account;
        setCurrentAccount(account);
        setRole(account.role);
        setStation(account.station === "ALL" ? "CGK" : account.station);
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("view") as MainTab | null;
        const allowedTabs: MainTab[] = ["access", "reconciliation", ...(account.role !== "Lounge Officer" ? ["flights" as MainTab] : []), ...(["Super Admin", "Admin", "HO Admin", "HO Ancillary Coordinator", "HO Ancillary Verifier"].includes(account.role) ? ["master" as MainTab] : []), ...(dashboardAllowedRoles.includes(account.role) ? ["dashboard" as MainTab, "dashboard-detail" as MainTab] : [])];
        setTab(requested && allowedTabs.includes(requested) ? requested : dashboardAllowedRoles.includes(account.role) ? "dashboard" : "access");
        if (params.get("master")) setMasterTab(params.get("master")!);
        if (params.get("recon")) setReconTab(params.get("recon")!);
        if (params.get("flight")) setFlightTab(params.get("flight")!);
        if (account.mustChangePassword) { setShowProfile(true); setProfileNotice("Silakan ganti password sementara sebelum melanjutkan."); }
      } finally {
        setAuthReady(true);
      }
    });
  }, [dashboardAllowedRoles]);
  useEffect(() => {
    if (!currentAccount) return;
    const syncLocation = () => {
      const params = new URLSearchParams(window.location.search);
      params.set("view", tab);
      if (tab === "master") params.set("master", masterTab); else params.delete("master");
      if (tab === "reconciliation") params.set("recon", reconTab); else params.delete("recon");
      if (tab === "flights") params.set("flight", flightTab); else params.delete("flight");
      window.history.replaceState({ view: tab }, "", `${window.location.pathname}?${params.toString()}`);
    };
    syncLocation();
  }, [currentAccount, tab, masterTab, reconTab, flightTab]);
  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("view") as MainTab | null;
      if (requested && ["dashboard", "dashboard-detail", "access", "reconciliation", "flights", "master"].includes(requested)) setTab(requested);
      if (params.get("master")) setMasterTab(params.get("master")!);
      if (params.get("recon")) setReconTab(params.get("recon")!);
      if (params.get("flight")) setFlightTab(params.get("flight")!);
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);
  useEffect(() => {
    if (!firebaseUser) return;
    const stops = [
      subscribeCollection<Visitor>("visitors", setVisitors),
      subscribeCollection<Lounge>("lounges", setLounges),
      subscribeCollection<Flight>("flights", setFlights),
      subscribeCollection<Account>("users", (rows) => setAccounts(rows.map((row) => ({ ...row, password: "", status: (row as unknown as { active?: boolean }).active === false ? "Nonaktif" : "Aktif" })))),
      subscribeCollection<Station>("stations", setStations),
      subscribeCollection<Partnership>("entitlements", setPartnerships),
      subscribeCollection<Airline>("airlines", setAirlines),
      subscribeCollection<MonitoringRow>("monitoringRows", setMonitoringRows),
    ];
    return () => stops.forEach((stop) => stop());
  }, [firebaseUser]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((x) => x + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const isGlobalAdmin = ["Super Admin", "Admin", "HO Admin", "HO Ancillary Coordinator", "HO Ancillary Verifier"].includes(role),
    canManageMaster = role === "Super Admin" || role === "Admin",
    canSeeDashboard = dashboardAllowedRoles.includes(role),
    canDeleteFlight = (f: Flight) =>
      isGlobalAdmin || (role === "BO Admin" && f.origin === station),
    canBOVerify = ["Super Admin", "Admin", "BO Admin", "HO Ancillary Verifier", "Airline Verifier"].includes(role),
    canVendorConfirm = role === "Lounge Officer" || role === "Lounge Manager";
  const activeStation = stations.find((x) => x.code === station) || stations[0],
    activeTimeZone = ["Super Admin", "Admin", "HO Admin", "HO Ancillary Coordinator", "HO Ancillary Verifier", "Airline Coordinator", "Airline Verifier", "Report Viewer"].includes(role)
      ? "Asia/Jakarta"
      : activeStation?.timeZone || "Asia/Jakarta",
    activeUtcLabel = ["Super Admin", "Admin", "HO Admin", "HO Ancillary Coordinator", "HO Ancillary Verifier", "Airline Coordinator", "Airline Verifier", "Report Viewer"].includes(role)
      ? "UTC+7"
      : activeStation?.utcLabel || "UTC+7",
    stationDate = localDate(activeTimeZone),
    displayClock = `${localClock(activeTimeZone, language)} · ${activeUtcLabel} · ${station}`;
  void clockTick;

  function askDelete(title: string, message: string, action: () => void) {
    setDeleteRequest({ title, message, action });
  }

  function moveBuilderItem(id: string, direction: -1 | 1) {
    setBuilderItems((items) => {
      const current = items.findIndex((item) => item.id === id);
      if (current < 0) return items;
      const sameSurface = items.map((item, index) => ({ item, index })).filter(({ item }) => item.surface === items[current].surface);
      const position = sameSurface.findIndex(({ index }) => index === current);
      const target = sameSurface[position + direction]?.index;
      if (target == null) return items;
      const copy = [...items];
      [copy[current], copy[target]] = [copy[target], copy[current]];
      return copy;
    });
  }

  function moveDashboardWidget(id: DashboardWidget["id"], direction: -1 | 1) {
    setDashboardWidgets((items) => {
      const current = items.findIndex((item) => item.id === id), target = current + direction;
      if (current < 0 || target < 0 || target >= items.length) return items;
      const copy = [...items]; [copy[current], copy[target]] = [copy[target], copy[current]]; return copy;
    });
  }

  function downloadPassengerVolumeTemplate() {
    const headers = ["Period", "Area", "BO", "Station", "Provider", "Business Pax", "Economy Pax", "Business Lounge", "Platinum", "Elite Plus", "SkyTeam", "Partnership", "DPR", "Paid Access", "Other", "Unit Price", "Source"];
    const sample = ["2026-08", "West Indonesia", "CGK", "CGK", "Garuda Indonesia Executive Lounge T3", "12500", "88500", "7380", "2140", "1270", "680", "420", "95", "315", "140", "102800", "BO Import"];
    const body = [headers, sample].map((row) => row.map((value) => `"${value}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" })); a.download = "template-passenger-volume-dashboard.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  async function uploadPassengerVolume(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const numberValue = (value: unknown) => Number(String(value).replace(/[^0-9.-]/g, "")) || 0;
      const incoming: MonitoringRow[] = [], errors: string[] = [];
      rows.forEach((row, index) => {
        const period = String(row.Period || "").trim(), bo = String(row.BO || "").trim().toUpperCase(), stationCode = String(row.Station || bo).trim().toUpperCase(), provider = String(row.Provider || "").trim();
        if (!/^\d{4}-\d{2}$/.test(period) || !bo || !provider || (role === "BO Admin" && stationCode !== station)) { errors.push(`Row ${index + 2}`); return; }
        incoming.push({ id: crypto.randomUUID(), period, area: String(row.Area || "Unassigned Area"), bo, station: stationCode, provider,
          businessPax: numberValue(row["Business Pax"]), economyPax: numberValue(row["Economy Pax"]), businessLounge: numberValue(row["Business Lounge"]), platinum: numberValue(row.Platinum), elitePlus: numberValue(row["Elite Plus"]), skyteam: numberValue(row.SkyTeam), partnership: numberValue(row.Partnership), dpr: numberValue(row.DPR), paidAccess: numberValue(row["Paid Access"]), other: numberValue(row.Other), unitPrice: numberValue(row["Unit Price"]), source: "BO Import" });
      });
      setMonitoringRows((current) => { const next = [...current]; incoming.forEach((item) => { const existing = next.findIndex((row) => row.period === item.period && row.bo === item.bo && row.station === item.station && row.provider === item.provider); if (existing >= 0) next[existing] = { ...item, id: next[existing].id }; else next.push(item); }); return next; });
      setDashboardImportNotice(`${incoming.length} passenger-volume records processed.${errors.length ? ` ${errors.length} rows require correction.` : ""}`);
    } catch { setDashboardImportNotice("Passenger Volume file could not be read. Use the provided CSV/XLSX template."); }
  }

  function applyDashboardPeriodToVisitorFilter() {
    if (/^\d{4}-\d{2}$/.test(dashboardPeriod)) {
      const [year, month] = dashboardPeriod.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      setVisitorDateFrom(`${dashboardPeriod}-01`);
      setVisitorDateTo(`${dashboardPeriod}-${String(lastDay).padStart(2, "0")}`);
      setVisitorFiltersActive(true);
    } else {
      setVisitorDateFrom("");
      setVisitorDateTo("");
      setVisitorFiltersActive(false);
    }
  }

  function openDashboardVisitors(category = "Semua", bo = dashboardBo, provider = dashboardProvider) {
    setFilter(bo === "All BO" ? "Semua" : bo);
    setVisitorCategoryFilter(category);
    setVisitorStatusFilter("All Status");
    setQuery(provider === "All Providers" ? "" : provider);
    applyDashboardPeriodToVisitorFilter();
    setReconTab("Visitor List");
    setTab("reconciliation");
  }

  function openDashboardReport(provider = dashboardProvider) {
    setFilter(dashboardBo === "All BO" ? "Semua" : dashboardBo);
    setReportLoungeFilter(provider === "All Providers" ? "Semua" : provider);
    setVisitorCategoryFilter("Semua");
    setQuery("");
    applyDashboardPeriodToVisitorFilter();
    setReconTab("Reports & Sign-off");
    setTab("reconciliation");
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    if (!auth || !firebaseConfigured) { setLoginError("Firebase belum dikonfigurasi pada environment Netlify."); return; }
    try {
      const identity = loginUser.trim().toLowerCase();
      const email = identity.includes("@") ? identity : (await resolveUsername(identity)).email;
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email, loginPassword);
      setLoginError(""); setLoginPassword(""); setFlightFilter("Semua");
    } catch { setLoginError("Email/username atau password tidak sesuai."); }
  }

  async function logout() {
    if (auth) await signOut(auth);
    setCurrentAccount(null);
    setLoginPassword("");
    setTab("access");
  }
  useEffect(() => {
    if (!scanner) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (buffer.current) read(buffer.current, "device scanner");
        buffer.current = "";
        return;
      }
      if (e.key.length !== 1) return;
      const n = Date.now();
      if (n - keyTime.current > 120) buffer.current = "";
      buffer.current += e.key;
      keyTime.current = n;
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(
    () => () => {
      controls.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (!manualMode) return;
    const eligible =
      pass.cabin === "C" ||
      (pass.cabin === "Y" &&
        (manualMember === "Platinum" || manualMember === "Elite Plus"));
    // Eligibility is derived immediately when the fallback inputs change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPass((p) => ({ ...p, eligible: eligible ? "Y" : "N" }));
    setCategory(
      pass.cabin === "C"
        ? "Business Class"
        : manualMember === "Platinum"
          ? "Platinum"
          : manualMember === "Elite Plus"
            ? "Elite Plus"
            : "Business Class",
    );
  }, [manualMode, manualMember, pass.cabin]);
  const lounge = lounges.find((x) => x.id === loungeId),
    required = category !== "Business Class",
    refLabel =
      category === "Kerjasama MPA"
        ? "Nama Maskapai / Mitra"
        : category === "EMD"
          ? "Nomor EMD"
          : "Nomor Member";
  const tr = (id: string, en: string) => language === "EN" ? en : id;
  function fieldValue(v: Visitor, field: string): string | number {
    const { origin, destination } = splitRoute(v.route);
    return ({
      "Passenger Name": v.name, "Flight Number": v.flight, "Date of Travel": v.travelDate || v.date,
      Origin: origin, Destination: destination, Route: v.route, "Cabin Class": v.cabin,
      "Check-in Sequence": v.seq, "Ticket Number": v.ticket, "Access Category": v.category,
      Reference: v.reference, "Companion Count": v.companionCount || 0, "Unit Price": v.price,
      "Final Status": v.boStatus,
    } as Record<string, string | number>)[field] ?? "";
  }
  function evaluateFormula(v: Visitor, expression: string, type: CustomColumn["type"]) {
    const legacy: Record<string, string> = {
      name: "[Passenger Name]", route: "[Route]", flightDot: "CONCAT([Flight Number], ' · ', [Date of Travel])",
      accessReference: "CONCAT([Access Category], ' · ', [Reference])", payableAmount: "[Unit Price]",
    };
    const source = (legacy[expression] || expression).trim();
    if (!source) return "";
    const fieldOnly = source.match(/^\[([^\]]+)\]$/);
    if (fieldOnly) return fieldValue(v, fieldOnly[1]);
    const resolveText = (value: string) => value.replace(/\[([^\]]+)\]/g, (_, field) => String(fieldValue(v, field)))
      .replace(/^['\"]|['\"]$/g, "");
    const functionMatch = source.match(/^(CONCAT|SQRT|ABS|ROUND|MIN|MAX|POWER)\((.*)\)$/i);
    if (functionMatch) {
      const fn = functionMatch[1].toUpperCase();
      const args = functionMatch[2].split(/,(?![^()]*\))/).map((x) => x.trim());
      if (fn === "CONCAT") return args.map(resolveText).join("");
      const nums = args.map((arg) => Number(resolveText(arg).replace(/[^0-9.+-]/g, "")) || 0);
      if (fn === "SQRT") return Math.sqrt(nums[0]);
      if (fn === "ABS") return Math.abs(nums[0]);
      if (fn === "ROUND") return Number(nums[0].toFixed(nums[1] || 0));
      if (fn === "MIN") return Math.min(...nums);
      if (fn === "MAX") return Math.max(...nums);
      if (fn === "POWER") return Math.pow(nums[0], nums[1] || 1);
    }
    if (type === "Text" || type === "Date") {
      return source.split("+").map((part) => resolveText(part.trim())).join("");
    }
    const numeric = source.replace(/\[([^\]]+)\]/g, (_, field) => String(Number(fieldValue(v, field)) || 0))
      .replaceAll("×", "*").replaceAll("÷", "/").replaceAll("^", "**");
    if (!/^[0-9+\-*/().\s*]+$/.test(numeric)) return "Formula tidak valid";
    try {
      const result = Function(`"use strict"; return (${numeric})`)();
      if (!Number.isFinite(result)) return "Formula tidak valid";
      return type === "Currency" ? cash(result, v.currency) : result;
    } catch { return "Formula tidak valid"; }
  }
  function customValue(v: Visitor, column: CustomColumn) {
    return evaluateFormula(v, column.formula, column.type);
  }
  function appendFormula(token: string) {
    setCustomColumnDraft((current) => ({
      ...current,
      formula: `${current.formula}${current.formula && !current.formula.endsWith("(") ? " " : ""}${token}`,
    }));
  }
  function resetAccessCapture() {
    setPass(emptyPass);
    setRaw("");
    setReference("");
    setCompanionCount(0);
    setCompanionCategory("Lainnya");
    setCompanionMembership("");
    setNotice(null);
    setRejected(null);
    setCompanionCount(0);
    setCompanionCategory("Lainnya");
    setCompanionMembership("");
  }
  function read(value: string, source = "input string") {
    if (!accessTravelDate) {
      setNotice({ kind: "error", text: "Pilih Date of Travel pada Langkah 1 sebelum melakukan scan." });
      return;
    }
    const data = parse(value);
    setRaw(value);
    const [origin, destination] = data.route
      .split("–")
      .map((x) => x.trim().toUpperCase());
    const deny = (
      reason:
        | "N"
        | "missing"
        | "airport"
        | "schedule"
        | "status"
        | "window"
        | "lounge",
      detail?: string,
    ) => {
      setPass(emptyPass);
      setNotice(null);
      setRejected({ reason, origin, detail });
    };
    if (data.eligible !== "Y") {
      deny(data.eligible === "N" ? "N" : "missing");
      return;
    }
    if (origin && origin !== airport) {
      deny("airport");
      return;
    }
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: activeTimeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const scanMinutes = Number(parts.find((x) => x.type === "hour")?.value || 0) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value || 0);
    const barcodeDate = dateFromJulian(data.julianDay || "", accessTravelDate);
    const flightCandidates = flights
      .filter((f) =>
        f.date === accessTravelDate &&
        f.flight === data.flight &&
        f.origin === origin &&
        f.destination === destination,
      )
      .map((f) => {
        const dayOffset = Math.round((new Date(`${f.date}T12:00:00Z`).getTime() - new Date(`${stationDate}T12:00:00Z`).getTime()) / 86400000);
        const [fh, fm] = (f.etd || f.std).split(":").map(Number);
        const minutesToDeparture = dayOffset * 1440 + fh * 60 + fm - scanMinutes;
        const barcodeMatch = Boolean(barcodeDate && f.date === barcodeDate);
        return { f, minutesToDeparture, barcodeMatch };
      })
      .filter((x) => x.barcodeMatch || (x.minutesToDeparture >= -120 && x.minutesToDeparture <= accessWindow * 60))
      .sort((a, b) => Number(b.barcodeMatch) - Number(a.barcodeMatch) || Math.abs(a.minutesToDeparture) - Math.abs(b.minutesToDeparture));
    const activeFlight = flightCandidates[0]?.f;
    if (!activeFlight) {
      deny(
        "schedule",
        `${data.flight} ${data.route} tidak ditemukan pada flight schedule untuk Date of Travel ${accessTravelDate}. Lakukan input manual atau verifikasi flight.`,
      );
      return;
    }
    if (["Cancelled", "Postponed"].includes(activeFlight.status)) {
      deny("status", `Status penerbangan ${activeFlight.status}.`);
      return;
    }
    const indonesia = new Set([
        "CGK",
        "DJB",
        "DPS",
        "KUL",
        "JOG",
        "SUB",
        "KNO",
        "UPG",
        "BPN",
        "HLP",
        "AAP",
        "KOE",
      ]),
      isDomestic = indonesia.has(origin) && indonesia.has(destination),
      loungeName = (
        lounges.find((x) => x.id === loungeId)?.name || ""
      ).toLowerCase();
    if (
      (isDomestic && loungeName.includes("internasional")) ||
      (!isDomestic && loungeName.includes("domestik"))
    ) {
      deny(
        "lounge",
        `Penerbangan ${isDomestic ? "domestik" : "internasional"} tidak sesuai dengan lounge yang dipilih.`,
      );
      return;
    }
    setPass({
      ...data,
      travelDate: accessTravelDate,
      dateSource: "Selected",
    });
    if (data.cabin === "C") setCategory("Business Class");
    setNotice({
      kind: "ok",
      text: `Data terbaca melalui ${source}. Flight dikonfirmasi terhadap Date of Travel ${accessTravelDate} yang dipilih petugas.`,
    });
  }
  function retryScan() {
    resetAccessCapture();
    if (!camera) void toggleCamera();
  }
  async function toggleCamera() {
    if (camera) {
      controls.current?.stop();
      controls.current = null;
      stream.current?.getTracks().forEach((t) => t.stop());
      setCamera(false);
      setScanStatus("");
      return;
    }
    if (!video.current) return;
    try {
      setCamera(true);
      setScanStatus("Menyiapkan kamera...");
      setNotice(null);
      const reader = new BrowserMultiFormatReader();
      controls.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video.current,
        (result, error, ctrl) => {
          if (result) {
            const value = result.getText();
            ctrl.stop();
            controls.current = null;
            setCamera(false);
            setScanStatus("");
            read(value, "kamera browser");
          } else if (error) {
            setScanStatus(
              "Memindai barcode/QR… tahan stabil dan dekatkan kode",
            );
          }
        },
      );
      stream.current = video.current.srcObject as MediaStream;
      setScanStatus("Memindai barcode/QR… tahan stabil dan dekatkan kode");
    } catch {
      controls.current?.stop();
      controls.current = null;
      setCamera(false);
      setScanStatus("");
      setNotice({
        kind: "error",
        text: "Kamera tidak dapat diakses. Pastikan izin kamera aktif, gunakan kamera belakang, dan buka halaman melalui HTTPS.",
      });
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (pass.eligible !== "Y") {
      setRejected({ reason: pass.eligible === "N" ? "N" : "missing" });
      setActionDialog({ kind: "error", text: "Penumpang tidak eligible. Silakan coba scan ulang." });
      return;
    }
    if (!pass.name || !pass.flight || !pass.seq || !pass.travelDate || !lounge) {
      setNotice({
        kind: "error",
        text: "Nama, flight, Date of Travel, sequence, airport, dan lounge wajib diisi.",
      });
      return;
    }
    if (required && !reference.trim()) {
      setNotice({
        kind: "error",
        text: `${refLabel} wajib diisi untuk kategori ${category}.`,
      });
      return;
    }
    if (companionCount > 0 && companionCategory.includes("Membership") && !companionMembership.trim()) {
      setNotice({ kind: "error", text: "Nomor membership pendamping wajib diisi untuk kategori membership." });
      return;
    }
    const key = `${pass.name}|${pass.flight}|${pass.seq}|${pass.travelDate}`
      .toLowerCase()
      .replace(/\s/g, "");
    if (
      visitors.some(
        (v) =>
          `${v.name}|${v.flight}|${v.seq}|${v.travelDate || v.date}`.toLowerCase().replace(/\s/g, "") ===
          key,
      )
    ) {
      setActionDialog({ kind: "warn", text: "Penumpang sudah ditambahkan sebagai pengguna layanan lounge." });
      return;
    }
    const n = new Date();
    const scheduled = flights.find((f) => f.date === pass.travelDate && f.flight === pass.flight);
    const departureTime = scheduled?.etd || scheduled?.std;
    const departure = departureTime ? new Date(`${pass.travelDate}T${departureTime}:00`) : null;
    const lateScan = Boolean(departure && n.getTime() > departure.getTime());
    const visitor: Visitor = {
        id: crypto.randomUUID(),
        date: stationDate,
        travelDate: pass.travelDate || stationDate,
        scanTimestamp: n.toISOString(),
        dateSource: pass.dateSource || "Manual",
        time: n.toLocaleTimeString("id-ID", {
          timeZone: activeTimeZone,
          hour: "2-digit",
          minute: "2-digit",
        }),
        airport,
        lounge: lounge.name,
        name: pass.name,
        flight: pass.flight,
        route: pass.route,
        cabin: pass.cabin,
        seat: pass.seat,
        seq: pass.seq,
        ticket: pass.ticket,
        eligible: "Y",
        category,
        reference: reference.trim(),
        currency: lounge.currency,
        price: lounge.price,
        source: raw ? "Scan/Input" : "Manual",
        boStatus: "Pending",
        boReason: lateScan ? "Melewati STD/ETD" : "",
        vendorStatus: "Pending",
        verifier: ["Business Class", "VIP/CIP/VVIP"].includes(category)
          ? `BO ${airport}`
          : ["Platinum", "Elite Plus", "Gold Privilege", "Elite", "GPS", "EMD", "Paid Access"].includes(category)
            ? "HO Ancillary"
            : "Partner Airline",
        verifierOrganization: ["Business Class", "VIP/CIP/VVIP"].includes(category)
          ? `Branch Office ${airport}`
          : ["Platinum", "Elite Plus", "Gold Privilege", "Elite", "GPS", "EMD", "Paid Access"].includes(category)
            ? "HO Ancillary"
            : partnerRef || reference || "Designated Airline Representative",
        reconciliationStatus: "Open",
        exceptionalStatus: "Not Requested",
        reportRevision: 1,
        rawScan: raw,
        normalizedScan: pass.normalized,
        companionCount,
        companionCategory: companionCount ? companionCategory : "",
        companionMembership: companionCount ? companionMembership : "",
      };
    try {
      if (!firebaseUser) throw new Error("Sesi Firebase tidak aktif.");
      const saved = await createVisitor(firebaseUser, visitor);
      setVisitors((rows) => [{ ...visitor, id: saved.id }, ...rows.filter((row) => row.id !== saved.id)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Data tidak dapat disimpan.";
      setActionDialog({ kind: message.includes("sudah ditambahkan") ? "warn" : "error", text: message });
      return;
    }
    setPass(emptyPass);
    setRaw("");
    setReference("");
    setActionDialog({ kind: "ok", text: lateScan ? "Penumpang berhasil ditambahkan dan menunggu verifikasi Branch Office karena melewati STD/ETD." : "Penumpang berhasil ditambahkan sebagai pengguna layanan lounge." });
  }
  const effectiveVisitorFilter = isGlobalAdmin ? filter : station;
  const shown = useMemo(() => {
    const rows = visitors.filter(
      (v) =>
        (effectiveVisitorFilter === "Semua" || v.airport === effectiveVisitorFilter) &&
        (visitorCategoryFilter === "Semua" || v.category === visitorCategoryFilter) &&
        (!visitorFiltersActive || !visitorDateFrom || (v.travelDate || v.date) >= visitorDateFrom) &&
        (!visitorFiltersActive || (!visitorDateFrom && !visitorDateTo) || (v.travelDate || v.date) <= (visitorDateTo || visitorDateFrom)) &&
        (!visitorFiltersActive || !visitorTimeFrom || v.time >= visitorTimeFrom) &&
        (!visitorFiltersActive || !visitorTimeTo || v.time <= visitorTimeTo) &&
        (visitorStatusFilter === "All Status" ||
          (visitorStatusFilter === "Accepted" && v.boStatus === "Accepted") ||
          (visitorStatusFilter === "Declined" && v.boStatus === "Rejected") ||
          (visitorStatusFilter === "Pending" && v.boStatus === "Pending")) &&
        `${v.name} ${v.flight} ${v.category} ${v.lounge}`.toLowerCase().includes(query.toLowerCase()),
    );
    return sortData(rows, visitorSort, (v, key) => {
      const values: Record<string, string | number> = {
        no: v.id, date: `${v.date} ${v.time}`, airport: v.airport, name: v.name,
        flight: `${v.flight} ${v.seq}`, category: `${v.category} ${v.reference}`,
        lounge: v.lounge, price: v.price, status: `${v.boStatus} ${v.vendorStatus}`,
      };
      return values[key] ?? "";
    });
  }, [visitors, effectiveVisitorFilter, visitorCategoryFilter, visitorStatusFilter, visitorFiltersActive, visitorDateFrom, visitorDateTo, visitorTimeFrom, visitorTimeTo, query, visitorSort]);
  const filteredLounges = lounges.filter(
      (l) =>
        (masterSelect === "Semua" || l.airport === masterSelect) &&
        (masterSelect2 === "Semua" || l.type === masterSelect2 || l.status === masterSelect2) &&
        `${l.airport} ${l.name} ${l.type} ${l.currency}`
          .toLowerCase()
          .includes((masterQuery === "Semua Lounge / Provider" ? "" : masterQuery).toLowerCase()),
    ),
    filteredAccounts = sortData(accounts.filter(
      (a) =>
        (masterSelect === "Semua" || a.role === masterSelect) &&
        (masterSelect2 === "Semua" || a.station === masterSelect2 || a.status === masterSelect2) &&
        `${a.name} ${a.username} ${a.role} ${a.station}`
          .toLowerCase()
          .includes(masterQuery.toLowerCase()),
    ), userSort, (a, key) => ({ name: a.name, username: a.username, role: a.role, station: a.station, scope: a.scope, status: a.status }[key] || "")),
    filteredPartnerships = partnerships.filter(
      (p) =>
        (masterSelect === "Semua" || p.type === masterSelect) &&
        (masterSelect2 === "Semua" || p.status === masterSelect2) &&
        `${p.name} ${p.type} ${p.reference}`
          .toLowerCase()
          .includes(masterQuery.toLowerCase()),
    ),
    activityRows = [
      { id: "a1", time: `${localDate()} 09:15`, user: "Super Admin", activity: "Update operational rule", scope: "Semua BO" },
      { id: "a2", time: `${localDate()} 08:30`, user: "BO Admin CGK", activity: "Update ETD GA204", scope: "CGK" },
      { id: "a3", time: `${localDate()} 08:12`, user: "Lounge Officer", activity: "Submit visitor", scope: "CGK" },
    ],
    filteredActivity = sortData(activityRows.filter(
      (a) =>
        (masterSelect === "Semua" || a.user === masterSelect) &&
        (masterSelect2 === "Semua" || a.scope === masterSelect2) &&
        `${a.user} ${a.activity} ${a.scope}`.toLowerCase().includes(masterQuery.toLowerCase()),
    ), activitySort, (a, key) => ({ time: a.time, user: a.user, activity: a.activity, scope: a.scope }[key] || "")),
    shownFlights = sortData(flights.filter((f) =>
      (isGlobalAdmin ? flightFilter === "Semua" || f.origin === flightFilter : f.origin === station) &&
      (!flightDateFilter || f.date === flightDateFilter) &&
      (flightStatusFilter === "Semua" || f.status === flightStatusFilter) &&
      `${f.flight} ${f.origin} ${f.destination} ${f.capacity || ""}`.toLowerCase().includes(flightQuery.toLowerCase()),
    ), flightSort, (f, key) => ({
      flight: f.flight, route: `${f.origin}${f.destination}`, date: f.date, std: f.std,
      etd: f.etd, capacity: f.capacity || "", status: f.status, updated: `${f.updatedBy} ${f.updatedAt}`,
    }[key] || ""));
  const payableShown = shown.filter((v) => v.boStatus === "Accepted"),
    totals = payableShown.reduce<Record<string, number>>(
    (a, v) => ({ ...a, [v.currency]: (a[v.currency] || 0) + v.price }),
    {},
  ),
    reportFilteredShown = shown.filter((v) => reportLoungeFilter === "Semua" || v.lounge === reportLoungeFilter),
    reportPayableShown = reportFilteredShown.filter((v) => v.boStatus === "Accepted" && v.reconciliationStatus === "Final"),
    reportTotals = reportPayableShown.reduce<Record<string, number>>(
      (total, visitor) => ({ ...total, [visitor.currency]: (total[visitor.currency] || 0) + visitor.price }),
      {},
    );
  const dashboardRows = monitoringRows.filter((row) =>
      (dashboardPeriod === "All Periods" || row.period === dashboardPeriod) &&
      (dashboardArea === "All Areas" || row.area === dashboardArea) &&
      (dashboardBo === "All BO" || row.bo === dashboardBo) &&
      (dashboardProvider === "All Providers" || row.provider === dashboardProvider),
    ),
    dashboardVisitorCount = dashboardRows.reduce((sum, row) => sum + row.businessLounge + row.platinum + row.elitePlus + row.skyteam + row.partnership + row.dpr + row.paidAccess + row.other, 0),
    dashboardTotals = dashboardRows.reduce((total, row) => ({
      businessPax: total.businessPax + row.businessPax,
      economyPax: total.economyPax + row.economyPax,
      businessLounge: total.businessLounge + row.businessLounge,
      cost: total.cost + (row.businessLounge + row.platinum + row.elitePlus + row.skyteam + row.partnership + row.dpr + row.paidAccess + row.other) * row.unitPrice,
    }), { businessPax: 0, economyPax: 0, businessLounge: 0, cost: 0 }),
    dashboardComposition = [
      ["Business Class", dashboardRows.reduce((s, r) => s + r.businessLounge, 0)],
      ["Platinum", dashboardRows.reduce((s, r) => s + r.platinum, 0)],
      ["Elite Plus", dashboardRows.reduce((s, r) => s + r.elitePlus, 0)],
      ["SkyTeam", dashboardRows.reduce((s, r) => s + r.skyteam, 0)],
      ["Partnership", dashboardRows.reduce((s, r) => s + r.partnership, 0)],
      ["DPR", dashboardRows.reduce((s, r) => s + r.dpr, 0)],
      ["Paid Access", dashboardRows.reduce((s, r) => s + r.paidAccess, 0)],
      ["Other", dashboardRows.reduce((s, r) => s + r.other, 0)],
    ] as [string, number][],
    dashboardDays = Math.max(1, ...dashboardRows.map((row) => {
      const [year, month] = row.period.split("-").map(Number);
      return year && month ? new Date(year, month, 0).getDate() : 1;
    })),
    dashboardTopBo = Object.values(dashboardRows.reduce<Record<string, { name: string; area: string; visitors: number; cost: number }>>((all, row) => {
      const visitors = row.businessLounge + row.platinum + row.elitePlus + row.skyteam + row.partnership + row.dpr + row.paidAccess + row.other;
      const current = all[row.bo] || { name: row.bo, area: row.area, visitors: 0, cost: 0 };
      all[row.bo] = { ...current, visitors: current.visitors + visitors, cost: current.cost + visitors * row.unitPrice };
      return all;
    }, {})).sort((a, b) => b.visitors - a.visitors).slice(0, 10),
    dashboardProviders = Object.values(dashboardRows.reduce<Record<string, { name: string; visitors: number; cost: number }>>((all, row) => {
      const visitors = row.businessLounge + row.platinum + row.elitePlus + row.skyteam + row.partnership + row.dpr + row.paidAccess + row.other;
      const current = all[row.provider] || { name: row.provider, visitors: 0, cost: 0 };
      all[row.provider] = { name: row.provider, visitors: current.visitors + visitors, cost: current.cost + visitors * row.unitPrice };
      return all;
    }, {})).sort((a, b) => b.cost - a.cost),
    dashboardTrend = (() => {
      const rows = visitors.filter((visitor) =>
        (dashboardPeriod === "All Periods" || (visitor.travelDate || visitor.date).startsWith(dashboardPeriod)) &&
        (dashboardBo === "All BO" || visitor.airport === dashboardBo) &&
        (dashboardProvider === "All Providers" || visitor.lounge === dashboardProvider));
      const dates = rows.map((visitor) => visitor.travelDate || visitor.date).sort();
      if (!dates.length) return { mode: "Harian", points: [] as Array<{ label: string; value: number }> };
      const span = Math.max(1, Math.ceil((new Date(dates.at(-1)!).getTime() - new Date(dates[0]).getTime()) / 86400000) + 1);
      const mode = dashboardPeriod === "All Periods" || span > 90 ? "Bulanan" : span > 31 ? "Mingguan" : "Harian";
      const totals = new Map<string, number>();
      rows.forEach((visitor) => {
        const date = new Date(`${visitor.travelDate || visitor.date}T00:00:00`);
        let key = (visitor.travelDate || visitor.date);
        if (mode === "Bulanan") key = key.slice(0, 7);
        if (mode === "Mingguan") { const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); key = monday.toISOString().slice(0, 10); }
        totals.set(key, (totals.get(key) || 0) + 1);
      });
      return { mode, points: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })) };
    })(),
    visibleDashboardWidgets = dashboardWidgets.filter((widget) => widget.visible && widget.roles.includes(role));
  const trafficDates = [...new Set(shown.map((v) => v.travelDate || v.date))],
    trafficDivisor = Math.max(trafficDates.length, 1),
    traffic = Array.from({ length: 24 }, (_, hour) => {
      const count = shown.filter((v) => Number(v.time.slice(0, 2)) === hour).length;
      return { hour, total: count, average: count / trafficDivisor };
    }),
    trafficMax = Math.max(1, ...traffic.map((x) => x.average)),
    peak = traffic.reduce((best, current) => current.average > best.average ? current : best, traffic[0]);
  const verificationQueue = shown.filter((v) => {
    if (role === "Super Admin" || role === "Admin") return true;
    if (role === "BO Admin") return ["Business Class", "VIP/CIP/VVIP"].includes(v.category);
    if (role === "HO Ancillary Verifier") return ["Platinum", "Elite Plus", "Gold Privilege", "Elite", "GPS", "EMD", "Paid Access"].includes(v.category);
    if (role === "Airline Verifier") return ["Partner Airline / SkyTeam", "Kerjasama MPA"].includes(v.category) && (!currentAccount?.organization || v.verifierOrganization === currentAccount.organization || v.reference.toLowerCase().includes(currentAccount.organization.toLowerCase()));
    return false;
  }),
    reportReconciliationReady = reportFilteredShown.length > 0 && reportFilteredShown.every((v) =>
      v.boStatus === "Accepted" || (v.boStatus === "Rejected" && v.reconciliationStatus === "Final"),
    );
  async function mergeFlights(incoming: Flight[]) {
    await Promise.all(incoming.map((item) => saveRecord("flights", item)));
    setFlights((current) => {
      const next = [...current];
      incoming.forEach((item) => {
        const i = next.findIndex(
          (x) =>
            x.date === item.date &&
            x.flight === item.flight &&
            x.origin === item.origin &&
            x.destination === item.destination,
        );
        if (i >= 0) next[i] = { ...next[i], ...item, id: next[i].id };
        else next.push(item);
      });
      return next;
    });
    setFlightNotice(`${incoming.length} penerbangan berhasil diproses.`);
  }
  async function uploadFlights(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          cellDates: true,
        }),
        rows = XLSX.utils.sheet_to_json<unknown[]>(
          wb.Sheets[wb.SheetNames[0]],
          { header: 1, raw: true, defval: "" },
        );
      const allText = rows.flat().map(String).join(" "),
        origin = (
          allText.match(/Departing From:\s*([A-Z]{3})/i)?.[1] || station
        ).toUpperCase(),
        headerIndex = rows.findIndex(
          (r) =>
            r.some((v) => String(v).trim().toLowerCase() === "flight") &&
            r.some((v) => String(v).trim().toLowerCase() === "to"),
        ),
        headers = (rows[headerIndex] || []).map((v) =>
          String(v).trim().toLowerCase(),
        ),
        col = (...names: string[]) =>
          headers.findIndex((h) => names.includes(h));
      let date = localDate();
      for (const row of rows) {
        for (const v of row) {
          if (v instanceof Date && !isNaN(v.getTime()))
            date = v.toISOString().slice(0, 10);
          else if (
            typeof v === "string" &&
            /^\d{1,2}-[A-Za-z]{3}(?:-\d{2,4})?$/.test(v.trim())
          ) {
            const withYear = /\d{2,4}$/.test(v.trim())
                ? v.trim()
                : `${v.trim()}-${new Date().getFullYear()}`,
              d = new Date(withYear);
            if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
          }
        }
      }
      const output: Flight[] = [];
      for (const row of rows.slice(headerIndex + 1)) {
        const flight = String(row[col("flight")] || "")
          .trim()
          .toUpperCase();
        if (!/^[A-Z0-9]{2,3}\s*\d+/.test(flight)) continue;
        const destination = String(row[col("to")] || "")
            .trim()
            .toUpperCase(),
          time =
            String(row[col("time")] || "").match(/\d{1,2}:\d{2}/)?.[0] || "",
          rawStatus = String(row[col("flight status", "status")] || "OPEN")
            .trim()
            .toUpperCase(),
          status: FlightStatus = rawStatus.includes("CANCEL")
            ? "Cancelled"
            : rawStatus.includes("POSTPON")
              ? "Postponed"
              : rawStatus.includes("DELAY")
                ? "Delayed"
                : rawStatus.includes("RESCHED")
                  ? "Rescheduled"
                  : "Scheduled",
          capacity = String(row[col("capacity")] || "").trim();
        if (!destination || !time) continue;
        output.push({
          id: crypto.randomUUID(),
          date,
          flight: flight.replace(/\s/g, ""),
          origin,
          destination,
          std: time,
          etd: time,
          capacity,
          status,
          updatedBy: `Upload ${role}`,
          updatedAt: new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      }
      if (!output.length)
        throw new Error("Tidak ada baris penerbangan yang dapat dikenali.");
      mergeFlights(output);
    } catch (e) {
      setFlightNotice(
        e instanceof Error ? e.message : "File tidak dapat dibaca.",
      );
    }
  }
  async function previewPassengerList(file: File) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const keys = Object.keys(rows[0] || {}).map((x) => x.toLowerCase());
      const hasPassenger = keys.some((x) => x.includes("passenger") || x.includes("name"));
      const hasFlight = keys.some((x) => x.includes("flight"));
      const hasDate = keys.some((x) => x.includes("date") || x.includes("dot"));
      if (!rows.length || !hasPassenger || !hasFlight) throw new Error("Mapping failed: Passenger Name and Flight Number columns are required.");
      const duplicateCount = rows.length - new Set(rows.map((row) => JSON.stringify(row))).size;
      setPassengerImportNotice(`Preview only: ${rows.length} rows recognized · ${duplicateCount} duplicate rows · Date of Travel ${hasDate ? "mapped" : "requires mapping"}. Confirm import after Tim IT connects persistent storage.`);
    } catch (error) {
      setPassengerImportNotice(error instanceof Error ? error.message : "Passenger List cannot be read.");
    }
  }
  function addFlight(e: FormEvent) {
    e.preventDefault();
    if (
      !newFlight.flight ||
      !newFlight.origin ||
      !newFlight.destination ||
      !newFlight.date ||
      !newFlight.std
    ) {
      setFlightNotice("Flight, From, To, tanggal, dan STD wajib diisi.");
      return;
    }
    const record: Flight = {
        ...newFlight,
        id: editingFlight || crypto.randomUUID(),
        flight: newFlight.flight.toUpperCase().replace(/\s/g, ""),
        origin: newFlight.origin.toUpperCase(),
        destination: newFlight.destination.toUpperCase(),
        etd: newFlight.etd || newFlight.std,
        updatedBy: `${editingFlight ? "Update" : "Tambah"} ${role}`,
        updatedAt: new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    if (editingFlight)
      setFlights((xs) => xs.map((x) => x.id === editingFlight ? record : x));
    else mergeFlights([record]);
    setShowAddFlight(false);
    setEditingFlight(null);
    setNewFlight({
      flight: "",
      origin: station,
      destination: "",
      date: localDate(),
      std: "",
      etd: "",
      capacity: "",
      status: "Scheduled",
    });
  }
  function csv() {
    const head = [
        "Date Of Access", "Time Of Access", "Passenger Name", "Confirmation Number",
        "Source Issuing Confirmation", "Access Granted By", "E-Ticket Number",
        "Operating Airline Code", "Flight Number", "Cabin Class", "Departure Date",
        "Origin (ORG)", "Destination (DEST)", "Number of Guests", "FFP Airline Code",
        "FFP Number", "FFP Tier Level", "Airport Code", "Override Reason", "Remarks",
        "Payment Id", "Guest Category", "Total Passengers", "Verification Status",
        ...customColumns.filter((c) => c.visible).map((c) => c.label),
      ],
      rows = shown.map((v) => {
        const route = splitRoute(v.route);
        return [
        v.date, v.time, v.name, v.id, v.source, v.verifier || "", v.ticket,
        flightOperatorCode(v.flight), v.flight, v.cabin,
        v.travelDate || v.date, route.origin, route.destination,
        v.companionCount || 0, v.category.includes("Partner") ? v.reference.slice(0, 2) : "",
        ["Platinum", "Elite Plus"].includes(v.category) ? v.reference : "", v.category,
        v.airport, v.boReason, v.evidenceName || "", "", v.companionCategory || "",
        1 + (v.companionCount || 0), v.boStatus,
        ...customColumns.filter((c) => c.visible).map((c) => customValue(v, c)),
      ];
      });
    const body = [head, ...rows]
        .map((r) =>
          r.map((x) => `"${String(x ?? "").replaceAll('"', '""')}"`).join(","),
        )
        .join("\n"),
      a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = `Garuda_Lounge_Visitor_List_${stationDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function pdf() {
    const reportRows = payableShown.filter((v) => v.reconciliationStatus === "Final" && (reportLoungeFilter === "Semua" || v.lounge === reportLoungeFilter));
    if (!reportRows.length) return;
    const isIndonesia = reportRows.every((v) => stations.some((s) => s.code === v.airport));
    const doc = new jsPDF({ orientation: reportConfig.columns.length > 8 ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    try {
      const logo = await imageDataUrl("/garuda-indonesia-logo.png");
      doc.addImage(logo, "PNG", pageWidth / 2 - 28, 8, 56, 13);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.text("GARUDA INDONESIA", pageWidth / 2, 15, { align: "center" });
    }
    const reportDate = new Date().toLocaleDateString(isIndonesia ? "id-ID" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const service = [...new Set(reportRows.map((v) => v.lounge))].join(", ") || "—";
    const dates = reportRows.map((v) => v.travelDate || v.date).sort();
    const period = dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ${isIndonesia ? "s.d." : "to"} ${dates.at(-1)}`;
    const metadataValues: Record<string, string> = {
      "Period": period,
      "Station": effectiveVisitorFilter === "Semua" ? (isIndonesia ? "Seluruh Station" : "All Stations") : effectiveVisitorFilter,
      "Lounge/Tenant": service,
      "Airline/Payer": [...new Set(reportRows.map((v) => v.verifier || "—"))].join(", "),
      "Generated Date & Local Time": `${reportDate} · ${localClock(activeTimeZone, language)} ${activeUtcLabel}`,
    };
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(reportConfig.title || "Reconciliation Report", pageWidth / 2, 28, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    let y = 37;
    reportConfig.metadata.forEach((key) => { doc.text(`${key}: ${metadataValues[key] || "—"}`, 14, y, { maxWidth: pageWidth - 28 }); y += 6; });
    doc.setFont("helvetica", "bold");
    doc.text(`${isIndonesia ? "Total Confirmed Visitor" : "Total Confirmed Visitors"}: ${reportRows.length}`, 14, y + 2);
    if (reportConfig.includeCost) {
      Object.entries(reportRows.reduce<Record<string, number>>((a, v) => ({ ...a, [v.currency]: (a[v.currency] || 0) + v.price }), {})).forEach(([currency, total], index) => {
        doc.text(`${isIndonesia ? "Estimasi Total Biaya" : "Estimated Total Cost"} ${currency}: ${cash(total, currency)}`, 14, y + 8 + index * 5);
      });
      y += 8 + Object.keys(totals).length * 5;
    } else y += 7;
    const labels: Record<ReportColumnKey, string> = {
      dot: "Date of Travel", accessTime: "Access Date & Time", station: "Station", passenger: "Passenger Name", flight: "Flight Number", route: "Route", category: "Access Category", reference: "Reference / Membership", guest: "Companion", verifier: "Verifier", status: "Final Status", price: "Price / Cost",
    };
    const value = (v: Visitor, key: ReportColumnKey) => ({
      dot: v.travelDate || v.date,
      accessTime: `${v.date} ${v.time}`,
      station: v.airport,
      passenger: v.name,
      flight: v.flight,
      route: v.route,
      category: v.category,
      reference: v.reference || "—",
      guest: v.companionCount ? `${v.companionCount} · ${v.companionCategory || "—"}` : "0",
      verifier: v.verifier || "—",
      status: "Confirmed",
      price: cash(v.price, v.currency),
    }[key]);
    const selectedColumns = reportConfig.includeCost
      ? [...reportConfig.columns.filter((key) => key !== "price"), "price" as ReportColumnKey]
      : reportConfig.columns.filter((key) => key !== "price");
    autoTable(doc, {
      startY: y,
      head: [["No.", ...selectedColumns.map((key) => labels[key])]],
      body: reportRows.map((v, index) => [index + 1, ...selectedColumns.map((key) => value(v, key))]),
      styles: { fontSize: 7, cellPadding: 1.6, textColor: [35, 53, 60] },
      headStyles: { fillColor: [7, 95, 123], textColor: [255, 255, 255] },
      didDrawPage: () => {
        doc.setFontSize(7); doc.setTextColor(110);
        doc.text(`${isIndonesia ? "Halaman" : "Page"} ${doc.getNumberOfPages()}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 7, { align: "right" });
        doc.setTextColor(0);
      },
    });
    const lastY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y;
    let signY = Math.max(lastY + 15, doc.internal.pageSize.getHeight() - 55);
    if (signY > doc.internal.pageSize.getHeight() - 42) { doc.addPage(); signY = 35; }
    doc.setFontSize(8.5);
    doc.text(isIndonesia ? "Penyedia/Pengelola Lounge/Tenant" : "Lounge/Tenant Provider", pageWidth * .28, signY, { align: "center" });
    doc.text(effectiveVisitorFilter === "Semua" ? "Branch Office" : `Branch Office ${effectiveVisitorFilter}`, pageWidth * .72, signY, { align: "center" });
    doc.line(pageWidth * .16, signY + 28, pageWidth * .40, signY + 28);
    doc.line(pageWidth * .60, signY + 28, pageWidth * .84, signY + 28);
    doc.text(vendorSigner || "Vendor Name & Position", pageWidth * .28, signY + 33, { align: "center" });
    doc.text(boSigner || "BO Name & Position", pageWidth * .72, signY + 33, { align: "center" });
    if (reportConfig.includeEvidenceAppendix) {
      const evidenceRows = reportRows.filter((v) => v.evidenceName);
      if (evidenceRows.length) {
        doc.addPage();
        doc.setFont("helvetica", "bold"); doc.setFontSize(13);
        doc.text(isIndonesia ? "Appendix Evidence" : "Evidence Appendix", pageWidth / 2, 20, { align: "center" });
        autoTable(doc, {
          startY: 28,
          head: [["No.", "Passenger", "Flight / DOT", "Evidence Type", "File Reference", "Retention"]],
          body: evidenceRows.map((v, index) => [index + 1, v.name, `${v.flight} / ${v.travelDate || v.date}`, v.evidenceType || "Supporting Document", v.evidenceName || "—", `BO ${evidenceBoRetention} days · Super Admin ${evidenceAdminRetention} days`]),
          styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [7, 95, 123] },
        });
      }
    }
    const fileName = (reportConfig.fileName || "Reconciliation_Report_{Station}_{StartDate}_{EndDate}")
      .replace("{Station}", effectiveVisitorFilter === "Semua" ? "ALL" : effectiveVisitorFilter)
      .replace("{StartDate}", visitorDateFrom || dates[0])
      .replace("{EndDate}", visitorDateTo || dates.at(-1) || dates[0])
      .replace(/[^A-Za-z0-9_-]+/g, "_");
    doc.save(`${fileName}.pdf`);
  }
  function downloadLoungeTemplate() {
    const body =
        "Airport,Nama Lounge/Tenant,Tipe,Currency,Harga per Pax,Tanggal Mulai,Tanggal Berakhir,Status\nCGK,Contoh Executive Lounge,Lounge,IDR,350000,2026-01-01,2026-12-31,Aktif",
      a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "template-daftar-lounge.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function uploadLounges(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }),
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          wb.Sheets[wb.SheetNames[0]],
          { defval: "" },
        ),
        incoming: Lounge[] = rows
          .map((r) => ({
            id: crypto.randomUUID(),
            airport: String(r.Airport || "")
              .toUpperCase()
              .trim(),
            name: String(r["Nama Lounge/Tenant"] || "").trim(),
            type: String(r.Tipe || "Lounge"),
            currency: String(r.Currency || "IDR").toUpperCase(),
            price: Number(r["Harga per Pax"] || 0),
            start: String(r["Tanggal Mulai"] || ""),
            end: String(r["Tanggal Berakhir"] || ""),
            status: String(r.Status || "Aktif"),
          }))
          .filter((x) => x.airport && x.name && x.end);
      if (!incoming.length)
        throw new Error("Tidak ada data lounge yang valid.");
      await Promise.all(incoming.map((item) => saveRecord("lounges", item)));
      setLounges((x) => [...x, ...incoming]);
      setLoungeNotice(`${incoming.length} lounge/tenant berhasil ditambahkan.`);
    } catch (e) {
      setLoungeNotice(
        e instanceof Error ? e.message : "File tidak dapat dibaca.",
      );
    }
  }
  async function saveLounge(e: FormEvent) {
    e.preventDefault();
    if (!loungeDraft.airport || !loungeDraft.name || !loungeDraft.end) {
      setLoungeNotice(
        "Airport, nama lounge, dan tanggal berakhir wajib diisi.",
      );
      return;
    }
    const record = { ...loungeDraft, id: editingLounge || crypto.randomUUID() };
    await saveRecord("lounges", record);
    if (editingLounge)
      setLounges((xs) =>
        xs.map((x) =>
          x.id === editingLounge ? { ...loungeDraft, id: x.id } : x,
        ),
      );
    else setLounges((xs) => [...xs, record]);
    setShowLoungeForm(false);
    setEditingLounge(null);
    setLoungeNotice("Data lounge/tenant berhasil disimpan.");
    setActionDialog({ kind: "ok", text: `Lounge/Tenant berhasil ${editingLounge ? "diperbarui" : "ditambahkan"}.` });
  }
  async function saveUser(e: FormEvent) {
    e.preventDefault();
    if (savingUser) return;
    if (!userDraft.name || !userDraft.username || !userDraft.email || !firebaseUser) { setUserUploadNotice("Nama, username, dan email wajib diisi."); return; }
    if (!editingUser && userDraft.password.length < 8) { setUserUploadNotice("Password sementara minimal 8 karakter."); return; }
    if (userDraft.station !== "ALL" && !stations.some((s) => s.code === userDraft.station)) { setUserUploadNotice("Station yang dipilih tidak valid."); return; }
    if (role !== "Super Admin" && userDraft.role === "Super Admin") { setUserUploadNotice("Hanya Super Admin yang dapat membuat akun Super Admin."); return; }
    const roleScope = roleProfileSeed.find((item) => item.role === userDraft.role)?.scope || "Configured authority";
    const normalizedDraft = { ...userDraft, scope: `${roleScope} · ${userDraft.station === "ALL" ? "Seluruh Station" : `Station ${userDraft.station}`}` };
    setSavingUser(true);
    try {
      if (editingUser) {
        await updateManagedUser(firebaseUser, { ...normalizedDraft, uid: editingUser });
        setUserUploadNotice("Akun berhasil diperbarui.");
        setActionDialog({ kind: "ok", text: "User berhasil diperbarui." });
      } else {
        await createManagedUser(firebaseUser, normalizedDraft);
        setUserUploadNotice("Akun berhasil dibuat. Sampaikan password sementara dan minta pengguna menggantinya saat login pertama.");
        setActionDialog({ kind: "ok", text: "User berhasil ditambahkan. Sampaikan password sementara kepada pengguna." });
      }
      setShowUserForm(false); setEditingUser(null);
    } catch (error) { setUserUploadNotice(error instanceof Error ? error.message : "Akun tidak dapat dibuat."); }
    finally { setSavingUser(false); }
  }
  function downloadUserTemplate() {
    const body = "Full Name,Username,Temporary Password,Role,Organization,Verification Scope,Scope Type,Station Code,Email,Status\nBranch Office CGK,bo.cgk,ChangeMe123!,BO Admin,Branch Office CGK,\"Business Class,VIP/CIP/VVIP\",Single Station,CGK,bo.cgk@garuda-indonesia.com,Aktif\nAncillary Verifier,ancillary.verify,ChangeMe123!,HO Ancillary Verifier,HO Ancillary,\"Platinum,Elite Plus,EMD,Paid Access\",All Stations,ALL,ancillary@garuda-indonesia.com,Aktif";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "template-upload-akun.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function uploadUsers(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const validRoles: Account["role"][] = roleProfileSeed.map((x) => x.role);
      const errors: string[] = [];
      const incoming: Account[] = [];
      rows.forEach((r, index) => {
        const name = String(r["Full Name"] || "").trim(), username = String(r.Username || "").trim(), email = String(r.Email || "").trim(), password = String(r["Temporary Password"] || ""),
          accountRole = String(r.Role || "") as Account["role"], stationCode = String(r["Station Code"] || "").trim().toUpperCase(),
          status = (String(r.Status || "Aktif") === "Nonaktif" ? "Nonaktif" : "Aktif") as Account["status"];
        if (!name || !username || !email.includes("@") || password.length < 8 || !validRoles.includes(accountRole) || (role !== "Super Admin" && accountRole === "Super Admin") || (stationCode !== "ALL" && !stations.some((s) => s.code === stationCode)) || accounts.some((a) => a.username.toLowerCase() === username.toLowerCase()) || incoming.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
          errors.push(`Baris ${index + 2}: nama, username, role, station, atau duplikasi tidak valid.`);
          return;
        }
        incoming.push({ id: crypto.randomUUID(), name, username, email, role: accountRole, station: stationCode, scope: `${roleProfileSeed.find((item) => item.role === accountRole)?.scope || "Configured authority"} · ${stationCode === "ALL" ? "Seluruh Station" : `Station ${stationCode}`}`, organization: String(r.Organization || "Garuda Indonesia"), verificationScopes: String(r["Verification Scope"] || "").split(",").map((x) => x.trim()).filter(Boolean), status, password });
      });
      if (incoming.length && firebaseUser) {
        const result = await importManagedUsers(firebaseUser, incoming);
        errors.push(...result.errors.map((item) => `Baris ${item.row}: ${item.error}`));
        setUserUploadNotice(`${result.created} akun berhasil dibuat.${errors.length ? ` ${errors.length} baris gagal divalidasi.` : ""}`);
      } else setUserUploadNotice(`0 akun dibuat.${errors.length ? ` ${errors.length} baris gagal divalidasi.` : ""}`);
    } catch {
      setUserUploadNotice("File akun tidak dapat dibaca.");
    }
  }
  function downloadStationTemplate() {
    const body = "IATA Code,Station Name,Time Zone,UTC Label,Status\nCGK,Soekarno-Hatta,Asia/Jakarta,UTC+7,Aktif";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" })); a.download = "template-master-station.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function uploadStations(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const incoming = rows.map((r) => ({
        code: String(r["IATA Code"] || "").trim().toUpperCase(),
        name: String(r["Station Name"] || "").trim(),
        timeZone: String(r["Time Zone"] || "Asia/Jakarta").trim(),
        utcLabel: String(r["UTC Label"] || "UTC+7").trim(),
        status: (String(r.Status || "Aktif") === "Nonaktif" ? "Nonaktif" : "Aktif") as Station["status"],
      })).filter((item) => /^[A-Z]{3}$/.test(item.code) && item.name);
      if (!incoming.length) throw new Error("Tidak ada data station yang valid.");
      await Promise.all(incoming.map((item) => saveRecord("stations", { ...item, id: item.code })));
      setStationNotice(`${incoming.length} station berhasil diunggah.`);
    } catch (error) { setStationNotice(error instanceof Error ? error.message : "File station tidak dapat dibaca."); }
  }
  async function saveStation(e: FormEvent) {
    e.preventDefault();
    const code = stationDraft.code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || !stationDraft.name || (!editingStation && stations.some((s) => s.code === code))) { setStationNotice("Kode IATA tiga huruf dan nama station wajib valid."); return; }
    const record = { ...stationDraft, id: code, code };
    await saveRecord("stations", record);
    setStations((xs) => editingStation ? xs.map((item) => item.code === editingStation ? record : item) : [...xs, record]);
    setShowStationForm(false);
    setEditingStation(null);
    setStationDraft({ code: "", name: "", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" });
    setStationNotice(`Station ${code} berhasil ${editingStation ? "diperbarui" : "ditambahkan"}.`);
    setActionDialog({ kind: "ok", text: `Station ${code} berhasil ${editingStation ? "diperbarui" : "ditambahkan"}.` });
  }
  function downloadAirlineTemplate() {
    const body = "2-Letter Code,Airline,Verifier Organization,Status\nGA,Garuda Indonesia,Garuda Indonesia,Active";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" })); a.download = "template-master-airline.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function uploadAirlines(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const incoming = rows.map((r) => ({
        code: String(r["2-Letter Code"] || "").trim().toUpperCase(),
        name: String(r.Airline || "").trim(),
        verifierOrganization: String(r["Verifier Organization"] || "").trim(),
        status: (String(r.Status || "Active") === "Inactive" ? "Inactive" : "Active") as Airline["status"],
      })).filter((item) => /^[A-Z0-9]{2}$/.test(item.code) && item.name);
      if (!incoming.length) throw new Error("Tidak ada data airline yang valid.");
      await Promise.all(incoming.map((item) => saveRecord("airlines", { ...item, id: item.code })));
      setAirlineNotice(`${incoming.length} airline berhasil diunggah.`);
    } catch (error) { setAirlineNotice(error instanceof Error ? error.message : "File airline tidak dapat dibaca."); }
  }
  async function saveAirline(e: FormEvent) {
    e.preventDefault();
    const code = airlineDraft.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(code) || !airlineDraft.name || (!editingAirline && airlines.some((item) => item.code === code))) { setAirlineNotice("Kode airline dua karakter dan nama airline wajib valid."); return; }
    const record = { ...airlineDraft, code };
    await saveRecord("airlines", { ...record, id: code });
    setAirlines((rows) => editingAirline ? rows.map((item) => item.code === editingAirline ? record : item) : [...rows, record]);
    setShowAirlineForm(false); setEditingAirline(null);
    setAirlineDraft({ code: "", name: "", verifierOrganization: "", status: "Active" });
    setAirlineNotice(`Airline ${code} berhasil ${editingAirline ? "diperbarui" : "ditambahkan"}.`);
    setActionDialog({ kind: "ok", text: `Airline ${code} berhasil ${editingAirline ? "diperbarui" : "ditambahkan"}.` });
  }
  function downloadEntitlementTemplate() {
    const body = "Type,Name,Reference,Status,Verifier Organization,Eligible Tier,Effective Start,Effective End,Station Scope,Payer,Price Rule,Companion Rule,API Reference Fields\nMembership,GarudaMiles Platinum,Membership policy,Aktif,HO Ancillary,Platinum,2026-01-01,2026-12-31,ALL,Garuda Indonesia,Lounge unit price,1 companion,memberNumber|tier|status";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" })); a.download = "template-access-entitlement.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function uploadEntitlements(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const incoming: Partnership[] = rows.map((r) => ({
        id: crypto.randomUUID(), type: String(r.Type || "Partnership"), name: String(r.Name || "").trim(), reference: String(r.Reference || "").trim(), status: String(r.Status || "Aktif"), allowedRoles: ["Super Admin", "Admin"], verifierOrganization: String(r["Verifier Organization"] || ""), eligibleTiers: String(r["Eligible Tier"] || ""), effectiveStart: String(r["Effective Start"] || ""), effectiveEnd: String(r["Effective End"] || ""), stationScope: String(r["Station Scope"] || "ALL"), payer: String(r.Payer || ""), priceRule: String(r["Price Rule"] || ""), companionRule: String(r["Companion Rule"] || ""), apiReferenceFields: String(r["API Reference Fields"] || "").replaceAll("|", ","), version: 1,
      })).filter((item) => item.name && item.reference);
      if (!incoming.length) throw new Error("Tidak ada data entitlement yang valid.");
      await Promise.all(incoming.map((item) => saveRecord("entitlements", item)));
      setEntitlementNotice(`${incoming.length} access entitlement berhasil diunggah.`);
    } catch (error) { setEntitlementNotice(error instanceof Error ? error.message : "File entitlement tidak dapat dibaca."); }
  }
  async function savePartnership(e: FormEvent) {
    e.preventDefault();
    if (!partnershipDraft.name || !partnershipDraft.reference || !partnershipDraft.allowedRoles.length) return;
    const record = { ...partnershipDraft, id: editingPartnership || crypto.randomUUID() };
    await saveRecord("entitlements", record);
    if (editingPartnership)
      setPartnerships((xs) => xs.map((x) => x.id === editingPartnership ? { ...partnershipDraft, id: x.id } : x));
    else setPartnerships((xs) => [...xs, record]);
    setShowPartnershipForm(false);
    setEditingPartnership(null);
    setEntitlementNotice(`Produk/Agreement berhasil ${editingPartnership ? "diperbarui" : "ditambahkan"}.`);
    setActionDialog({ kind: "ok", text: `Produk/Agreement berhasil ${editingPartnership ? "diperbarui" : "ditambahkan"}.` });
  }
  if (!authReady) {
    return <main className="loginPage"><section className="sessionLoader" aria-live="polite"><img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" /><span>Memulihkan sesi...</span></section></main>;
  }
  if (!currentAccount) {
    return (
      <main className="loginPage">
        <section className="loginPanel">
          <form className="loginCard" onSubmit={login}>
          <div className="loginBrand">
            <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
            <h1>Garuda Access Entitlement System</h1>
          </div>
            <h2>Sign In</h2>
            <label>
              Email atau Username
              <input
                autoFocus
                autoComplete="username"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                placeholder="Masukkan email atau username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Masukkan password"
              />
            </label>
            {loginError && <div className="loginError">{loginError}</div>}
            <button className="primary loginButton">{tr("Masuk", "Sign In")}</button>
          </form>
        </section>
      </main>
    );
  }
  return (
    <main>
      <header className="top">
        <div className="brand">
          <div className="officialLogo">
            <img
              src="/garuda-indonesia-logo.png"
              alt="Garuda Indonesia"
            />
          </div>
          <div>
            <b>GARUDA ACCESS ENTITLEMENT SYSTEM</b>
            <small>Garuda Indonesia Access Entitlement Management</small>
          </div>
        </div>
        <div className="signedUser">
          {languageFeatureEnabled && <button type="button" className="languageToggle" onClick={() => setLanguage(language === "ID" ? "EN" : "ID")} aria-label="Ganti bahasa">
            {language === "ID" ? "EN" : "ID"}
          </button>}
          <div className="profileMenuWrap">
            <button type="button" className="headerAction" aria-expanded={showProfileMenu} onClick={() => setShowProfileMenu((x) => !x)}>{tr("Profil Saya", "My Profile")} <span>⌄</span></button>
            {showProfileMenu && (
              <div className="profileMenu">
                <div className="profileMenuIdentity"><b>{currentAccount.name}</b><span>{role} · {currentAccount.scope}</span></div>
                <button type="button" onClick={() => { setShowInbox(true); setShowProfileMenu(false); }}>{tr("Notifikasi", "Notifications")} <strong>{visitors.filter((v) => v.boStatus !== "Accepted" && !readNotificationIds.has(`${v.boStatus === "Rejected" ? "dispute" : "verify"}-${v.id}`)).length}</strong></button>
                <button type="button" onClick={() => { setShowProfile(true); setShowProfileMenu(false); }}>{tr("Ganti Password", "Change Password")}</button>
                <button type="button" onClick={logout}>{tr("Keluar", "Sign Out")}</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={`shell ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
        <aside>
          <button className="sidebarToggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Buka sidebar" : "Tutup sidebar"}>{sidebarCollapsed ? "›" : "‹"}</button>
          <p>LOUNGE/TENANT</p>
          <nav>
            {canSeeDashboard && <Link href="/?view=dashboard" className={tab === "dashboard" || tab === "dashboard-detail" ? "active" : ""} onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setTab("dashboard"); } }}>
              <i>DB</i><span>Dashboard</span>
            </Link>}
            <Link href="/?view=access"
              className={tab === "access" ? "active" : ""}
              onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setTab("access"); } }}
            >
              <i>LA</i><span>Lounge/Tenant Access</span>
            </Link>
            <Link href="/?view=reconciliation"
              className={tab === "reconciliation" ? "active" : ""}
              onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setTab("reconciliation"); } }}
            >
              <i>VR</i><span>Visitor &amp; Reconciliation</span>
            </Link>
            {role !== "Lounge Officer" && (
              <Link href="/?view=flights"
                className={tab === "flights" ? "active" : ""}
                onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setTab("flights"); } }}
              >
                <i>FI</i><span>Flight Information</span>
              </Link>
            )}
            {isGlobalAdmin && (
              <Link href="/?view=master"
                className={tab === "master" ? "active" : ""}
                onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setTab("master"); } }}
              >
                <i>MD</i><span>Master Data</span>
              </Link>
            )}
          </nav>
        </aside>
        <section className="content">
          {tab === "dashboard" && canSeeDashboard && (
            <>
              <Title eye="MANAGEMENT & MONITORING" title="Dashboard" sub="Ringkasan penggunaan lounge, komposisi pengunjung, utilisasi, biaya, dan kinerja BO sesuai kewenangan akun." />
              <article className="card dashboardFilterCard">
                <div className="dashboardFilters">
                  <FilterField label="Period"><SearchableSelect value={dashboardPeriod} onChange={setDashboardPeriod} options={["All Periods", ...new Set(monitoringRows.map((row) => row.period))]} placeholder="Select period" /></FilterField>
                  <FilterField label="Area"><SearchableSelect value={dashboardArea} onChange={setDashboardArea} options={["All Areas", ...new Set(monitoringRows.map((row) => row.area))]} placeholder="Select area" /></FilterField>
                  <FilterField label="Branch Office"><SearchableSelect value={dashboardBo} onChange={setDashboardBo} options={["All BO", ...new Set(monitoringRows.map((row) => row.bo))]} placeholder="Select BO" /></FilterField>
                  <FilterField label="Lounge / Provider"><SearchableSelect value={dashboardProvider} onChange={setDashboardProvider} options={["All Providers", ...new Set(monitoringRows.map((row) => row.provider))]} placeholder="Select provider" /></FilterField>
                </div>
                <div className="dashboardDataTools">
                  <span><b>Passenger Volume</b><small>Import denominator Business/Economy pax dari DCS/source system atau file BO.</small></span>
                  <button onClick={downloadPassengerVolumeTemplate}>Download Template</button>
                  <label className="uploadButton">Import Passenger Volume<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPassengerVolume(file); e.target.value = ""; }} /></label>
                </div>
                {dashboardImportNotice && <Notice n={{ kind: dashboardImportNotice.includes("could not") ? "warn" : "ok", text: dashboardImportNotice }} close={() => setDashboardImportNotice("")} />}
              </article>

              {visibleDashboardWidgets.some((widget) => widget.id === "summary") && <div className="dashboardKpis">
                <button type="button" onClick={() => openDashboardVisitors()}><span>Total Lounge Visitors</span><b>{dashboardVisitorCount.toLocaleString("id-ID")}</b><small>{dashboardRows.length} BO/provider records <i>View data →</i></small></button>
                <button type="button" onClick={() => { setDashboardDetail("Business Pax"); setTab("dashboard-detail"); }}><span>Business Pax</span><b>{dashboardTotals.businessPax.toLocaleString("id-ID")}</b><small>Source passenger volume <i>View data →</i></small></button>
                <button type="button" onClick={() => { setDashboardDetail("Economy Pax"); setTab("dashboard-detail"); }}><span>Economy Pax</span><b>{dashboardTotals.economyPax.toLocaleString("id-ID")}</b><small>Source passenger volume <i>View data →</i></small></button>
                <button type="button" onClick={() => openDashboardReport()}><span>Estimated Cost</span><b>{cash(dashboardTotals.cost, "IDR")}</b><small>Filtered scope <i>View report →</i></small></button>
              </div>}

              {visibleDashboardWidgets.some((widget) => widget.id === "trend") && <article className="card dashboardTrend">
                <div><h2>{language === "EN" ? "Lounge Visitor Trend" : "Tren Jumlah Pengunjung Lounge"}</h2><span>Agregasi {dashboardTrend.mode.toLowerCase()} menyesuaikan periode terpilih.</span></div>
                <div className="trendPlot">{dashboardTrend.points.length ? dashboardTrend.points.map((point) => <button key={point.label} type="button" title={`${point.label}: ${point.value}`} onClick={() => openDashboardVisitors()}><i style={{ height: `${Math.max(8, point.value / Math.max(...dashboardTrend.points.map((item) => item.value)) * 100)}%` }} /><small>{point.label}</small><b>{point.value}</b></button>) : <p>Belum ada data visitor pada filter ini.</p>}</div>
              </article>}

              <div className="dashboardGrid">
                {visibleDashboardWidgets.some((widget) => widget.id === "composition") && <article className="card dashboardWidget">
                  <h2>{language === "EN" ? dashboardWidgets.find((x) => x.id === "composition")?.titleEn : dashboardWidgets.find((x) => x.id === "composition")?.titleId}</h2>
                  <DonutChart items={dashboardComposition} total={dashboardVisitorCount} centerLabel="Visitors" onSelect={(name) => openDashboardVisitors(name === "Partnership" ? "Kerjasama MPA" : name)} />
                </article>}
                {visibleDashboardWidgets.some((widget) => widget.id === "utilization") && <article className="card dashboardWidget">
                  <h2>{language === "EN" ? dashboardWidgets.find((x) => x.id === "utilization")?.titleEn : dashboardWidgets.find((x) => x.id === "utilization")?.titleId}</h2>
                  <div className="utilizationDonuts">
                    <button type="button" onClick={() => { setDashboardDetail("Business Pax"); setTab("dashboard-detail"); }}><DonutChart compact items={[["Lounge", dashboardTotals.businessLounge], ["Not used", Math.max(0, dashboardTotals.businessPax - dashboardTotals.businessLounge)]]} total={dashboardTotals.businessPax} centerLabel="Business" /><span>Business Lounge / Business Pax</span><small>{dashboardTotals.businessLounge.toLocaleString("id-ID")} dari {dashboardTotals.businessPax.toLocaleString("id-ID")} pax</small></button>
                    <button type="button" onClick={() => { setDashboardDetail("Economy Pax"); setTab("dashboard-detail"); }}><DonutChart compact items={[["Lounge", dashboardVisitorCount - dashboardTotals.businessLounge], ["Not used", Math.max(0, dashboardTotals.economyPax - (dashboardVisitorCount - dashboardTotals.businessLounge))]]} total={dashboardTotals.economyPax} centerLabel="Economy" /><span>Economy Membership Lounge / Economy Pax</span><small>{(dashboardVisitorCount - dashboardTotals.businessLounge).toLocaleString("id-ID")} dari {dashboardTotals.economyPax.toLocaleString("id-ID")} pax</small></button>
                  </div>
                  <p className="formulaNote">Persentase menggunakan denominator passenger volume, bukan hanya data lounge. Nilai produksi dapat berasal dari API/DCS atau impor BO.</p>
                </article>}
                {visibleDashboardWidgets.some((widget) => widget.id === "topBo") && <article className="card dashboardWidget dashboardTableWidget">
                  <h2>{language === "EN" ? dashboardWidgets.find((x) => x.id === "topBo")?.titleEn : dashboardWidgets.find((x) => x.id === "topBo")?.titleId}</h2>
                  <div className="dashboardTableWrap"><table className="dashboardTable"><thead><tr><th>Rank</th><th>Branch Office</th><th>Area</th><th>Total Visitor</th><th>Contribution</th><th>Average / Day</th><th>Average Cost / Visitor</th><th>Total Cost</th></tr></thead><tbody>{dashboardTopBo.map((item, index) => <tr key={item.name}><td><b>{index + 1}</b></td><td><button className="tableLink" onClick={() => openDashboardVisitors("Semua", item.name)}>{item.name} →</button></td><td>{item.area}</td><td>{item.visitors.toLocaleString("id-ID")}</td><td>{dashboardVisitorCount ? (item.visitors / dashboardVisitorCount * 100).toFixed(1) : "0.0"}%</td><td>{(item.visitors / dashboardDays).toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td><td>{cash(item.visitors ? item.cost / item.visitors : 0, "IDR")}</td><td>{cash(item.cost, "IDR")}</td></tr>)}</tbody></table></div>
                </article>}
                {visibleDashboardWidgets.some((widget) => widget.id === "providerCost") && <article className="card dashboardWidget dashboardTableWidget">
                  <h2>{language === "EN" ? dashboardWidgets.find((x) => x.id === "providerCost")?.titleEn : dashboardWidgets.find((x) => x.id === "providerCost")?.titleId}</h2>
                  <div className="dashboardTableWrap"><table className="dashboardTable"><thead><tr><th>Lounge / Provider</th><th>Total Visitor</th><th>Average Cost / Visitor</th><th>Cost Contribution</th><th>Total Cost</th></tr></thead><tbody>{dashboardProviders.map((item) => <tr key={item.name}><td><button className="tableLink" onClick={() => openDashboardReport(item.name)}>{item.name} →</button></td><td>{item.visitors.toLocaleString("id-ID")}</td><td>{cash(item.visitors ? item.cost / item.visitors : 0, "IDR")}</td><td>{dashboardTotals.cost ? (item.cost / dashboardTotals.cost * 100).toFixed(1) : "0.0"}%</td><td>{cash(item.cost, "IDR")}</td></tr>)}</tbody></table></div>
                </article>}
                {visibleDashboardWidgets.some((widget) => widget.id === "workflow") && <article className="card dashboardWidget dashboardWorkflow">
                  <h2>{language === "EN" ? dashboardWidgets.find((x) => x.id === "workflow")?.titleEn : dashboardWidgets.find((x) => x.id === "workflow")?.titleId}</h2>
                  <div><button onClick={() => { setTab("reconciliation"); setReconTab("Pending Verification"); }}><b>{visitors.filter((v) => v.boStatus === "Pending").length}</b> Pending Verification</button><button onClick={() => { setTab("reconciliation"); setReconTab("Dispute & Correction"); }}><b>{visitors.filter((v) => v.boStatus === "Rejected").length}</b> Dispute</button><button onClick={() => { setTab("reconciliation"); setReconTab("Reports & Sign-off"); }}><b>{visitors.filter((v) => v.reconciliationStatus === "Final").length}</b> Final Reconciliation</button></div>
                </article>}
              </div>
              <p className="dashboardFootnote">Dashboard membaca data operasional Firebase sesuai scope akun. Flight Schedule, Passenger List/DCS, membership, payment, dan evidence memerlukan endpoint serta kredensial produksi yang dikonfigurasi Tim IT.</p>
            </>
          )}
          {tab === "dashboard-detail" && canSeeDashboard && (
            <>
              <div className="dashboardDetailHead"><Title eye="DASHBOARD DETAIL" title={dashboardDetail} sub="Passenger volume denominator berdasarkan filter Dashboard aktif." /><button className="secondary" onClick={() => setTab("dashboard")}>← Back to Dashboard</button></div>
              <article className="card tableCard dashboardDetailCard">
                <div className="detailSummary"><span>Period <b>{dashboardPeriod}</b></span><span>Area <b>{dashboardArea}</b></span><span>Branch Office <b>{dashboardBo}</b></span><span>Provider <b>{dashboardProvider}</b></span><span>Total <b>{(dashboardDetail === "Business Pax" ? dashboardTotals.businessPax : dashboardTotals.economyPax).toLocaleString("id-ID")}</b></span></div>
                <div className="tableWrap"><table><thead><tr><th>Period</th><th>Area</th><th>Branch Office</th><th>Station</th><th>Lounge / Provider</th><th>{dashboardDetail}</th><th>Source</th></tr></thead><tbody>{dashboardRows.map((row) => <tr key={row.id}><td>{row.period}</td><td>{row.area}</td><td><button className="tableLink" onClick={() => openDashboardVisitors("Semua", row.bo, row.provider)}>{row.bo} →</button></td><td>{row.station}</td><td>{row.provider}</td><td><b>{(dashboardDetail === "Business Pax" ? row.businessPax : row.economyPax).toLocaleString("id-ID")}</b></td><td>{row.source}</td></tr>)}</tbody></table></div>
              </article>
            </>
          )}
          {tab === "access" && (
            <>
              <Title
                eye="OPERASIONAL AKSES"
                title="Lounge/Tenant Access"
                sub="Scan boarding pass atau gunakan fallback input manual saat scanner terkendala."
              />
              <div className="timeStrip">
                <div><span>LOCAL DATE &amp; TIME</span><b>{displayClock}</b></div>
                <small>{tr("Waktu transaksi mengikuti station aktif. Pilih Date of Travel sebelum scan agar flight schedule yang diperiksa tepat.", "Transaction time follows the active station. Select Date of Travel before scanning to confirm the correct flight schedule.")}</small>
              </div>
              {notice && <Notice n={notice} close={() => setNotice(null)} />}
              <div className="accessGrid">
                <article className="card">
                  <CardTitle
                    step="LANGKAH 1"
                    title="Pilih DOT & Baca Boarding Pass"
                    right="Siap"
                  />
                  <label className="dotFirst">
                    Date of Travel (DOT) <em>*</em>
                    <input type="date" value={accessTravelDate} onChange={(e) => {
                      resetAccessCapture();
                      setAccessTravelDate(e.target.value);
                      if (manualMode) setPass({ ...emptyPass, travelDate: e.target.value, dateSource: "Selected" });
                    }} />
                    <small>Pilih tanggal penerbangan sebelum memulai scan.</small>
                  </label>
                  <div className="selectRow">
                    <label>
                      Airport
                      <select
                        value={airport}
                        onChange={(e) => {
                          setAirport(e.target.value);
                          const x = lounges.find(
                            (l) => l.airport === e.target.value,
                          );
                          if (x) setLoungeId(x.id);
                        }}
                      >
                        {[...new Set(lounges.map((l) => l.airport))].map(
                          (x) => (
                            <option key={x}>{x}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Lounge/Tenant
                      <select
                        value={loungeId}
                        onChange={(e) => setLoungeId(e.target.value)}
                      >
                        {lounges
                          .filter((l) => l.airport === airport)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className={`camera ${camera ? "on" : ""}`}>
                    <video ref={video} muted playsInline />
                    <div />
                    <span>
                      {camera
                        ? "Posisikan kode di dalam bingkai"
                        : "Kamera belum aktif"}
                    </span>
                  </div>
                  <div className="buttons">
                    <button
                      className="primary"
                      onClick={() => {
                        setManualMode(false);
                        resetAccessCapture();
                        void toggleCamera();
                      }}
                    >
                      {camera ? "Hentikan Kamera" : "Mulai Scan Camera"}
                    </button>
                    <button
                      className={scanner ? "scannerOn" : "secondary"}
                      onClick={() => {
                        setManualMode(false);
                        resetAccessCapture();
                        setScanner(!scanner);
                      }}
                    >
                      {scanner
                        ? "Device Scanner Aktif"
                        : "Aktifkan Device Scanner"}
                    </button>
                  </div>
                  <div className="or">ATAU INPUT STRING</div>
                  <label>
                    Hasil scan / string boarding pass
                    <textarea
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                      placeholder="Nama: BUDI SANTOSO | Flight: GA204 | Sequence: 037 | Eligible: Y"
                    />
                  </label>
                  <button
                    className="link"
                    disabled={!raw.trim()}
                    onClick={() => {
                      setManualMode(false);
                      read(raw);
                    }}
                  >
                    Baca String dan Tampilkan Data
                  </button>
                  <div className="manualFallback">
                    <span>Scanner atau barcode bermasalah?</span>
                    <button
                      className="secondary"
                      onClick={() => {
                        setManualMode(true);
                        resetAccessCapture();
                        setPass({ ...emptyPass, travelDate: accessTravelDate, dateSource: "Selected" });
                        setManualMember("Tidak Ada / Lainnya");
                      }}
                    >
                      Gunakan Input Manual
                    </button>
                  </div>
                </article>
                <form className="card" onSubmit={save}>
                  <CardTitle
                    step="LANGKAH 2–3"
                    title={
                      manualMode
                        ? "Fallback Input Manual"
                        : "Preview & Konfirmasi"
                    }
                    right={
                      pass.eligible === "Y"
                        ? "ELIGIBLE"
                        : manualMode && pass.eligible === "N"
                          ? "TIDAK ELIGIBLE"
                          : "MENUNGGU SCAN"
                    }
                    bad={pass.eligible === "N"}
                  />
                  {manualMode && (
                    <div className="manualInfo">
                      Eligibility tidak diisi petugas. Sistem menghitung
                      otomatis dari kelas kabin dan membership.
                    </div>
                  )}
                  <div className="form">
                    <label className="full">
                      Nama Penumpang
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.name}
                        onChange={(e) =>
                          setPass({ ...pass, name: e.target.value })
                        }
                        placeholder="Nama sesuai boarding pass"
                      />
                    </label>
                    <label>
                      Rute
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.route}
                        onChange={(e) =>
                          setPass({
                            ...pass,
                            route: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="DJB–CGK"
                      />
                    </label>
                    <label>
                      Nomor Penerbangan
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.flight}
                        onChange={(e) =>
                          setPass({
                            ...pass,
                            flight: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="GA127"
                      />
                    </label>
                    <label className="dotPreviewField">
                      Date of Travel
                      <input
                        type="date"
                        readOnly
                        className="autoField"
                        value={pass.travelDate}
                      />
                      <small className="fieldAlignmentHint">{pass.travelDate ? `Sumber: ${pass.dateSource || "Manual"}` : <>&nbsp;</>}</small>
                    </label>
                    <label className="cabinPreviewField">
                      Kelas Kabin
                      {manualMode ? (
                        <select
                          value={pass.cabin}
                          onChange={(e) =>
                            setPass({ ...pass, cabin: e.target.value })
                          }
                        >
                          <option value="">Pilih kelas</option>
                          <option value="C">C — Business Class</option>
                          <option value="Y">Y — Economy Class</option>
                        </select>
                      ) : (
                        <input
                          readOnly
                          className="autoField"
                          value={pass.cabin}
                          onChange={(e) =>
                            setPass({
                              ...pass,
                              cabin: e.target.value.toUpperCase(),
                            })
                          }
                          placeholder="C / Y"
                        />
                      )}
                      <small className="fieldAlignmentHint" aria-hidden="true">&nbsp;</small>
                    </label>
                    <label>
                      Nomor Kursi
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.seat}
                        onChange={(e) =>
                          setPass({
                            ...pass,
                            seat: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="7A"
                      />
                    </label>
                    <label>
                      Check-in Sequence
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.seq}
                        onChange={(e) =>
                          setPass({ ...pass, seq: e.target.value })
                        }
                        placeholder="107"
                      />
                    </label>
                    <label>
                      Nomor Tiket
                      <input
                        readOnly={!manualMode}
                        className={!manualMode ? "autoField" : ""}
                        value={pass.ticket}
                        onChange={(e) =>
                          setPass({ ...pass, ticket: e.target.value })
                        }
                        placeholder="12621456749680"
                      />
                    </label>
                    {manualMode && (
                      <label>
                        Membership
                        <select
                          value={manualMember}
                          onChange={(e) => setManualMember(e.target.value)}
                        >
                          <option>Tidak Ada / Lainnya</option>
                          <option>Platinum</option>
                          <option>Elite Plus</option>
                        </select>
                      </label>
                    )}
                    <label>
                      Status Eligibility
                      <input
                        className={pass.eligible === "Y" ? "eligibleField" : ""}
                        value={
                          pass.eligible === "Y"
                            ? "Y — Eligible"
                            : pass.eligible === "N"
                              ? "N — Tidak Eligible"
                              : "Terisi otomatis"
                        }
                        readOnly
                      />
                    </label>
                    <label>
                      Kategori Akses
                      <select
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value);
                          setReference("");
                          setMemberStatus("Belum diverifikasi");
                        }}
                      >
                        {cats.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    {required && (
                      <label className="full">
                        {refLabel} <em>*</em>
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder={`Masukkan ${refLabel.toLowerCase()}`}
                        />
                      </label>
                    )}
                    {["Platinum", "Elite Plus", "DPR", "Partner Airline / SkyTeam"].includes(category) && (
                      <div className="full companionPanel">
                        <div><b>Companion</b><span>Isi manual bila entitlement memperbolehkan pendamping.</span></div>
                        <label>Jumlah Pendamping<input type="number" min="0" max="5" value={companionCount} onChange={(e) => setCompanionCount(Math.max(0, Number(e.target.value)))} /></label>
                        {companionCount > 0 && <>
                          <label>Kategori Pendamping<select value={companionCategory} onChange={(e) => { setCompanionCategory(e.target.value); if (!e.target.value.includes("Membership")) setCompanionMembership(""); }}><option>Platinum</option><option>DPR</option><option>Membership Lainnya</option><option>Lainnya</option></select></label>
                          {companionCategory.includes("Membership") && <label>Nomor Membership<input value={companionMembership} onChange={(e) => setCompanionMembership(e.target.value)} placeholder="Nomor membership pendamping" /></label>}
                        </>}
                      </div>
                    )}
                    {["Platinum", "Elite Plus"].includes(category) && (
                      <div className="full inlineVerify">
                        <div>
                          <b>Membership Verification</b>
                          <span>
                            Mode {memberMode} · source eksternal disimulasikan
                          </span>
                          <small>{memberStatus}</small>
                        </div>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!reference.trim()}
                          onClick={() =>
                            setMemberStatus(
                              category === "Platinum"
                                ? "Verified Platinum · Active"
                                : "Verified Elite Plus · Active",
                            )
                          }
                        >
                          Verifikasi Member
                        </button>
                      </div>
                    )}
                    {category === "Kerjasama MPA" && (
                      <div className="full inlineVerify">
                        <div>
                          <b>Partnership Validation</b>
                          <span>
                            Agreement, validity, quota, dan rate akan diperiksa.
                          </span>
                          <small>
                            {partnerRef || "Reference belum divalidasi"}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!reference.trim()}
                          onClick={() =>
                            setPartnerRef(
                              "Partner reference valid · Agreement active",
                            )
                          }
                        >
                          Validasi Partner
                        </button>
                      </div>
                    )}
                    {category === "EMD" && (
                      <div className="full inlineVerify">
                        <div>
                          <b>EMD Validation</b>
                          <span>
                            Name, flight, coupon status, dan riwayat redemption.
                          </span>
                          <small>{partnerRef || "EMD belum divalidasi"}</small>
                        </div>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!reference.trim()}
                          onClick={() =>
                            setPartnerRef(
                              "EMD valid · Coupon OPEN · Belum digunakan",
                            )
                          }
                        >
                          Validasi EMD
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="dupe">
                    <b>Pemeriksaan duplikat otomatis</b>
                    <span>Passenger + Flight + Check-in Sequence + Date of Travel</span>
                  </div>
                  <button className="confirm" disabled={pass.eligible !== "Y"}>
                    {manualMode
                      ? "Verifikasi & Simpan Data Manual"
                      : "Konfirmasi Akses & Simpan Visitor"}
                  </button>
                </form>
              </div>
              {camera && (
                <div className="scanHelp">
                  <b>Scanner aktif</b>
                  <span>{scanStatus}</span>
                  <small>
                    Mendukung QR Code, PDF417, Aztec, Data Matrix, Code 128, EAN
                    dan format barcode umum lainnya.
                  </small>
                </div>
              )}
            </>
          )}
          {tab === "reconciliation" && (
            <>
              <Title
                eye="VISITOR CONTROL"
                title="Visitor & Reconciliation"
                sub="Verifikasi, dispute, rekonsiliasi, laporan, dan sign-off BO–Vendor dalam satu proses."
              />
              <SubTabs
                items={[
                  "Visitor List",
                  "Pending Verification",
                  "Verifier Review",
                  "Dispute & Correction",
                  "Reports & Sign-off",
                ]}
                value={reconTab}
                setValue={setReconTab}
              />
              {reconTab === "Visitor List" && (
                <>
                  <div className="title actionTitle">
                    <Title
                      eye="DATA KUNJUNGAN"
                      title="Visitor List"
                      sub="Traffic per jam, Date of Travel, status rekonsiliasi, dan biaya sesuai kewenangan akun."
                    />
                    <div>
                      {role === "Super Admin" && <button onClick={() => { setManageTableContext("Visitor List"); setShowManageTable(true); }}>Manage Table</button>}
                      <button onClick={csv}>Unduh CSV</button>
                      <button
                        className="primary"
                        onClick={() => void pdf()}
                        disabled={!payableShown.some((v) => v.reconciliationStatus === "Final")}
                      >
                        Unduh PDF
                      </button>
                      <button
                        className="danger"
                        onClick={() => askDelete("Kosongkan seluruh visitor?", "Semua data visitor pada perangkat ini akan dihapus. Activity Log produksi tetap dipertahankan.", () => setVisitors([]))}
                      >
                        Kosongkan Data Uji
                      </button>
                    </div>
                  </div>
                  <article className="card trafficCard">
                    <div className="trafficHead">
                      <div><span>AVERAGE PASSENGER TRAFFIC PER HOUR</span><h2>Peak Hour Visitor</h2></div>
                      <button className={visitorFiltersActive ? "primary" : "secondary"} onClick={() => setVisitorFiltersActive((x) => !x)}>{visitorFiltersActive ? "Filter Aktif" : "Aktifkan Filter"}</button>
                    </div>
                    {visitorFiltersActive && (
                      <div className="advancedFilters">
                        <label>Periode mulai<input type="date" value={visitorDateFrom} onChange={(e) => setVisitorDateFrom(e.target.value)} /></label>
                        <label>Periode akhir<input type="date" value={visitorDateTo} onChange={(e) => setVisitorDateTo(e.target.value)} /></label>
                        <label>Jam mulai<input type="time" value={visitorTimeFrom} onChange={(e) => setVisitorTimeFrom(e.target.value)} /></label>
                        <label>Jam akhir<input type="time" value={visitorTimeTo} onChange={(e) => setVisitorTimeTo(e.target.value)} /></label>
                      </div>
                    )}
                    <div className="trafficSummary">
                      <span>Rata-rata/jam <b>{(shown.length / 24 / Math.max(trafficDates.length, 1)).toFixed(1)}</b></span>
                      <span>Peak hour <b>{String(peak.hour).padStart(2, "0")}:00</b></span>
                      <span>Peak traffic <b>{peak.average.toFixed(1)}</b></span>
                      <span>Accepted <b>{shown.filter((v) => v.boStatus === "Accepted").length}</b></span>
                      <span>Declined <b>{shown.filter((v) => v.boStatus === "Rejected").length}</b></span>
                    </div>
                    <div className="trafficChart" aria-label="Grafik rata-rata visitor per jam">
                      {traffic.map((item) => <div className="trafficBarCell" key={item.hour} title={`${String(item.hour).padStart(2, "0")}:00 · rata-rata ${item.average.toFixed(1)} · total ${item.total}`}><div className="trafficBar" style={{ height: `${Math.max(item.average ? 8 : 1, item.average / trafficMax * 100)}%` }} /><small>{String(item.hour).padStart(2, "0")}</small></div>)}
                    </div>
                  </article>
                  <div className="stats">
                    <div>
                      <span>Total Visitor — Filtered Rows</span>
                      <b>{shown.length}</b>
                      <small>
                        {effectiveVisitorFilter === "Semua"
                          ? "seluruh Branch Office"
                          : `Branch Office ${effectiveVisitorFilter}`}
                      </small>
                    </div>
                    <div>
                      <span>Confirmed / Payable Visitor</span>
                      <b>{payableShown.length}</b>
                      <small>Accepted sesuai filter aktif</small>
                    </div>
                    {Object.entries(totals).map(([c, n]) => (
                      <div key={c}>
                        <span>Total Biaya {c}</span>
                        <b>{cash(n, c)}</b>
                        <small>Total hanya menghitung visitor Accepted sesuai filter aktif.</small>
                      </div>
                    ))}
                  </div>
                  <article className="card tableCard">
                    <div className="filters threeFilters">
                      <FilterField label="Station"><SearchableSelect value={effectiveVisitorFilter} disabled={!isGlobalAdmin} onChange={setFilter} options={["Semua", ...new Set(visitors.map((v) => v.airport))]} placeholder="Station" /></FilterField>
                      <FilterField label="Passenger Category"><SearchableSelect value={visitorCategoryFilter} onChange={setVisitorCategoryFilter} options={["Semua", ...new Set(visitors.map((v) => v.category))]} placeholder="Passenger Category" /></FilterField>
                      <FilterField label="Visitor Status"><SearchableSelect value={visitorStatusFilter} onChange={setVisitorStatusFilter} options={["All Status", "Accepted", "Declined", "Pending"]} placeholder="Visitor Status" /></FilterField>
                      <FilterField label="Search Visitor"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama / flight / lounge" /></FilterField>
                      <span>{shown.length} data ditemukan</span>
                    </div>
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            <SortTh label="No." sortKey="no" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Scan / Date of Travel" sortKey="date" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Airport" sortKey="airport" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Penumpang" sortKey="name" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Flight / Seq." sortKey="flight" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Kategori & Referensi" sortKey="category" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Lounge/Tenant" sortKey="lounge" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Harga/Pax" sortKey="price" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            <SortTh label="Status" sortKey="status" current={visitorSort} onSort={(key) => setVisitorSort((s) => nextSort(s, key))} />
                            {customColumns.filter((c) => c.visible).map((c) => <th key={c.id}>{c.label}</th>)}
                            <th>Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.length ? (
                            shown.map((v, i) => (
                              <tr key={v.id}>
                                <td>{i + 1}</td>
                                <td>
                                  {v.date}
                                  <small>{v.time}</small>
                                  <small>Travel: {v.travelDate || v.date}</small>
                                </td>
                                <td>
                                  <b>{v.airport}</b>
                                </td>
                                <td>
                                  {v.name}
                                  <small>{v.source}</small>
                                </td>
                                <td>
                                  {v.flight}
                                  <small>Seq. {v.seq}</small>
                                </td>
                                <td>
                                  {v.category}
                                  <small>{v.reference || "—"}</small>
                                </td>
                                <td className="wide">{v.lounge}</td>
                                <td>{cash(v.price, v.currency)}</td>
                                <td><mark className={v.boStatus === "Accepted" ? "green" : v.boStatus === "Rejected" ? "red" : "yellow"}>{v.boStatus}</mark><small>{v.verifier || "Verifier belum ditentukan"}</small></td>
                                {customColumns.filter((c) => c.visible).map((c) => <td key={c.id}>{customValue(v, c)}</td>)}
                                <td>
                                  <div className="rowAct">
                                    <button onClick={() => setEdit(v)}>
                                      Ubah
                                    </button>
                                    <button
                                      className="del"
                                      onClick={() => askDelete("Hapus data visitor?", `${v.name} · ${v.flight} · ${v.travelDate || v.date}`, () => setVisitors((x) => x.filter((y) => y.id !== v.id)))}
                                    >
                                      Hapus
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={10 + customColumns.filter((c) => c.visible).length}>
                                <div className="empty">
                                  <b>Belum ada data visitor</b>
                                  <span>
                                    Lakukan pengujian dari menu Lounge/Tenant
                                    Access.
                                  </span>
                                  <button onClick={() => setTab("access")}>
                                    Mulai Pengujian
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={8 + customColumns.filter((c) => c.visible).length}>
                              <b>
                                Filtered Total{" "}
                                {effectiveVisitorFilter === "Semua"
                                  ? "Seluruh Branch Office"
                                  : `BO ${effectiveVisitorFilter}`}{" "}
                                · {shown.length} rows · {payableShown.length} confirmed/payable
                              </b>
                            </td>
                            <td colSpan={2}>
                              <b>
                                {Object.entries(totals)
                                  .map(([c, n]) => `${cash(n, c)}`)
                                  .join(" · ") || "—"}
                              </b>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </article>
                </>
              )}
              {reconTab === "Pending Verification" && (
                <ProcessPanel
                  title="Pending Verification"
                  description="Data membership, EMD, dan partnership yang menunggu validasi."
                  items={[
                    "Membership Pending — nomor member menunggu source eksternal",
                    "EMD Pending — coupon belum diredeem",
                    "Partner Reference Pending — menunggu konfirmasi agreement",
                  ]}
                  action="Jalankan Verifikasi Ulang"
                />
              )}
              {reconTab === "Verifier Review" && (
                <VerificationPanel
                  visitors={verificationQueue}
                  role={role === "BO Admin" ? "Branch Office" : role === "HO Ancillary Verifier" ? "HO Ancillary" : role === "Airline Verifier" ? currentAccount.organization : "Authorized Verifier"}
                  canAct={canBOVerify}
                  visibleColumns={verificationColumns}
                  onManageTable={role === "Super Admin" ? () => { setManageTableContext("Verification"); setShowManageTable(true); } : undefined}
                  statusKey="boStatus"
                  acceptLabel="Terima"
                  rejectReasons={disputeCodes}
                  onDecision={(ids, decision, reason) =>
                    setVisitors((xs) =>
                      xs.map((x) =>
                        ids.includes(x.id)
                          ? {
                              ...x,
                              boStatus: decision === "accept" ? "Accepted" : "Rejected",
                              boReason: decision === "accept" ? "" : reason,
                              disputeCode: decision === "accept" ? "" : reason.split(" — ")[0],
                              vendorStatus: "Pending",
                              reconciliationStatus: decision === "accept" ? "Final" : "Open",
                            }
                          : x,
                      ),
                    )
                  }
                />
              )}
              {reconTab === "Dispute & Correction" && (
                <article className="card tableCard">
                  <div className="miniHead">
                    <div>
                      <h2>Dispute & Correction</h2>
                      <span>Data yang ditolak verifier dikembalikan kepada Lounge Officer. Tombol koreksi hanya muncul untuk data yang memerlukan respons Lounge sesuai scope akun.</span>
                    </div>
                    <mark className="yellow">
                      {shown.filter((x) => x.boStatus === "Rejected").length} DISPUTE
                    </mark>
                  </div>
                  <div className="tableWrap">
                    <table>
                      <thead><tr>
                        <SortTh label="Penumpang" sortKey="name" current={disputeSort} onSort={(key) => setDisputeSort((s) => nextSort(s, key))} />
                        <SortTh label="Flight" sortKey="flight" current={disputeSort} onSort={(key) => setDisputeSort((s) => nextSort(s, key))} />
                        <SortTh label="Alasan Penolakan" sortKey="reason" current={disputeSort} onSort={(key) => setDisputeSort((s) => nextSort(s, key))} />
                        <SortTh label="Status" sortKey="status" current={disputeSort} onSort={(key) => setDisputeSort((s) => nextSort(s, key))} />
                        <th>Aksi</th>
                      </tr></thead>
                      <tbody>
                        {shown.filter((x) => x.boStatus === "Rejected").length ? shown
                          .filter((x) => x.boStatus === "Rejected")
                          .sort((a, b) => {
                            const av = disputeSort.key === "name" ? a.name : disputeSort.key === "flight" ? a.flight : disputeSort.key === "reason" ? a.boReason : a.boStatus;
                            const bv = disputeSort.key === "name" ? b.name : disputeSort.key === "flight" ? b.flight : disputeSort.key === "reason" ? b.boReason : b.boStatus;
                            return av.localeCompare(bv) * (disputeSort.direction === "asc" ? 1 : -1);
                          })
                          .map((v) => (
                            <tr key={v.id}>
                              <td>{v.name}<small>{v.category}</small></td>
                              <td>{v.flight}<small>{v.route}</small></td>
                              <td>{v.boReason || "Tidak dijelaskan"}</td>
                              <td><mark className="red">Menunggu Respons Lounge</mark>{v.evidenceName && <small>Evidence: {v.evidenceName}</small>}</td>
                              <td>
                                {canVendorConfirm ? (
                                  <div className="rowAct disputeActions">
                                    <button className="primary" onClick={() => { setEvidenceVisitor(v); setEvidenceName(""); }}>Koreksi &amp; Evidence</button>
                                    <button onClick={() => setVisitors((xs) => xs.map((x) => x.id === v.id ? { ...x, vendorStatus: "Confirmed", reconciliationStatus: "Final" } : x))}>Terima Penolakan</button>
                                  </div>
                                ) : <span className="statusText">Menunggu koreksi petugas lounge</span>}
                              </td>
                            </tr>
                          )) : (
                            <tr><td colSpan={5}><div className="empty">Belum ada data dispute.</div></td></tr>
                          )}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
              {reconTab === "Reports & Sign-off" && (
                <article className="card signoff">
                  <CardTitle
                    step="PERIOD CLOSING"
                    title="Reports & Sign-off"
                    right={
                      boSigned && vendorSigned ? "FINAL & LOCKED" : "DRAFT"
                    }
                  />
                  <div className="filters threeFilters reportFilters">
                    <FilterField label="Station"><SearchableSelect value={effectiveVisitorFilter} disabled={!isGlobalAdmin} onChange={(value) => { setFilter(value); setReportLoungeFilter("Semua"); }} options={["Semua", ...new Set(visitors.map((v) => v.airport))]} placeholder="Station" /></FilterField>
                    <FilterField label="Start Date"><input type="date" value={visitorDateFrom} onChange={(e) => { setVisitorDateFrom(e.target.value); setVisitorFiltersActive(Boolean(e.target.value || visitorDateTo)); }} /></FilterField>
                    <FilterField label="End Date"><input type="date" min={visitorDateFrom} value={visitorDateTo} onChange={(e) => { setVisitorDateTo(e.target.value); setVisitorFiltersActive(Boolean(e.target.value || visitorDateFrom)); }} /></FilterField>
                    <FilterField label="Passenger Category"><SearchableSelect value={visitorCategoryFilter} onChange={setVisitorCategoryFilter} options={["Semua", ...new Set(visitors.map((v) => v.category))]} placeholder="Passenger Category" /></FilterField>
                    <FilterField label="Lounge / Provider"><SearchableSelect value={reportLoungeFilter} onChange={setReportLoungeFilter} options={["Semua", ...new Set(visitors.filter((v) => effectiveVisitorFilter === "Semua" || v.airport === effectiveVisitorFilter).map((v) => v.lounge))]} placeholder="Lounge / Provider" /></FilterField>
                    <FilterField label="Search Visitor"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama penumpang / flight / lounge" /></FilterField>
                    <span>{visitorDateFrom || "All Date"}{visitorDateTo ? ` – ${visitorDateTo}` : ""} · {reportFilteredShown.length} filtered · {reportPayableShown.length} confirmed</span>
                  </div>
                  <div className={`reconciliationGate ${reportReconciliationReady ? "ready" : "blocked"}`}>
                    <b>{reportReconciliationReady ? "Rekonsiliasi periode selesai" : "Sign-off belum tersedia"}</b>
                    <span>{reportReconciliationReady ? "Seluruh visitor pada hasil filter telah memiliki keputusan final." : `${reportFilteredShown.filter((v) => v.boStatus === "Pending" || (v.boStatus === "Rejected" && v.reconciliationStatus !== "Final")).length} data pada hasil filter masih pending/dispute.`}</span>
                  </div>
                  <div className="reportButtons singleReportTools">
                    {canManageMaster && <button onClick={() => setShowManageReport(true)}>Manage Report</button>}
                    <label className="costToggle"><input type="checkbox" checked={reportConfig.includeCost} onChange={(e) => setReportConfig({ ...reportConfig, includeCost: e.target.checked })} /> Additional Info Cost/Price</label>
                    <label className="costToggle"><input type="checkbox" checked={reportConfig.includeEvidenceAppendix} onChange={(e) => setReportConfig({ ...reportConfig, includeEvidenceAppendix: e.target.checked })} /> Evidence Appendix</label>
                  </div>
                  {boSigned && vendorSigned && <div className="reopenWorkflow">
                    <b>Reopen Reconciliation</b><span>BO submits a request; Admin approves or rejects with an audit reason and report revision.</span>
                    {role === "BO Admin" && reopenStatus === "Closed" && <button onClick={() => setReopenStatus("Requested")}>Request Reopen</button>}
                    {role === "Admin" && reopenStatus === "Requested" && <button className="primary" onClick={() => { setReopenStatus("Approved"); setBoSigned(false); setVendorSigned(false); setVisitors((xs) => xs.map((v) => ({ ...v, reportRevision: (v.reportRevision || 1) + 1 }))); }}>Approve Reopen</button>}
                    <mark className={reopenStatus === "Requested" ? "yellow" : reopenStatus === "Approved" ? "green" : ""}>{reopenStatus}</mark>
                  </div>}
                  <div className="stats">
                    <div>
                      <span>Confirmed Visitor</span>
                      <b>{reportPayableShown.length}</b>
                      <small>sesuai seluruh filter report</small>
                    </div>
                    {Object.entries(reportTotals).map(([c, n]) => (
                      <div key={c}>
                        <span>Total Biaya {c}</span>
                        <b>{cash(n, c)}</b>
                        <small>Confirmed/final visitor sesuai periode, station, category, lounge, dan pencarian</small>
                      </div>
                    ))}
                  </div>
                  <div className="signGrid roleSignGrid">
                    <div className="signParty">
                      <span>BRANCH OFFICE</span>
                      <b>{boSigner || "Belum ditandatangani"}</b>
                      <mark className={boSigned ? "green" : "yellow"}>{boSigned ? "SIGNED" : "MENUNGGU BO"}</mark>
                      {canBOVerify && !boSigned && (
                        <>
                          <label>Nama & Jabatan BO<input value={boSigner} onChange={(e) => setBoSigner(e.target.value)} /></label>
                          <button className="primary" disabled={!boSigner || !reportReconciliationReady} onClick={() => setBoSigned(true)}>Approve & Sign as BO</button>
                        </>
                      )}
                    </div>
                    <div className="signParty">
                      <span>VENDOR / PENGELOLA LOUNGE</span>
                      <b>{vendorSigner || "Belum ditandatangani"}</b>
                      <mark className={vendorSigned ? "green" : "yellow"}>{vendorSigned ? "SIGNED" : boSigned ? "MENUNGGU VENDOR" : "MENUNGGU BO"}</mark>
                      {canVendorConfirm && !vendorSigned && (
                        <>
                          <label>Nama & Jabatan Vendor<input value={vendorSigner} onChange={(e) => setVendorSigner(e.target.value)} /></label>
                          <button className="primary" disabled={!vendorSigner || !boSigned || !reportReconciliationReady} onClick={() => setVendorSigned(true)}>Approve & Sign as Vendor</button>
                        </>
                      )}
                    </div>
                  </div>
                  {!canBOVerify && !canVendorConfirm && (
                    <div className="info"><b>Status laporan saja</b><br />Role Anda dapat memantau status, tetapi tidak dapat menandatangani sebagai BO maupun Vendor.</div>
                  )}
                  <div className="modalActions">
                    <button
                      className="primary"
                      onClick={() => void pdf()}
                      disabled={!reportReconciliationReady || !boSigned || !vendorSigned || !reportPayableShown.length}
                    >
                      Download Reconciliation Report PDF
                    </button>
                  </div>
                  {boSigned && vendorSigned && (
                    <div className="notice ok">
                      <b>FINAL</b>
                      <span>
                        Laporan telah disetujui BO dan Vendor. Pada produksi,
                        periode akan dikunci dan perubahan menggunakan
                        adjustment report.
                      </span>
                    </div>
                  )}
                </article>
              )}
            </>
          )}
          {tab === "master" && (
            <>
              <Title
                eye="SYSTEM CONFIGURATION"
                title="Master Data"
                sub="Data referensi dan rule operasional sesuai kewenangan pengguna."
              />
              <SubTabs
                items={[
                  "Master Lounge/Tenant",
                  "Master Station",
                  "Master Airline",
                  "User & Role",
                  "Access Entitlement",
                  "Operational Rule",
                  ...(role === "Super Admin" ? ["Portal Management"] : []),
                  "Activity Log",
                ]}
                value={masterTab}
                setValue={(value) => {
                  setMasterTab(value);
                  setMasterQuery("");
                  setMasterSelect("Semua");
                  setMasterSelect2("Semua");
                }}
              />
            </>
          )}
          {tab === "master" && masterTab === "Master Lounge/Tenant" && (
            <>
              <div className="title actionTitle">
                <Title
                  eye="MASTER DATA"
                  title="Daftar Lounge/Tenant"
                  sub="Referensi lokasi, masa kerja sama, dan harga untuk perhitungan visitor."
                />
                {canManageMaster && (
                  <div>
                    <button onClick={() => setMasterTableTarget("Master Lounge/Tenant")}>Kelola Tabel</button>
                    <button onClick={async () => {
                      if (!firebaseUser) return;
                      try { const result = await syncSourceLounges(firebaseUser); setLoungeNotice(`${result.imported} data lounge/tenant berhasil disinkronkan dari Ground Experience Portal.`); }
                      catch (error) { setLoungeNotice(error instanceof Error ? error.message : "Sinkronisasi gagal."); }
                    }}>Sinkronisasi Data</button>
                    <button onClick={downloadLoungeTemplate}>
                      Unduh Template CSV
                    </button>
                    <label className="uploadButton">
                      Upload Data
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadLounges(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="primary"
                      onClick={() => {
                        setEditingLounge(null);
                        setLoungeDraft({
                          airport: "",
                          name: "",
                          type: "Lounge",
                          currency: "IDR",
                          price: 0,
                          start: localDate(),
                          end: "",
                          status: "Aktif",
                        });
                        setShowLoungeForm(true);
                      }}
                    >
                      + Tambah Lounge
                    </button>
                  </div>
                )}
              </div>
              {loungeNotice && (
                <Notice
                  n={{
                    kind: loungeNotice.includes("berhasil") ? "ok" : "error",
                    text: loungeNotice,
                  }}
                  close={() => setLoungeNotice("")}
                />
              )}
              <MasterFilterBar
                query={masterQuery}
                setQuery={setMasterQuery}
                value={masterSelect}
                setValue={setMasterSelect}
                options={[...new Set(lounges.map((x) => x.airport))]}
                value2={masterSelect2}
                setValue2={setMasterSelect2}
                options2={[...new Set([...lounges.map((x) => x.type), ...lounges.map((x) => x.status)])]}
                placeholder="Nama Lounge / Provider"
                label1="Station"
                label2="Lounge Type / Status"
                searchLabel="Lounge / Provider"
                queryOptions={["Semua Lounge / Provider", ...new Set(lounges.map((x) => x.name))]}
                count={filteredLounges.length}
              />
              <div className="loungeGrid">
                {filteredLounges.map((l) => {
                  const d = Math.ceil(
                    (new Date(l.end).getTime() - Date.now()) / 86400000,
                  );
                  return (
                    <article className="card lounge" key={l.id}>
                      <div className="code">{l.airport}</div>
                      <div>
                        <span className="type">{l.type}</span>
                        <h3>{l.name}</h3>
                        <p>
                          Periode kerja sama
                          <br />
                          <b>
                            {l.start} — {l.end}
                          </b>
                        </p>
                        <p>
                          Harga per pax
                          <br />
                          <b>{cash(l.price, l.currency)}</b>
                        </p>
                        {canManageMaster && (
                          <div className="rowAct">
                            <button
                              className="loungeEdit"
                              onClick={() => {
                                setEditingLounge(l.id);
                                setLoungeDraft({
                                  airport: l.airport,
                                  name: l.name,
                                  type: l.type,
                                  currency: l.currency,
                                  price: l.price,
                                  start: l.start,
                                  end: l.end,
                                  status: l.status,
                                });
                                setShowLoungeForm(true);
                              }}
                            >
                              Update
                            </button>
                            <button
                              className="del"
                              onClick={() => askDelete("Hapus lounge/tenant?", `${l.airport} · ${l.name}`, async () => { await removeRecord("lounges", l.id); setLounges((xs) => xs.filter((x) => x.id !== l.id)); })}
                            >
                              Hapus
                            </button>
                          </div>
                        )}
                      </div>
                      <mark
                        className={
                          d < 90 ? "red" : d < 150 ? "yellow" : "green"
                        }
                      >
                        {d < 0 ? "Kedaluwarsa" : `${d} hari tersisa`}
                      </mark>
                    </article>
                  );
                })}
              </div>
              <div className="info">
                <b>Hak pengelolaan</b>
                <br />
                Penambahan, upload CSV, update, dan hapus daftar lounge tersedia
                untuk Super Admin dan Admin. Perubahan harga tidak mengubah transaksi
                visitor yang sudah tercatat.
              </div>
            </>
          )}
          {tab === "master" && masterTab === "Master Station" && (
            <article className="card tableCard">
              <div className="actionTitle miniHead">
                <div><h2>Master Station</h2><span>Sumber resmi pilihan station, authority akun, dan local time.</span></div>
                {canManageMaster && <div className="rowAct"><button onClick={() => setMasterTableTarget("Master Station")}>Kelola Tabel</button><button onClick={downloadStationTemplate}>Unduh Template</button><label className="uploadButton">Upload Data<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadStations(file); e.target.value = ""; }} /></label><button className="primary" onClick={() => { setEditingStation(null); setStationDraft({ code: "", name: "", timeZone: "Asia/Jakarta", utcLabel: "UTC+7", status: "Aktif" }); setShowStationForm(true); }}>+ Tambah Station</button></div>}
              </div>
              {stationNotice && <Notice n={{ kind: stationNotice.includes("berhasil") ? "ok" : "warn", text: stationNotice }} close={() => setStationNotice("")} />}
              <MasterFilterBar query={masterQuery} setQuery={setMasterQuery} value={masterSelect} setValue={setMasterSelect} options={[...new Set(stations.map((x) => x.utcLabel))]} value2={masterSelect2} setValue2={setMasterSelect2} options2={[...new Set(stations.map((x) => x.status))]} placeholder="Kode / nama station" label1="UTC Zone" label2="Station Status" searchLabel="Search Station" count={stations.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(masterQuery.toLowerCase()) && (masterSelect === "Semua" || s.utcLabel === masterSelect) && (masterSelect2 === "Semua" || s.status === masterSelect2)).length} />
              <div className="tableWrap"><table><thead><tr><th>Kode</th><th>Nama Station</th><th>Time Zone</th><th>UTC</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
                {stations.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(masterQuery.toLowerCase()) && (masterSelect === "Semua" || s.utcLabel === masterSelect) && (masterSelect2 === "Semua" || s.status === masterSelect2)).map((s) => <tr key={s.code}><td><b>{s.code}</b></td><td>{s.name}</td><td>{s.timeZone}</td><td>{s.utcLabel}</td><td><mark className={s.status === "Aktif" ? "green" : "red"}>{s.status}</mark></td><td>{canManageMaster ? <div className="rowAct"><button onClick={() => { setEditingStation(s.code); setStationDraft({ ...s }); setShowStationForm(true); }}>Update</button><button className="del" disabled={accounts.some((a) => a.station === s.code) || lounges.some((l) => l.airport === s.code)} onClick={() => askDelete("Hapus station?", `${s.code} · ${s.name}`, async () => { await removeRecord("stations", s.code); setStations((xs) => xs.filter((x) => x.code !== s.code)); setStationNotice(`Station ${s.code} berhasil dihapus.`); })}>Hapus</button></div> : "View only"}</td></tr>)}
              </tbody></table></div>
              <div className="info">Station yang sudah digunakan oleh akun atau lounge tidak dapat dihapus. Nonaktifkan terlebih dahulu setelah relasinya diselesaikan.</div>
            </article>
          )}
          {tab === "master" && masterTab === "Master Airline" && (
            <article className="card tableCard">
              <div className="actionTitle miniHead"><div><h2>Master Airline</h2><span>Two-character IATA code for export, display, and verifier-organization routing.</span></div>{canManageMaster && <div className="rowAct"><button onClick={() => setMasterTableTarget("Master Airline")}>Kelola Tabel</button><button onClick={downloadAirlineTemplate}>Unduh Template</button><label className="uploadButton">Upload Data<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAirlines(file); e.target.value = ""; }} /></label><button className="primary" onClick={() => { setEditingAirline(null); setAirlineDraft({ code: "", name: "", verifierOrganization: "", status: "Active" }); setShowAirlineForm(true); }}>+ Add Airline</button></div>}</div>
              {airlineNotice && <Notice n={{ kind: airlineNotice.includes("berhasil") ? "ok" : "warn", text: airlineNotice }} close={() => setAirlineNotice("")} />}
              <MasterFilterBar query={masterQuery} setQuery={setMasterQuery} value={masterSelect} setValue={setMasterSelect} options={[...new Set(airlines.map((x) => x.verifierOrganization))]} value2={masterSelect2} setValue2={setMasterSelect2} options2={[...new Set(airlines.map((x) => x.status))]} placeholder="Kode / nama airline" label1="Verifier Organization" label2="Airline Status" searchLabel="Search Airline" count={airlines.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(masterQuery.toLowerCase()) && (masterSelect === "Semua" || item.verifierOrganization === masterSelect) && (masterSelect2 === "Semua" || item.status === masterSelect2)).length} />
              <div className="tableWrap"><table><thead><tr><th>2-Letter Code</th><th>Airline</th><th>Verifier Organization</th><th>Status</th><th>Action</th></tr></thead><tbody>{airlines.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(masterQuery.toLowerCase()) && (masterSelect === "Semua" || item.verifierOrganization === masterSelect) && (masterSelect2 === "Semua" || item.status === masterSelect2)).map((airline) => <tr key={`${airline.code}-${airline.name}`}><td><b>{airline.code}</b></td><td>{airline.name}</td><td>{airline.verifierOrganization}</td><td><mark className={airline.status === "Active" ? "green" : "red"}>{airline.status}</mark></td><td>{canManageMaster ? <div className="rowAct"><button onClick={() => { setEditingAirline(airline.code); setAirlineDraft({ ...airline }); setShowAirlineForm(true); }}>Update</button><button onClick={async () => { const updated = { ...airline, status: airline.status === "Active" ? "Inactive" as const : "Active" as const }; await saveRecord("airlines", { ...updated, id: airline.code }); setAirlines((rows) => rows.map((x) => x.code === airline.code ? updated : x)); setAirlineNotice(`Status ${airline.code} berhasil diperbarui.`); }}>Toggle Status</button><button className="del" onClick={() => askDelete("Delete airline?", `${airline.code} · ${airline.name}`, async () => { await removeRecord("airlines", airline.code); setAirlines((rows) => rows.filter((x) => x.code !== airline.code)); setAirlineNotice(`Airline ${airline.code} berhasil dihapus.`); })}>Delete</button></div> : "View only"}</td></tr>)}</tbody></table></div>
              <div className="info"><b>Export rule</b><br />Operating Airline Code is derived from exactly the first two alphanumeric characters immediately before the numeric flight number. The master is used to validate the code and route partner verification; it is not required merely to split ORG/DEST.</div>
            </article>
          )}
          {tab === "master" && masterTab === "User & Role" && (
            <article className="card tableCard">
              <div className="actionTitle miniHead">
                <h2>User &amp; Role</h2>
                {canManageMaster && <div className="rowAct"><button onClick={() => setMasterTableTarget("User & Role")}>Kelola Tabel</button>{role === "Super Admin" && <button onClick={() => setShowManageRole(true)}>Kelola Role</button>}<button onClick={downloadUserTemplate}>Unduh Template</button><label className="uploadButton">Upload Data<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadUsers(f); e.target.value = ""; }} /></label><button className="primary" onClick={() => {
                  setEditingUser(null);
                  setUserDraft({ name: "", username: "", email: "", password: "", role: "BO Admin", station: "CGK", scope: "Station CGK", organization: "Branch Office CGK", verificationScopes: ["Business Class", "VIP/CIP/VVIP"], status: "Aktif" });
                  setShowUserForm(true);
                }}>+ Tambah User</button></div>}
              </div>
              {userUploadNotice && <Notice n={{ kind: userUploadNotice.includes("gagal") ? "warn" : "ok", text: userUploadNotice }} close={() => setUserUploadNotice("")} />}
              <MasterFilterBar
                query={masterQuery}
                setQuery={setMasterQuery}
                value={masterSelect}
                setValue={setMasterSelect}
                options={[...new Set(accounts.map((x) => x.role))]}
                value2={masterSelect2}
                setValue2={setMasterSelect2}
                options2={[...new Set([...accounts.map((x) => x.station), ...accounts.map((x) => x.status)])]}
                placeholder="Nama / Username"
                label1="Role"
                label2="Station / Status"
                searchLabel="Search User"
                count={filteredAccounts.length}
              />
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <SortTh label="User" sortKey="name" current={userSort} onSort={(key) => setUserSort((s) => nextSort(s, key))} />
                      <SortTh label="Role" sortKey="role" current={userSort} onSort={(key) => setUserSort((s) => nextSort(s, key))} />
                      <SortTh label="Station" sortKey="station" current={userSort} onSort={(key) => setUserSort((s) => nextSort(s, key))} />
                      <SortTh label="Authority" sortKey="scope" current={userSort} onSort={(key) => setUserSort((s) => nextSort(s, key))} />
                      <SortTh label="Status" sortKey="status" current={userSort} onSort={(key) => setUserSort((s) => nextSort(s, key))} />
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((a) => (
                      <tr key={a.id}>
                        <td><b>{a.name}</b><small>{a.username}</small></td>
                        <td>{a.role}</td>
                        <td>{a.station === "ALL" ? "Seluruh BO" : a.station}</td>
                        <td>{a.scope}</td>
                        <td><mark className={a.status === "Aktif" ? "green" : "red"}>{a.status}</mark></td>
                        <td>
                          {canManageMaster && a.id !== currentAccount.id ? (
                            <div className="rowAct">
                              <button onClick={() => {
                                setEditingUser(a.id);
                                setUserDraft({ name: a.name, username: a.username, email: a.email || "", password: "", role: a.role, station: a.station, scope: a.scope, organization: a.organization || "Garuda Indonesia", verificationScopes: a.verificationScopes || [], status: a.status });
                                setShowUserForm(true);
                              }}>Update</button>
                              <button className="del" onClick={() => askDelete("Nonaktifkan akun?", `${a.name} · ${a.username}`, async () => {
                                if (!firebaseUser) return;
                                try { await updateManagedUser(firebaseUser, { ...a, uid: a.id, status: "Nonaktif" }); setUserUploadNotice("Akun berhasil dinonaktifkan; histori dan audit tetap tersimpan."); }
                                catch (error) { setUserUploadNotice(error instanceof Error ? error.message : "Akun tidak dapat dinonaktifkan."); }
                              })}>Nonaktifkan</button>
                            </div>
                          ) : <span className="statusText">{a.id === currentAccount.id ? "Akun aktif" : "View only"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {tab === "master" && masterTab === "Access Entitlement" && (
            <article className="card">
              <CardTitle
                step="ENTITLEMENT MASTER"
                title="Access Entitlement"
                right={`${filteredPartnerships.length} DATA`}
              />
              {canManageMaster && <div className="masterAction rowAct"><button onClick={() => setMasterTableTarget("Access Entitlement")}>Kelola Tabel</button><button onClick={downloadEntitlementTemplate}>Unduh Template</button><label className="uploadButton">Upload Data<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadEntitlements(file); e.target.value = ""; }} /></label><button onClick={() => setShowEligibilityRules(true)}>Kelola Eligibility Rules</button><button onClick={() => setShowIntegrationStatus(true)}>Status Integrasi</button><button className="primary" onClick={() => {
                setEditingPartnership(null);
                setPartnershipDraft({ type: "Partnership", name: "", reference: "", status: "Aktif", allowedRoles: ["Super Admin", "Admin"], verifierOrganization: "", eligibleTiers: "", effectiveStart: localDate(), effectiveEnd: "", stationScope: "ALL", payer: "", priceRule: "", companionRule: "", apiReferenceFields: "", version: 1 });
                setShowPartnershipForm(true);
              }}>+ Tambah Produk / Agreement</button></div>}
              {entitlementNotice && <Notice n={{ kind: entitlementNotice.includes("berhasil") ? "ok" : "warn", text: entitlementNotice }} close={() => setEntitlementNotice("")} />}
              <MasterFilterBar
                query={masterQuery}
                setQuery={setMasterQuery}
                value={masterSelect}
                setValue={setMasterSelect}
                options={[...new Set(partnerships.map((x) => x.type))]}
                value2={masterSelect2}
                setValue2={setMasterSelect2}
                options2={[...new Set(partnerships.map((x) => x.status))]}
                placeholder="Nama produk / agreement"
                label1="Entitlement Type"
                label2="Entitlement Status"
                searchLabel="Search Product / Agreement"
                count={filteredPartnerships.length}
              />
              <div className="partnerGrid">
                {filteredPartnerships.map((p) => (
                  <div key={p.id}>
                    <b>{p.name}</b>
                    <span>{p.type} · {p.status}</span>
                    <small>{p.reference}</small>
                    <small>Verifier: {p.verifierOrganization} · Tier/Product: {p.eligibleTiers}</small>
                    <small>Effective: {p.effectiveStart} — {p.effectiveEnd} · Station: {p.stationScope} · Version {p.version}</small>
                    <small>Payer/Price: {p.payer} · {p.priceRule}</small>
                    <small>Companion: {p.companionRule}</small>
                    {canManageMaster && <div className="rowAct">
                      <button onClick={() => {
                        setEditingPartnership(p.id);
                        setPartnershipDraft({ type: p.type, name: p.name, reference: p.reference, status: p.status, allowedRoles: p.allowedRoles, verifierOrganization: p.verifierOrganization, eligibleTiers: p.eligibleTiers, effectiveStart: p.effectiveStart, effectiveEnd: p.effectiveEnd, stationScope: p.stationScope, payer: p.payer, priceRule: p.priceRule, companionRule: p.companionRule, apiReferenceFields: p.apiReferenceFields, version: p.version });
                        setShowPartnershipForm(true);
                      }}>Update</button>
                      <button className="del" onClick={() => askDelete("Hapus access entitlement?", `${p.type} · ${p.name}`, async () => { await removeRecord("entitlements", p.id); setPartnerships((xs) => xs.filter((x) => x.id !== p.id)); setEntitlementNotice(`${p.name} berhasil dihapus.`); })}>Hapus</button>
                    </div>}
                  </div>
                ))}
              </div>
            </article>
          )}
          {tab === "master" && masterTab === "Operational Rule" && (
            <article className="card">
              <CardTitle
                step="CONFIGURABLE RULE"
                title="Operational Rule"
                right={ruleSaved ? "TERSIMPAN" : "DRAFT"}
              />
              <MasterFilterBar
                query={masterQuery}
                setQuery={setMasterQuery}
                value={masterSelect}
                setValue={setMasterSelect}
                options={["Semua BO", "Sebagian BO", "Satu BO / Lounge"]}
                value2={masterSelect2}
                setValue2={setMasterSelect2}
                options2={["Real-time", "Deferred", "Manual", "Hybrid"]}
                placeholder="Rule waktu / membership / station"
                count={1}
              />
              <div className="form">
                <label>
                  Scope Rule
                  <select
                    value={ruleScope}
                    onChange={(e) => setRuleScope(e.target.value)}
                  >
                    <option>Semua BO</option>
                    <option>Sebagian BO</option>
                    <option>Satu BO / Lounge</option>
                  </select>
                </label>
                <label>
                  Access Window sebelum STD
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={accessWindow}
                    onChange={(e) => setAccessWindow(Number(e.target.value))}
                  />
                </label>
                <label>
                  Membership Verification
                  <select
                    value={memberMode}
                    onChange={(e) => setMemberMode(e.target.value)}
                  >
                    <option>Real-time</option>
                    <option>Deferred</option>
                    <option>Manual</option>
                    <option>Hybrid</option>
                    <option>Not Required</option>
                  </select>
                </label>
                <label>
                  Referensi Waktu
                  <select>
                    <option>STD</option>
                    <option>ETD</option>
                  </select>
                </label>
                <label>
                  Manual Verification SLA (minutes)
                  <input type="number" min="5" max="1440" value={manualVerificationSla} onChange={(e) => setManualVerificationSla(Number(e.target.value))} />
                </label>
                <label>
                  Evidence Visibility — BO (days)
                  <input type="number" min="1" max="30" value={evidenceBoRetention} onChange={(e) => setEvidenceBoRetention(Number(e.target.value))} />
                </label>
                <label>
                  Evidence Visibility — Super Admin (days)
                  <input type="number" min="1" max="365" value={evidenceAdminRetention} onChange={(e) => setEvidenceAdminRetention(Number(e.target.value))} />
                </label>
              </div>
              {ruleScope !== "Semua BO" && (
                <div className="boPicker">
                  {["CGK", "DPS", "DJB", "SUB", "KNO", "UPG"].map((x) => (
                    <label key={x}>
                      <input
                        type="checkbox"
                        checked={selectedBO.includes(x)}
                        onChange={(e) =>
                          setSelectedBO((s) =>
                            e.target.checked
                              ? [...s, x]
                              : s.filter((y) => y !== x),
                          )
                        }
                      />
                      {x}
                    </label>
                  ))}
                </div>
              )}
              <div className="rulePreview">
                <b>Rule efektif</b>
                <span>
                  {ruleScope} · akses {accessWindow} jam sebelum STD ·
                  membership {memberMode} · manual verification SLA {manualVerificationSla} minutes · evidence BO {evidenceBoRetention} days / Super Admin {evidenceAdminRetention} days
                </span>
              </div>
              <button className="primary" onClick={() => setRuleSaved(true)}>
                Simpan & Terapkan Rule
              </button>
            </article>
          )}
          {tab === "master" && masterTab === "Portal Management" && role === "Super Admin" && (
            <article className="card builderCard">
              <CardTitle step="SUPER ADMIN NO-CODE CONTROL" title="Portal Management" right="SUPER ADMIN ONLY" />
              <div className="info"><b>Source data remains protected.</b><br />Core and custom fields are hidden or archived instead of deleted. Changes are saved as display configuration so operational relationships, formulas, API mapping, reports, and audit data remain available.</div>
              <div className="subTabs portalTabs">{["Dashboard Manager", "Menu & Table Manager", "Page & Text Editor", "Translation Manager"].map((section) => <button key={section} className={portalSection === section ? "selected" : ""} onClick={() => setPortalSection(section)}>{section}</button>)}</div>

              {portalSection === "Dashboard Manager" && <section className="portalManagerSection">
                <div className="portalSectionHead"><div><h2>Dashboard Manager</h2><p>Atur siapa yang dapat membuka Dashboard serta widget yang dapat dilihat setiap role.</p></div></div>
                <div className="dashboardRoleMatrix"><b>Dashboard Access</b><div>{roleProfileSeed.map((profile) => <label key={profile.role}><input type="checkbox" checked={dashboardAllowedRoles.includes(profile.role)} onChange={(e) => setDashboardAllowedRoles((roles) => e.target.checked ? [...new Set([...roles, profile.role])] : roles.filter((item) => item !== profile.role))} />{profile.role}</label>)}</div></div>
                <div className="dashboardWidgetManager">{dashboardWidgets.map((widget, index) => <div key={widget.id}>
                  <span className="dragHandle">⋮⋮</span>
                  <label className="widgetVisibility"><input type="checkbox" checked={widget.visible} onChange={(e) => setDashboardWidgets((items) => items.map((item) => item.id === widget.id ? { ...item, visible: e.target.checked } : item))} />Visible</label>
                  <div className="widgetNames"><input value={widget.titleId} onChange={(e) => setDashboardWidgets((items) => items.map((item) => item.id === widget.id ? { ...item, titleId: e.target.value } : item))} aria-label="Widget label Indonesia" /><input value={widget.titleEn} onChange={(e) => setDashboardWidgets((items) => items.map((item) => item.id === widget.id ? { ...item, titleEn: e.target.value } : item))} aria-label="Widget label English" /></div>
                  <div className="widgetRoles">{dashboardAllowedRoles.map((allowedRole) => <label key={allowedRole}><input type="checkbox" checked={widget.roles.includes(allowedRole)} onChange={(e) => setDashboardWidgets((items) => items.map((item) => item.id === widget.id ? { ...item, roles: e.target.checked ? [...new Set([...item.roles, allowedRole])] : item.roles.filter((value) => value !== allowedRole) } : item))} />{allowedRole}</label>)}</div>
                  <div className="rowAct"><button disabled={index === 0} onClick={() => moveDashboardWidget(widget.id, -1)}>↑</button><button disabled={index === dashboardWidgets.length - 1} onClick={() => moveDashboardWidget(widget.id, 1)}>↓</button></div>
                </div>)}</div>
              </section>}

              {portalSection === "Menu & Table Manager" && <section className="portalManagerSection">
              <div className="portalSectionHead"><div><h2>Menu &amp; Table Manager</h2><p>Ubah label, visibilitas, tipe field, dan urutan tanpa menghapus data inti.</p></div></div>
              <div className="builderToolbar">
                <FilterField label="Menu / Page / Table">
                  <SearchableSelect value={builderSurface} onChange={setBuilderSurface} options={[...new Set(builderItems.map((item) => item.surface))]} placeholder="Choose configuration surface" />
                </FilterField>
                <div className="builderLegend"><span><i className="coreDot" /> Core field</span><span><i className="customDot" /> Custom field</span></div>
              </div>
              <div className="schemaManager builderSchema">
                {builderItems.filter((item) => item.surface === builderSurface).map((item, index, visibleItems) => (
                  <div key={item.id}>
                    <span className="dragHandle">⋮⋮</span>
                    <label><input type="checkbox" checked={item.visible} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, visible: e.target.checked } : x))} />{language === "EN" ? item.labelEn : item.labelId}</label>
                    <small>{item.kind} · {item.locked ? "Core / protected" : "Custom"} · order {index + 1}</small>
                    <div className="builderLabels">
                      <input aria-label="Label Indonesia" value={item.labelId} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelId: e.target.value } : x))} placeholder="Label ID" />
                      <input aria-label="English label" value={item.labelEn} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelEn: e.target.value } : x))} placeholder="Label EN" />
                    </div>
                    <div className="rowAct">
                      <button disabled={index === 0} onClick={() => moveBuilderItem(item.id, -1)}>↑</button>
                      <button disabled={index === visibleItems.length - 1} onClick={() => moveBuilderItem(item.id, 1)}>↓</button>
                      <button onClick={() => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, visible: !x.visible } : x))}>{item.visible ? "Hide" : "Show"}</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="builderAddPanel">
                <div><b>Add Custom Field / Column</b><span>Every new item requires both ID and EN labels before it can be published.</span></div>
                <div className="form">
                  <label>Target Surface<SearchableSelect value={builderDraft.surface} onChange={(surface) => setBuilderDraft({ ...builderDraft, surface })} options={[...new Set(builderItems.map((item) => item.surface))]} placeholder="Target surface" /></label>
                  <label>Data Type<select value={builderDraft.kind} onChange={(e) => setBuilderDraft({ ...builderDraft, kind: e.target.value as BuilderItem["kind"] })}>{["Text", "Number", "Currency", "Date", "Time", "Dropdown", "Searchable Dropdown", "Checkbox", "Attachment", "Calculated"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
                  <label>Label ID<input value={builderDraft.labelId} onChange={(e) => setBuilderDraft({ ...builderDraft, labelId: e.target.value })} placeholder="Nama field/kolom" /></label>
                  <label>Label EN<input value={builderDraft.labelEn} onChange={(e) => setBuilderDraft({ ...builderDraft, labelEn: e.target.value })} placeholder="Field/column name" /></label>
                  <label className="checkLine"><input type="checkbox" checked={builderDraft.required} onChange={(e) => setBuilderDraft({ ...builderDraft, required: e.target.checked })} /> Required field</label>
                </div>
                <button className="primary" disabled={!builderDraft.labelId.trim() || !builderDraft.labelEn.trim()} onClick={() => {
                  setBuilderItems((items) => [...items, { ...builderDraft, id: crypto.randomUUID(), locked: false, visible: true }]);
                  setBuilderNotice(`${builderDraft.labelId} / ${builderDraft.labelEn} added as a hidden-safe configurable field.`);
                  setBuilderDraft({ id: "", surface: builderDraft.surface, labelId: "", labelEn: "", kind: "Text", visible: true, required: false, locked: false });
                }}>Add to Draft</button>
              </div>
              {builderNotice && <Notice n={{ kind: "ok", text: builderNotice }} close={() => setBuilderNotice("")} />}
              <div className="builderPublishBar"><span><b>Draft</b> Review labels and order → Preview → Publish configuration version.</span><div className="rowAct"><button onClick={() => setBuilderNotice("Preview ready. Hidden fields remain in source data and integrations.")}>Preview</button><button className="primary" disabled={builderItems.some((item) => !item.labelId.trim() || !item.labelEn.trim())} onClick={() => setBuilderNotice("Configuration version published and recorded in Activity Log simulation.")}>Publish Version</button></div></div>
              </section>}

              {portalSection === "Page & Text Editor" && <section className="portalManagerSection">
                <div className="portalSectionHead"><div><h2>Page &amp; Text Editor</h2><p>Kelola label dan deskripsi pendek. Teks operasional tetap melalui draft, preview, dan publish.</p></div></div>
                <div className="pageTextEditor">{builderItems.filter((item) => item.kind === "Menu").map((item) => <div key={item.id}><b>{item.surface}</b><label>Bahasa Indonesia<input value={item.labelId} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelId: e.target.value } : x))} /></label><label>English<input value={item.labelEn} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelEn: e.target.value } : x))} /></label></div>)}</div>
                <div className="builderPublishBar"><span><b>Draft text</b> Preview seluruh halaman sebelum publikasi.</span><button className="primary" onClick={() => setBuilderNotice("Text configuration published in prototype.")}>Publish Text Changes</button></div>
              </section>}

              {portalSection === "Translation Manager" && <section className="portalManagerSection">
                <div className="portalSectionHead"><div><h2>Translation Manager</h2><p>Aktifkan bahasa Inggris hanya setelah seluruh translation key lulus review.</p></div></div>
                <div className="translationControl"><label className="switchLine"><input type="checkbox" checked={languageFeatureEnabled} onChange={(e) => { setLanguageFeatureEnabled(e.target.checked); if (!e.target.checked) setLanguage("ID"); }} /><span><b>{languageFeatureEnabled ? "ID + EN active" : "ID only"}</b><small>Jika nonaktif, tombol bahasa disembunyikan untuk seluruh pengguna.</small></span></label><div className="translationSummary"><div><b>{builderItems.filter((item) => item.labelId.trim() && item.labelEn.trim()).length}</b><span>Complete labels</span></div><div><b>{builderItems.filter((item) => !item.labelId.trim() || !item.labelEn.trim()).length}</b><span>Require translation</span></div></div></div>
                <div className="pageTextEditor">{builderItems.map((item) => <div key={item.id}><b>{item.surface} · {item.kind}</b><label>ID<input value={item.labelId} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelId: e.target.value } : x))} /></label><label>EN<input value={item.labelEn} onChange={(e) => setBuilderItems((items) => items.map((x) => x.id === item.id ? { ...x, labelEn: e.target.value } : x))} /></label></div>)}</div>
              </section>}
            </article>
          )}
          {tab === "master" && masterTab === "Activity Log" && (
            <article className="card tableCard">
              <div className="miniHead">
                <h2>Activity Log</h2>
                <span>Simulasi audit trail</span>
              </div>
              <MasterFilterBar
                query={masterQuery}
                setQuery={setMasterQuery}
                value={masterSelect}
                setValue={setMasterSelect}
                options={[...new Set(activityRows.map((x) => x.user))]}
                value2={masterSelect2}
                setValue2={setMasterSelect2}
                options2={[...new Set(activityRows.map((x) => x.scope))]}
                placeholder="Aktivitas"
                count={filteredActivity.length}
              />
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <SortTh label="Waktu" sortKey="time" current={activitySort} onSort={(key) => setActivitySort((s) => nextSort(s, key))} />
                      <SortTh label="User" sortKey="user" current={activitySort} onSort={(key) => setActivitySort((s) => nextSort(s, key))} />
                      <SortTh label="Aktivitas" sortKey="activity" current={activitySort} onSort={(key) => setActivitySort((s) => nextSort(s, key))} />
                      <SortTh label="Scope" sortKey="scope" current={activitySort} onSort={(key) => setActivitySort((s) => nextSort(s, key))} />
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivity.map((a) => (
                      <tr key={a.id}>
                        <td>{a.time}</td><td>{a.user}</td><td>{a.activity}</td><td>{a.scope}</td>
                        <td><span className="statusText">Audit record</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {tab === "flights" && (
            <>
              <div className="title actionTitle">
                <Title
                  eye="OPERATIONAL FLIGHT DATA"
                  title="Informasi Penerbangan"
                  sub="Sumber jadwal aktif untuk validasi Lounge/Tenant Access."
                />
                <div className="scopeBadge">
                  {isGlobalAdmin
                    ? "Seluruh Station"
                    : `Station ${station}`}
                </div>
              </div>
              <SubTabs
                items={[
                  "Daily Flight",
                  "Seasonal Schedule",
                  "Irregularity",
                ]}
                value={flightTab}
                setValue={setFlightTab}
              />
              {flightTab === "Seasonal Schedule" && (
                <article className="card seasonCard">
                  <CardTitle
                    step="RECURRING SCHEDULE"
                    title="Tambah Seasonal Flight"
                    right="DRAFT"
                  />
                  <div className="form">
                    <label>
                      Flight
                      <input
                        value={season.flight}
                        onChange={(e) =>
                          setSeason({
                            ...season,
                            flight: e.target.value.toUpperCase(),
                          })
                        }
                      />
                    </label>
                    <label>
                      Route
                      <div className="routeInputs">
                        <input
                          value={season.origin}
                          onChange={(e) =>
                            setSeason({
                              ...season,
                              origin: e.target.value.toUpperCase(),
                            })
                          }
                        />
                        <input
                          value={season.destination}
                          onChange={(e) =>
                            setSeason({
                              ...season,
                              destination: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </div>
                    </label>
                    <label>
                      Season Start
                      <input
                        type="date"
                        value={season.start}
                        onChange={(e) =>
                          setSeason({ ...season, start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Season End
                      <input
                        type="date"
                        value={season.end}
                        onChange={(e) =>
                          setSeason({ ...season, end: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Operating Days 1–7
                      <input
                        value={season.days}
                        onChange={(e) =>
                          setSeason({
                            ...season,
                            days: e.target.value.replace(/[^1-7]/g, ""),
                          })
                        }
                        placeholder="1357"
                      />
                    </label>
                    <label>
                      STD
                      <input
                        type="time"
                        value={season.std}
                        onChange={(e) =>
                          setSeason({ ...season, std: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Capacity
                      <input
                        value={season.capacity}
                        onChange={(e) =>
                          setSeason({ ...season, capacity: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="info">
                    <b>Kode hari:</b> 1 Senin · 2 Selasa · 3 Rabu · 4 Kamis · 5
                    Jumat · 6 Sabtu · 7 Minggu
                  </div>
                  <button
                    className="primary"
                    onClick={() =>
                      setSeasonNotice(
                        `${season.flight} ${season.origin}–${season.destination} berhasil dibuat untuk hari ${season.days.split("").join(", ")} selama periode season.`,
                      )
                    }
                  >
                    Generate Seasonal Schedule
                  </button>
                  {seasonNotice && (
                    <Notice
                      n={{ kind: "ok", text: seasonNotice }}
                      close={() => setSeasonNotice("")}
                    />
                  )}
                </article>
              )}
              {flightTab === "Irregularity" && (
                <article className="card">
                  <CardTitle
                    step="FLIGHT IRREGULARITY"
                    title="Irregularity"
                    right="OPERATIONAL"
                  />
                  <div className="form">
                    <label>
                      Flight
                      <input placeholder="GA204" />
                    </label>
                    <label>
                      Tanggal Irregularity
                      <input type="date" />
                    </label>
                    <label>
                      Jenis Irregularity
                      <select>
                        <option>Cancelled Date</option>
                        <option>Extra Flight</option>
                        <option>Change STD</option>
                        <option>Aircraft Change</option>
                        <option>Suspended Operation</option>
                      </select>
                    </label>
                    <label>
                      Alasan
                      <input placeholder="Operational reason" />
                    </label>
                  </div>
                  <button className="primary">Simpan Irregularity</button>
                </article>
              )}
              <div className="flightTools">
                <label className="uploadButton">
                  Upload Excel/CSV
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFlights(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="uploadButton passengerFallbackButton" title="Digunakan hanya ketika integrasi Passenger List/DCS belum tersedia atau sedang terganggu.">
                  Import Passenger List
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void previewPassengerList(f); e.target.value = ""; }} />
                </label>
                <button
                  className="primary"
                  onClick={() => {
                    setEditingFlight(null);
                    setNewFlight((x) => ({
                      ...x,
                      origin:
                        role === "BO Admin" || role === "Lounge Officer"
                          ? station
                          : x.origin,
                    }));
                    setShowAddFlight(true);
                  }}
                >
                  + Tambah Flight
                </button>
                <span>
                  Format sumber: Flight, To, Time, Flight Status, Capacity; From
                  dan tanggal dapat dibaca dari header.
                </span>
              </div>
              <div className="fallbackExplanation"><b>Passenger List — Manual Import</b><span>Dipakai oleh petugas berwenang hanya jika Passenger List/DCS belum terintegrasi atau koneksinya terganggu. File CSV/XLSX ditampilkan sebagai preview untuk pengecekan DOT, flight, duplicate, dan mapping kolom sebelum data disimpan.</span></div>
              {flightNotice && (
                <Notice
                  n={{
                    kind: flightNotice.includes("berhasil") ? "ok" : "error",
                    text: flightNotice,
                  }}
                  close={() => setFlightNotice("")}
                />
              )}
              {passengerImportNotice && <Notice n={{ kind: passengerImportNotice.startsWith("Preview") ? "ok" : "warn", text: passengerImportNotice }} close={() => setPassengerImportNotice("")} />}
              <div className="info">
                <b>Hak pengelolaan data</b>
                <br />
                Super Admin, Admin/HO, dan BO dapat upload atau menambah flight.
                Lounge Officer dapat menambah flight operasional station-nya,
                tetapi perubahan ETD/status tetap dibatasi kepada Admin/HO/BO.
              </div>
              <article className="card tableCard flightCard">
                <div className="filters threeFilters">
                  <FilterField label="Flight Date"><input type="date" value={flightDateFilter} onChange={(e) => setFlightDateFilter(e.target.value)} /></FilterField>
                  <FilterField label="Origin Station"><SearchableSelect value={isGlobalAdmin ? flightFilter : station} disabled={!isGlobalAdmin} onChange={setFlightFilter} options={["Semua", ...new Set(flights.map((f) => f.origin))]} placeholder="Origin Station" /></FilterField>
                  <FilterField label="Flight Status"><SearchableSelect value={flightStatusFilter} onChange={setFlightStatusFilter} options={["Semua", ...new Set(flights.map((f) => f.status))]} placeholder="Flight Status" /></FilterField>
                  <FilterField label="Search Flight"><input value={flightQuery} onChange={(e) => setFlightQuery(e.target.value)} placeholder="Flight / rute / capacity" /></FilterField>
                  <span>{shownFlights.length} data · {flightDateFilter || "semua tanggal"}</span>
                </div>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <SortTh label="Flight" sortKey="flight" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="Rute" sortKey="route" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="Tanggal" sortKey="date" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="STD" sortKey="std" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="ETD" sortKey="etd" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="Capacity" sortKey="capacity" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="Status" sortKey="status" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <SortTh label="Pembaruan" sortKey="updated" current={flightSort} onSort={(key) => setFlightSort((s) => nextSort(s, key))} />
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownFlights.map((f) => {
                          const canEdit = canDeleteFlight(f);
                          return (
                            <tr key={f.id}>
                              <td>
                                <b>{f.flight}</b>
                              </td>
                              <td>
                                {f.origin}–{f.destination}
                              </td>
                              <td>{f.date}</td>
                              <td>{f.std}</td>
                              <td>
                                {canEdit ? (
                                  <input
                                    type="time"
                                    value={f.etd}
                                    onChange={(e) =>
                                      setFlights((xs) =>
                                        xs.map((x) =>
                                          x.id === f.id
                                            ? {
                                                ...x,
                                                etd: e.target.value,
                                                updatedBy: role,
                                                updatedAt:
                                                  new Date().toLocaleTimeString(
                                                    "id-ID",
                                                    {
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                    },
                                                  ),
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                ) : (
                                  f.etd
                                )}
                              </td>
                              <td>{f.capacity || "—"}</td>
                              <td>
                                {canEdit ? (
                                  <select
                                    value={f.status}
                                    onChange={(e) =>
                                      setFlights((xs) =>
                                        xs.map((x) =>
                                          x.id === f.id
                                            ? {
                                                ...x,
                                                status: e.target
                                                  .value as FlightStatus,
                                                updatedBy: role,
                                                updatedAt:
                                                  new Date().toLocaleTimeString(
                                                    "id-ID",
                                                    {
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                    },
                                                  ),
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                  >
                                    {[
                                      "Scheduled",
                                      "Delayed",
                                      "Rescheduled",
                                      "Postponed",
                                      "Cancelled",
                                    ].map((s) => (
                                      <option key={s}>{s}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <mark
                                    className={`flightStatus ${f.status.toLowerCase()}`}
                                  >
                                    {f.status}
                                  </mark>
                                )}
                              </td>
                              <td>
                                {f.updatedBy}
                                <small>{f.updatedAt}</small>
                              </td>
                              <td>
                                {canDeleteFlight(f) ? (
                                  <div className="rowAct">
                                    <button onClick={() => {
                                      setEditingFlight(f.id);
                                      setNewFlight({ flight: f.flight, origin: f.origin, destination: f.destination, date: f.date, std: f.std, etd: f.etd, capacity: f.capacity || "", status: f.status });
                                      setShowAddFlight(true);
                                    }}>Update</button>
                                    <button className="del" onClick={() => askDelete("Hapus penerbangan?", `${f.flight} ${f.origin}–${f.destination} · ${f.date}`, () => setFlights((xs) => xs.filter((x) => x.id !== f.id)))}>Hapus</button>
                                  </div>
                                ) : (
                                  <span className="statusText">Tidak berwenang</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          )}
        </section>
      </div>
      {actionDialog && (
        <div className="back" onMouseDown={() => setActionDialog(null)}>
          <section className="modal actionDialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className={`confirmIcon ${actionDialog.kind}`}>{actionDialog.kind === "ok" ? "✓" : "!"}</div>
            <h2>{actionDialog.kind === "ok" ? "Berhasil" : actionDialog.kind === "warn" ? "Perhatian" : "Tidak dapat diproses"}</h2>
            <p>{actionDialog.text}</p>
            <div className="modalActions"><button className="primary" autoFocus onClick={() => setActionDialog(null)}>OK</button></div>
          </section>
        </div>
      )}
      {showInbox && (
        <div className="back" onMouseDown={() => setShowInbox(false)}>
          <section className="modal inboxModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>INBOX &amp; NOTIFICATIONS</span><h2>Aktivitas untuk Anda</h2></div><button onClick={() => setShowInbox(false)}>×</button></div>
            <div className="notificationList">
              {verificationQueue.filter((v) => v.boStatus === "Pending" && !readNotificationIds.has(`verify-${v.id}`)).map((v) => <button key={`verify-${v.id}`} onClick={() => { setReadNotificationIds((current) => new Set(current).add(`verify-${v.id}`)); setReconTab("Verifier Review"); setTab("reconciliation"); setShowInbox(false); }}><i>VERIFY</i><b>{v.name} · {v.flight}</b><span>{v.category} menunggu verifikasi {v.verifier}</span></button>)}
              {shown.filter((v) => v.boStatus === "Rejected" && v.reconciliationStatus !== "Final" && !readNotificationIds.has(`dispute-${v.id}`)).map((v) => <button key={`dispute-${v.id}`} onClick={() => { setReadNotificationIds((current) => new Set(current).add(`dispute-${v.id}`)); setReconTab("Dispute & Correction"); setTab("reconciliation"); setShowInbox(false); }}><i>DISPUTE</i><b>{v.name} · {v.disputeCode || "Koreksi"}</b><span>{v.boReason}</span></button>)}
              {!verificationQueue.some((v) => v.boStatus === "Pending" && !readNotificationIds.has(`verify-${v.id}`)) && !shown.some((v) => v.boStatus === "Rejected" && v.reconciliationStatus !== "Final" && !readNotificationIds.has(`dispute-${v.id}`)) && <div className="empty">Tidak ada aktivitas baru.</div>}
            </div>
          </section>
        </div>
      )}
      {showProfile && (
        <div className="back" onMouseDown={() => { if (!currentAccount.mustChangePassword) setShowProfile(false); }}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={async (e) => {
            e.preventDefault();
            if (newPasswordValue.length < 8 || newPasswordValue !== confirmPasswordValue) { setProfileNotice("Password baru minimal 8 karakter dan konfirmasinya harus sama."); return; }
            if (!firebaseUser?.email) { setProfileNotice("Sesi Firebase tidak aktif."); return; }
            try {
              await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, oldPassword));
              await updatePassword(firebaseUser, newPasswordValue);
              await completePasswordChange(firebaseUser);
              setCurrentAccount((account) => account ? { ...account, mustChangePassword: false } : account);
              setOldPassword(""); setNewPasswordValue(""); setConfirmPasswordValue(""); setProfileNotice("Password berhasil diperbarui.");
            } catch { setProfileNotice("Password lama tidak sesuai atau sesi perlu login ulang."); }
          }}>
            <div className="modalHead"><div><span>PROFIL SAYA</span><h2>Ganti Password</h2></div>{!currentAccount.mustChangePassword && <button type="button" onClick={() => setShowProfile(false)}>×</button>}</div>
            <div className="profileIdentity"><b>{currentAccount.name}</b><span>{currentAccount.role} · {currentAccount.scope}</span></div>
            <div className="form"><label className="full">Password lama<input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} /></label><label>Password baru<input type="password" value={newPasswordValue} onChange={(e) => setNewPasswordValue(e.target.value)} /></label><label>Konfirmasi password baru<input type="password" value={confirmPasswordValue} onChange={(e) => setConfirmPasswordValue(e.target.value)} /></label></div>
            {profileNotice && <div className={profileNotice.includes("berhasil") ? "notice ok compactNotice" : "notice error compactNotice"}>{profileNotice}</div>}
            <div className="modalActions">{!currentAccount.mustChangePassword && <button type="button" onClick={() => setShowProfile(false)}>Batal</button>}<button className="primary">Simpan &amp; Konfirmasi</button></div>
          </form>
        </div>
      )}
      {evidenceVisitor && (
        <div className="back" onMouseDown={() => setEvidenceVisitor(null)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={async (e) => {
            e.preventDefault();
            if (!evidenceFile) return;
            try {
              const uploaded = await uploadEvidence(evidenceVisitor.id, evidenceFile);
              const updated: Visitor = { ...evidenceVisitor, evidenceName: uploaded.name, evidenceUrl: uploaded.url, evidenceType, evidenceUploadedAt: new Date().toISOString(), boStatus: "Pending", vendorStatus: "Pending", reconciliationStatus: "Open" };
              await saveRecord("visitors", updated);
              setVisitors((xs) => xs.map((x) => x.id === updated.id ? updated : x));
              setEvidenceVisitor(null); setEvidenceName(""); setEvidenceFile(null); setReconTab("Verifier Review");
            } catch (error) { setActionDialog({ kind: "error", text: error instanceof Error ? error.message : "Evidence tidak dapat diunggah." }); }
          }}>
            <div className="modalHead"><div><span>DISPUTE &amp; CORRECTION</span><h2>Koreksi dan Kirim Evidence</h2></div><button type="button" onClick={() => setEvidenceVisitor(null)}>×</button></div>
            <div className="info"><b>{evidenceVisitor.name} · {evidenceVisitor.flight}</b><br />{evidenceVisitor.boReason}</div>
            <div className="form"><label>Evidence Type<select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as Visitor["evidenceType"])}><option>Boarding Pass</option><option>Membership Card</option><option>Other</option></select></label></div>
            <label className="evidenceUpload">Lampiran evidence<input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0] || null; setEvidenceFile(file); setEvidenceName(file?.name || ""); }} /><span>{evidenceName || "PDF/JPG/PNG, pilih satu dokumen"}</span></label>
            <div className="modalActions"><button type="button" onClick={() => setEvidenceVisitor(null)}>Batal</button><button className="primary" disabled={!evidenceName}>Kirim Ulang ke Verifier</button></div>
          </form>
        </div>
      )}
      {showStationForm && canManageMaster && (
        <div className="back" onMouseDown={() => setShowStationForm(false)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={saveStation}>
            <div className="modalHead"><div><span>MASTER STATION</span><h2>{editingStation ? "Update" : "Tambah"} Station</h2></div><button type="button" onClick={() => setShowStationForm(false)}>×</button></div>
            <div className="form"><label>Kode IATA<input maxLength={3} value={stationDraft.code} readOnly={Boolean(editingStation)} onChange={(e) => setStationDraft({ ...stationDraft, code: e.target.value.toUpperCase() })} placeholder="CGK" /></label><label>Nama Station<input value={stationDraft.name} onChange={(e) => setStationDraft({ ...stationDraft, name: e.target.value })} /></label><label>Time Zone<select value={`${stationDraft.timeZone}|${stationDraft.utcLabel}`} onChange={(e) => { const [timeZone, utcLabel] = e.target.value.split("|"); setStationDraft({ ...stationDraft, timeZone, utcLabel }); }}><option value="Asia/Jakarta|UTC+7">Asia/Jakarta — UTC+7</option><option value="Asia/Makassar|UTC+8">Asia/Makassar — UTC+8</option><option value="Asia/Jayapura|UTC+9">Asia/Jayapura — UTC+9</option></select></label><label>Status<select value={stationDraft.status} onChange={(e) => setStationDraft({ ...stationDraft, status: e.target.value as Station["status"] })}><option>Aktif</option><option>Nonaktif</option></select></label></div>
            <div className="modalActions"><button type="button" onClick={() => setShowStationForm(false)}>Batal</button><button className="primary">Simpan &amp; Konfirmasi</button></div>
          </form>
        </div>
      )}
      {showAirlineForm && canManageMaster && (
        <div className="back" onMouseDown={() => setShowAirlineForm(false)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={saveAirline}>
            <div className="modalHead"><div><span>MASTER AIRLINE</span><h2>{editingAirline ? "Update" : "Tambah"} Airline</h2></div><button type="button" onClick={() => setShowAirlineForm(false)}>×</button></div>
            <div className="form">
              <label>2-Letter Code<input maxLength={2} value={airlineDraft.code} readOnly={Boolean(editingAirline)} onChange={(e) => setAirlineDraft({ ...airlineDraft, code: e.target.value.toUpperCase() })} placeholder="GA" /></label>
              <label>Status<select value={airlineDraft.status} onChange={(e) => setAirlineDraft({ ...airlineDraft, status: e.target.value as Airline["status"] })}><option>Active</option><option>Inactive</option></select></label>
              <label className="full">Nama Airline<input value={airlineDraft.name} onChange={(e) => setAirlineDraft({ ...airlineDraft, name: e.target.value })} placeholder="Garuda Indonesia" /></label>
              <label className="full">Verifier Organization<input value={airlineDraft.verifierOrganization} onChange={(e) => setAirlineDraft({ ...airlineDraft, verifierOrganization: e.target.value })} placeholder="Garuda Indonesia / Partner Airline" /></label>
            </div>
            <div className="modalActions"><button type="button" onClick={() => setShowAirlineForm(false)}>Batal</button><button className="primary">Simpan &amp; Konfirmasi</button></div>
          </form>
        </div>
      )}
      {showManageTable && role === "Super Admin" && (
        <div className="back" onMouseDown={() => setShowManageTable(false)}>
          <section className="modal wideModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>{manageTableContext.toUpperCase()} CONFIGURATION</span><h2>Manage Table — {manageTableContext}</h2></div><button onClick={() => setShowManageTable(false)}>×</button></div>
            {manageTableContext === "Verification" ? <>
              <div className="lockedColumns"><b>Verification-critical fields</b><span>Passenger, Flight, Date of Travel, FFP/Membership Number, Tier/Product, Verifier Organization, Evidence, and decision status are available to authorized verifiers. Row-level organization scope remains enforced.</span></div>
              <div className="schemaManager">
                {[...verificationColumns, ...verificationColumnOptions.map((option) => option.key).filter((key) => !verificationColumns.includes(key))].map((key) => {
                  const column = verificationColumnOptions.find((option) => option.key === key)!;
                  const visibleIndex = verificationColumns.indexOf(key);
                  return <div key={column.key}><span className="dragHandle">⋮⋮</span><label><input type="checkbox" checked={visibleIndex >= 0} onChange={(e) => setVerificationColumns((columns) => e.target.checked ? [...columns, column.key] : columns.filter((x) => x !== column.key))} />{column.label}</label><small>{visibleIndex >= 0 ? `Display order ${visibleIndex + 1}` : "Hidden — source data retained"}</small><div className="rowAct"><button disabled={visibleIndex <= 0} onClick={() => setVerificationColumns((columns) => { const copy = [...columns]; [copy[visibleIndex - 1], copy[visibleIndex]] = [copy[visibleIndex], copy[visibleIndex - 1]]; return copy; })}>↑</button><button disabled={visibleIndex < 0 || visibleIndex === verificationColumns.length - 1} onClick={() => setVerificationColumns((columns) => { const copy = [...columns]; [copy[visibleIndex], copy[visibleIndex + 1]] = [copy[visibleIndex + 1], copy[visibleIndex]]; return copy; })}>↓</button></div></div>;
                })}
              </div>
              <div className="modalActions"><button onClick={() => setShowManageTable(false)}>Cancel</button><button className="primary" onClick={() => setShowManageTable(false)}>Save & Confirm</button></div>
            </> : <>
            <div className="lockedColumns"><b>Core System Fields</b><span>Visitor ID, Date of Travel, Scan Timestamp, Station, Lounge/Tenant, Passenger, Flight, Sequence, Verification Status, dan Audit Trail tetap terkunci. Kolom inti dapat disembunyikan di report, tetapi tidak dihapus dari data.</span></div>
            <div className="customColumnList">
              {customColumns.length ? customColumns.map((column, index) => <div key={column.id}>
                <label><input type="checkbox" checked={column.visible} onChange={(e) => setCustomColumns((xs) => xs.map((x) => x.id === column.id ? { ...x, visible: e.target.checked } : x))} />{column.label}</label>
                <span>{column.type} · {column.formula}</span>
                <div className="rowAct columnActions">
                  <button disabled={index === 0} title="Move up" onClick={() => setCustomColumns((xs) => { const copy = [...xs]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>↑</button>
                  <button disabled={index === customColumns.length - 1} title="Move down" onClick={() => setCustomColumns((xs) => { const copy = [...xs]; [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]]; return copy; })}>↓</button>
                  <button onClick={() => { setEditingCustomColumn(column.id); setCustomColumnDraft({ ...column }); }}>Edit</button>
                  <button onClick={() => setCustomColumns((xs) => xs.map((x) => x.id === column.id ? { ...x, visible: false } : x))}>Archive</button>
                </div>
              </div>) : <div className="empty">Belum ada custom column.</div>}
            </div>
            <div className="form columnBuilder">
              <label>Nama Kolom<input value={customColumnDraft.label} onChange={(e) => setCustomColumnDraft({ ...customColumnDraft, label: e.target.value })} placeholder="Contoh: Flight & DOT" /></label>
              <label>Tipe Data<select value={customColumnDraft.type} onChange={(e) => setCustomColumnDraft({ ...customColumnDraft, type: e.target.value as CustomColumn["type"] })}>{["Text", "Number", "Date", "Currency", "Calculated"].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="full">Field Formula<textarea rows={3} value={customColumnDraft.formula} onChange={(e) => setCustomColumnDraft({ ...customColumnDraft, formula: e.target.value })} placeholder="Contoh: CONCAT([Origin], '–', [Destination])" /></label>
            </div>
            <div className="formulaBuilderTools">
              <label>Tambah Field<select value="" onChange={(e) => { if (e.target.value) appendFormula(`[${e.target.value}]`); }}><option value="">Pilih data…</option>{formulaFields.map((field) => <option key={field}>{field}</option>)}</select></label>
              <label>Tambah Fungsi<select value="" onChange={(e) => { if (e.target.value) appendFormula(`${e.target.value}(`); }}><option value="">Pilih fungsi…</option>{formulaFunctions.map((fn) => <option key={fn}>{fn}</option>)}</select></label>
              <div className="operatorPad"><span>Tambah Operator</span>{formulaOperators.map((operator) => <button type="button" key={operator} onClick={() => appendFormula(operator)}>{operator}</button>)}</div>
              <button type="button" className="clearFormula" onClick={() => setCustomColumnDraft({ ...customColumnDraft, formula: "" })}>Bersihkan Formula</button>
            </div>
            <small className="formulaHelp">Gunakan field yang tersedia dan operator aman. Fungsi: CONCAT, SQRT/akar kuadrat, ABS, ROUND, MIN, MAX, dan POWER.</small>
            <div className="formulaPreview"><b>Preview</b><span>{shown[0] ? customValue(shown[0], customColumnDraft) : "Preview akan muncul ketika Visitor List memiliki data."}</span></div>
            <div className="modalActions"><button onClick={() => { setShowManageTable(false); setEditingCustomColumn(null); }}>Tutup</button><button className="primary" disabled={!customColumnDraft.label.trim() || !customColumnDraft.formula.trim()} onClick={() => { setCustomColumns((xs) => editingCustomColumn ? xs.map((x) => x.id === editingCustomColumn ? { ...customColumnDraft, id: editingCustomColumn } : x) : [...xs, { ...customColumnDraft, id: crypto.randomUUID() }]); setEditingCustomColumn(null); setCustomColumnDraft({ id: "", label: "", type: "Calculated", formula: "", visible: true }); }}>{editingCustomColumn ? "Update & Confirm" : "Add & Confirm"}</button></div>
            </>}
          </section>
        </div>
      )}
      {showManageReport && canManageMaster && (
        <div className="back" onMouseDown={() => setShowManageReport(false)}>
          <section className="modal wideModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>RECONCILIATION REPORT CONFIGURATION</span><h2>Manage Report</h2></div><button onClick={() => setShowManageReport(false)}>×</button></div>
            <div className="form"><label className="full">Judul Laporan<input value={reportConfig.title} onChange={(e) => setReportConfig({ ...reportConfig, title: e.target.value })} /></label><label className="full">Template Nama File<input value={reportConfig.fileName} onChange={(e) => setReportConfig({ ...reportConfig, fileName: e.target.value })} /><small>Gunakan: &#123;Station&#125;, &#123;StartDate&#125;, &#123;EndDate&#125;</small></label></div>
            <div className="reportConfigGrid">
              <div><b>Informasi di Atas Tabel</b>{["Period", "Station", "Lounge/Tenant", "Airline/Payer", "Generated Date & Local Time"].map((item) => <label key={item}><input type="checkbox" checked={reportConfig.metadata.includes(item)} onChange={(e) => setReportConfig({ ...reportConfig, metadata: e.target.checked ? [...reportConfig.metadata, item] : reportConfig.metadata.filter((x) => x !== item) })} />{item}</label>)}</div>
              <div><b>Kolom Tabel</b>{reportColumnOptions.map((item) => <label key={item.key}><input type="checkbox" checked={reportConfig.columns.includes(item.key)} onChange={(e) => setReportConfig({ ...reportConfig, columns: e.target.checked ? [...reportConfig.columns, item.key] : reportConfig.columns.filter((x) => x !== item.key) })} />{item.label}</label>)}</div>
            </div>
            <label className="costToggle configCost"><input type="checkbox" checked={reportConfig.includeCost} onChange={(e) => setReportConfig({ ...reportConfig, includeCost: e.target.checked })} /> Additional Info Cost/Price</label>
            <label className="costToggle configCost"><input type="checkbox" checked={reportConfig.includeEvidenceAppendix} onChange={(e) => setReportConfig({ ...reportConfig, includeEvidenceAppendix: e.target.checked })} /> Evidence Appendix</label>
            <div className="reportPreview"><img src="/garuda-indonesia-logo.svg" alt="Garuda Indonesia" /><b>{reportConfig.title || "Reconciliation Report"}</b><span>{reportConfig.metadata.join(" · ") || "Tanpa metadata"}</span><small>{reportConfig.columns.length} kolom dipilih · hanya confirmed visitor</small></div>
            <div className="modalActions"><button onClick={() => setShowManageReport(false)}>Batal</button><button className="primary" disabled={!reportConfig.title.trim() || !reportConfig.columns.length} onClick={() => setShowManageReport(false)}>Simpan & Konfirmasi</button></div>
          </section>
        </div>
      )}
      {masterTableTarget && canManageMaster && (
        <div className="back" onMouseDown={() => setMasterTableTarget(null)}>
          <section className="modal wideModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>TABLE CONFIGURATION</span><h2>Manage Table — {masterTableTarget}</h2></div><button onClick={() => setMasterTableTarget(null)}>×</button></div>
            <div className="lockedColumns"><b>Core System Fields</b><span>Primary key, relationship keys, authority scope, verification status, and audit fields are protected. Display columns may be shown, hidden, or reordered without deleting source data.</span></div>
            <div className="schemaManager">
              {(masterTableTarget === "Master Lounge/Tenant" ? ["Station", "Lounge/Provider", "Type", "Currency", "Unit Price", "Effective Period", "Status"] : masterTableTarget === "Master Station" ? ["IATA Code", "Station Name", "Time Zone", "UTC", "Status"] : masterTableTarget === "Master Airline" ? ["2-Letter Code", "Airline", "Verifier Organization", "Status"] : masterTableTarget === "User & Role" ? ["User", "Role", "Organization", "Station", "Authority", "Verification Scope", "Status"] : ["Product/Agreement", "Tier", "Verifier Organization", "Period", "Station Scope", "Payer", "Price Rule", "Companion Rule", "Version", "Status"]).map((field, index) => <div key={field}><span className="dragHandle">⋮⋮</span><label><input type="checkbox" defaultChecked />{field}</label><small>Display order {index + 1}</small><div className="rowAct"><button disabled={index === 0}>↑</button><button>↓</button><button>Edit Label</button></div></div>)}
            </div>
            <div className="modalActions"><button onClick={() => setMasterTableTarget(null)}>Cancel</button><button className="primary" onClick={() => setMasterTableTarget(null)}>Save & Confirm</button></div>
          </section>
        </div>
      )}
      {showManageRole && role === "Super Admin" && (
        <div className="back" onMouseDown={() => setShowManageRole(false)}>
          <section className="modal wideModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>AUTHORITY CONFIGURATION</span><h2>Manage Role & Permission</h2></div><button onClick={() => setShowManageRole(false)}>×</button></div>
            <div className="info"><b>Only Super Admin can change authority.</b><br />Permissions are evaluated together with organization, station, airline, program, and lounge scope. All changes are versioned in Activity Log.</div>
            <div className="tableWrap permissionMatrix"><table><thead><tr><th>Role</th><th>Scope</th>{(["View", "Add", "Edit", "Delete", "Verify", "Override", "Download", "Manage"] as PermissionAction[]).map((p) => <th key={p}>{p}</th>)}</tr></thead><tbody>{roleProfiles.map((profile) => <tr key={profile.role}><td><b>{profile.role}</b></td><td><input value={profile.scope} onChange={(e) => setRoleProfiles((rows) => rows.map((x) => x.role === profile.role ? { ...x, scope: e.target.value } : x))} /></td>{(["View", "Add", "Edit", "Delete", "Verify", "Override", "Download", "Manage"] as PermissionAction[]).map((permission) => <td key={permission}><input type="checkbox" checked={profile.permissions.includes(permission)} onChange={(e) => setRoleProfiles((rows) => rows.map((x) => x.role === profile.role ? { ...x, permissions: e.target.checked ? [...x.permissions, permission] : x.permissions.filter((p) => p !== permission) } : x))} /></td>)}</tr>)}</tbody></table></div>
            <div className="modalActions"><button onClick={() => setShowManageRole(false)}>Cancel</button><button className="primary" onClick={() => setShowManageRole(false)}>Save Permission Version</button></div>
          </section>
        </div>
      )}
      {showIntegrationStatus && canManageMaster && (
        <div className="back" onMouseDown={() => setShowIntegrationStatus(false)}>
          <section className="modal integrationModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>IT INTEGRATION READINESS</span><h2>Integration Status</h2></div><button onClick={() => setShowIntegrationStatus(false)}>×</button></div>
            <div className="integrationGrid">{integrations.map((item) => <article key={item.id}><div><b>{item.name}</b><mark className={item.status === "Ready" ? "green" : item.status === "Attention" ? "yellow" : "red"}>{item.mode} · {item.status}</mark></div><span>Last sync: {item.lastSync}</span><small>Data owner: {item.dataOwner}<br />Technical owner: {item.technicalOwner}<br />Fallback: {item.fallback}</small></article>)}</div>
            <div className="info"><b>Production setup is completed by Tim IT.</b><br />Secrets and endpoint URLs belong in server-side environment variables. The frontend calls a common connector contract; it must never store corporate credentials.</div>
            <div className="modalActions"><button className="primary" onClick={() => setShowIntegrationStatus(false)}>OK</button></div>
          </section>
        </div>
      )}
      {showEligibilityRules && canManageMaster && (
        <div className="back" onMouseDown={() => setShowEligibilityRules(false)}>
          <section className="modal wideModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHead"><div><span>VERSIONED BUSINESS RULE</span><h2>Manage Eligibility Rules</h2></div><button onClick={() => setShowEligibilityRules(false)}>×</button></div>
            <div className="info"><b>Admin may publish operational eligibility rules without Super Admin approval.</b><br />Each change creates a new effective-dated version and audit record. Use Test Rule before publishing.</div>
            <div className="tableWrap"><table><thead><tr><th>Product/Tier</th><th>Period</th><th>Station</th><th>Reference Data</th><th>Verifier</th><th>Payer/Price</th><th>Companion</th><th>Version</th></tr></thead><tbody>{partnerships.map((p) => <tr key={p.id}><td><b>{p.name}</b><small>{p.eligibleTiers}</small></td><td>{p.effectiveStart}<small>{p.effectiveEnd}</small></td><td>{p.stationScope}</td><td>{p.apiReferenceFields}</td><td>{p.verifierOrganization}</td><td>{p.payer}<small>{p.priceRule}</small></td><td>{p.companionRule}</td><td>v{p.version}</td></tr>)}</tbody></table></div>
            <div className="modalActions"><button onClick={() => setShowEligibilityRules(false)}>Cancel</button><button>Test Rule</button><button className="primary" onClick={() => { setPartnerships((xs) => xs.map((x) => ({ ...x, version: x.version + 1 }))); setShowEligibilityRules(false); }}>Publish New Version</button></div>
          </section>
        </div>
      )}
      {deleteRequest && (
        <div className="back" onMouseDown={() => setDeleteRequest(null)}>
          <section className="modal confirmModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="confirmIcon">!</div><h2>{deleteRequest.title}</h2><p>{deleteRequest.message}</p><small>Pastikan target dan dampak tindakan sudah benar.</small>
            <div className="modalActions"><button onClick={() => setDeleteRequest(null)}>Batal</button><button className="danger" onClick={() => { deleteRequest.action(); setDeleteRequest(null); }}>Konfirmasi</button></div>
          </section>
        </div>
      )}
      {showUserForm && canManageMaster && (
        <div className="back" onMouseDown={() => setShowUserForm(false)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={saveUser}>
            <div className="modalHead"><div><span>MASTER USER</span><h2>{editingUser ? "Update" : "Tambah"} User</h2></div><button type="button" onClick={() => setShowUserForm(false)}>×</button></div>
            <div className="form">
              <label>Nama<input value={userDraft.name} onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })} /></label>
              <label>Username<input value={userDraft.username} onChange={(e) => setUserDraft({ ...userDraft, username: e.target.value })} /></label>
              <label>Email<input type="email" value={userDraft.email || ""} onChange={(e) => setUserDraft({ ...userDraft, email: e.target.value })} placeholder="nama@perusahaan.com" /></label>
              {!editingUser && <label>Password Sementara<input type="password" autoComplete="new-password" value={userDraft.password} onChange={(e) => setUserDraft({ ...userDraft, password: e.target.value })} placeholder="Minimal 8 karakter" /></label>}
              <label>Role<select value={userDraft.role} onChange={(e) => { const nextRole = e.target.value as Account["role"]; const globalRole = ["Super Admin", "Admin", "HO Admin", "HO Ancillary Coordinator", "HO Ancillary Verifier", "Report Viewer"].includes(nextRole); setUserDraft({ ...userDraft, role: nextRole, station: globalRole ? "ALL" : userDraft.station, scope: roleProfileSeed.find((item) => item.role === nextRole)?.scope || "Configured authority" }); }}>{roleProfileSeed.filter((x) => role === "Super Admin" || x.role !== "Super Admin").map((x) => <option key={x.role}>{x.role}</option>)}</select></label>
              <label>Station<select value={userDraft.station} onChange={(e) => setUserDraft({ ...userDraft, station: e.target.value, scope: e.target.value === "ALL" ? "Seluruh Station" : `Station ${e.target.value}` })}><option value="ALL">ALL — Seluruh Station</option>{stations.filter((s) => s.status === "Aktif").map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}</select></label>
              <label className="full">Authority<textarea value={`${roleProfileSeed.find((item) => item.role === userDraft.role)?.scope || "Configured authority"} · ${userDraft.station === "ALL" ? "Seluruh Station" : `Station ${userDraft.station}`}`} readOnly /></label>
              <label>Organization / Unit<input value={userDraft.organization} onChange={(e) => setUserDraft({ ...userDraft, organization: e.target.value })} placeholder="HO Ancillary / Korean Air / Lounge CGK" /></label>
              <label className="full">Verification Scope<input value={userDraft.verificationScopes.join(", ")} onChange={(e) => setUserDraft({ ...userDraft, verificationScopes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Program, airline, category" /></label>
              <label>Status<select value={userDraft.status} onChange={(e) => setUserDraft({ ...userDraft, status: e.target.value as Account["status"] })}><option>Aktif</option><option>Nonaktif</option></select></label>
            </div>
            <div className="modalActions"><button type="button" onClick={() => setShowUserForm(false)} disabled={savingUser}>Batal</button><button className="primary" disabled={savingUser}>{savingUser ? "Menyimpan..." : "Simpan & Konfirmasi"}</button></div>
          </form>
        </div>
      )}
      {showPartnershipForm && canManageMaster && (
        <div className="back" onMouseDown={() => setShowPartnershipForm(false)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={savePartnership}>
            <div className="modalHead"><div><span>ENTITLEMENT MASTER</span><h2>{editingPartnership ? "Update" : "Tambah"} Produk / Agreement</h2></div><button type="button" onClick={() => setShowPartnershipForm(false)}>×</button></div>
            <div className="form">
              <label>Tipe<select value={partnershipDraft.type} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, type: e.target.value })}><option>Membership</option><option>Partnership</option><option>EMD</option><option>Paid Access</option></select></label>
              <label>Status<select value={partnershipDraft.status} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, status: e.target.value })}><option>Aktif</option><option>Nonaktif</option></select></label>
              <label className="full">Nama Produk / Agreement<input value={partnershipDraft.name} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, name: e.target.value })} /></label>
              <label className="full">Referensi / Ketentuan<input value={partnershipDraft.reference} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, reference: e.target.value })} /></label>
              <label>Eligible Tier / Product<input value={partnershipDraft.eligibleTiers} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, eligibleTiers: e.target.value })} /></label>
              <label>Verifier Organization<input value={partnershipDraft.verifierOrganization} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, verifierOrganization: e.target.value })} /></label>
              <label>Effective Start<input type="date" value={partnershipDraft.effectiveStart} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, effectiveStart: e.target.value })} /></label>
              <label>Effective End<input type="date" value={partnershipDraft.effectiveEnd} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, effectiveEnd: e.target.value })} /></label>
              <label>Station / Lounge Scope<input value={partnershipDraft.stationScope} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, stationScope: e.target.value })} /></label>
              <label>Payer<input value={partnershipDraft.payer} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, payer: e.target.value })} /></label>
              <label>Price Rule<input value={partnershipDraft.priceRule} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, priceRule: e.target.value })} /></label>
              <label>Companion Rule<input value={partnershipDraft.companionRule} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, companionRule: e.target.value })} /></label>
              <label className="full">API Reference Fields<input value={partnershipDraft.apiReferenceFields} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, apiReferenceFields: e.target.value })} placeholder="memberNumber,tier,status" /></label>
              <div className="full rolePicker"><b>Role yang dapat menggunakan</b>{roleProfileSeed.map((x) => <label key={x.role}><input type="checkbox" checked={partnershipDraft.allowedRoles.includes(x.role)} onChange={(e) => setPartnershipDraft({ ...partnershipDraft, allowedRoles: e.target.checked ? [...partnershipDraft.allowedRoles, x.role] : partnershipDraft.allowedRoles.filter((y) => y !== x.role) })} />{x.role}</label>)}</div>
            </div>
            <div className="modalActions"><button type="button" onClick={() => setShowPartnershipForm(false)}>Batal</button><button className="primary">Simpan &amp; Konfirmasi</button></div>
          </form>
        </div>
      )}
      {showLoungeForm && canManageMaster && (
        <div className="back" onMouseDown={() => setShowLoungeForm(false)}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={saveLounge}
          >
            <div className="modalHead">
              <div>
                <span>MASTER DATA</span>
                <h2>{editingLounge ? "Update" : "Tambah"} Lounge/Tenant</h2>
              </div>
              <button type="button" onClick={() => setShowLoungeForm(false)}>
                ×
              </button>
            </div>
            <div className="form">
              <label>
                Airport
                <input
                  value={loungeDraft.airport}
                  onChange={(e) =>
                    setLoungeDraft({
                      ...loungeDraft,
                      airport: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="CGK"
                />
              </label>
              <label>
                Tipe
                <select
                  value={loungeDraft.type}
                  onChange={(e) =>
                    setLoungeDraft({ ...loungeDraft, type: e.target.value })
                  }
                >
                  <option>Lounge</option>
                  <option>Mitra</option>
                  <option>Tenant</option>
                </select>
              </label>
              <label className="full">
                Nama Lounge/Tenant
                <input
                  value={loungeDraft.name}
                  onChange={(e) =>
                    setLoungeDraft({ ...loungeDraft, name: e.target.value })
                  }
                />
              </label>
              <label>
                Currency
                <input
                  value={loungeDraft.currency}
                  onChange={(e) =>
                    setLoungeDraft({
                      ...loungeDraft,
                      currency: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="IDR"
                />
              </label>
              <label>
                Harga per Pax
                <input
                  type="number"
                  min="0"
                  value={loungeDraft.price}
                  onChange={(e) =>
                    setLoungeDraft({
                      ...loungeDraft,
                      price: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Tanggal Mulai
                <input
                  type="date"
                  value={loungeDraft.start}
                  onChange={(e) =>
                    setLoungeDraft({ ...loungeDraft, start: e.target.value })
                  }
                />
              </label>
              <label>
                Tanggal Berakhir
                <input
                  type="date"
                  value={loungeDraft.end}
                  onChange={(e) =>
                    setLoungeDraft({ ...loungeDraft, end: e.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={loungeDraft.status}
                  onChange={(e) =>
                    setLoungeDraft({ ...loungeDraft, status: e.target.value })
                  }
                >
                  <option>Aktif</option>
                  <option>Nonaktif</option>
                </select>
              </label>
            </div>
            <div className="modalActions">
              <button type="button" onClick={() => setShowLoungeForm(false)}>
                Batal
              </button>
              <button className="primary">Simpan &amp; Konfirmasi</button>
            </div>
          </form>
        </div>
      )}
      {showAddFlight && (
        <div className="back" onMouseDown={() => { setShowAddFlight(false); setEditingFlight(null); }}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={addFlight}
          >
            <div className="modalHead">
              <div>
                <span>DATA PENERBANGAN</span>
                <h2>{editingFlight ? "Update" : "Tambah"} Flight</h2>
              </div>
              <button type="button" onClick={() => { setShowAddFlight(false); setEditingFlight(null); }}>
                ×
              </button>
            </div>
            <div className="form">
              <label>
                Flight
                <input
                  value={newFlight.flight}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, flight: e.target.value })
                  }
                  placeholder="GA682"
                />
              </label>
              <label>
                Tanggal
                <input
                  type="date"
                  value={newFlight.date}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, date: e.target.value })
                  }
                />
              </label>
              <label>
                From
                <input
                  value={newFlight.origin}
                  disabled={role === "BO Admin" || role === "Lounge Officer"}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, origin: e.target.value })
                  }
                  placeholder="CGK"
                />
              </label>
              <label>
                To
                <input
                  value={newFlight.destination}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, destination: e.target.value })
                  }
                  placeholder="SOQ"
                />
              </label>
              <label>
                STD
                <input
                  type="time"
                  value={newFlight.std}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, std: e.target.value })
                  }
                />
              </label>
              <label>
                ETD
                <input
                  type="time"
                  value={newFlight.etd}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, etd: e.target.value })
                  }
                />
              </label>
              <label>
                Capacity
                <input
                  value={newFlight.capacity}
                  onChange={(e) =>
                    setNewFlight({ ...newFlight, capacity: e.target.value })
                  }
                  placeholder="12C 150Y"
                />
              </label>
              <label>
                Status
                <select
                  value={newFlight.status}
                  onChange={(e) =>
                    setNewFlight({
                      ...newFlight,
                      status: e.target.value as FlightStatus,
                    })
                  }
                >
                  {[
                    "Scheduled",
                    "Delayed",
                    "Rescheduled",
                    "Postponed",
                    "Cancelled",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modalActions">
              <button type="button" onClick={() => { setShowAddFlight(false); setEditingFlight(null); }}>
                Batal
              </button>
              <button className="primary">Simpan &amp; Konfirmasi</button>
            </div>
          </form>
        </div>
      )}
      {rejected && (
        <div className="back">
          <div className="modal rejectModal">
            <div className="rejectIcon">×</div>
            <span>AKSES DITOLAK</span>
            <h2>
              {rejected.reason === "airport"
                ? "Lokasi Airport Tidak Sesuai"
                : rejected.reason === "schedule"
                  ? "Jadwal Tidak Ditemukan"
                  : rejected.reason === "status"
                    ? "Status Flight Tidak Memenuhi"
                    : rejected.reason === "window"
                      ? "Di Luar Waktu Akses"
                      : rejected.reason === "lounge"
                        ? "Jenis Lounge Tidak Sesuai"
                        : "Tidak Eligible Lounge"}
            </h2>
            <p>
              {rejected.detail ||
                (rejected.reason === "N"
                  ? "Bagian akhir hasil scan tidak mengandung huruf Y. Penumpang dinyatakan tidak eligible."
                  : rejected.reason === "airport"
                    ? `Rute penerbangan dimulai dari ${rejected.origin}, sedangkan scan dilakukan di ${airport}. Akses lounge/tenant hanya berlaku di airport keberangkatan awal.`
                    : "Huruf Y tidak ditemukan pada bagian akhir boarding pass. Akses otomatis ditolak.")}
            </p>
            <div className="modalActions rejectActions">
              <button
                type="button"
                onClick={() => {
                  setRejected(null);
                  setRaw("");
                }}
              >
                Tutup
              </button>
              <button type="button" className="primary" onClick={retryScan}>
                Coba Scan Lagi
              </button>
              {role === "Lounge Officer" && <button type="button" onClick={() => { setRejected(null); setNotice({ kind: "warn", text: "Exceptional access request sent to Lounge Manager. Passenger remains pending and evidence is required." }); }}>Request Exceptional Access</button>}
              {role === "Lounge Manager" && <button type="button" className="primary" onClick={() => { setPass((p) => ({ ...p, eligible: "Y" })); setRejected(null); setNotice({ kind: "warn", text: "Exceptional Access Granted – Final Verification Pending. Upload Boarding Pass or Membership Card evidence." }); }}>Grant Provisional Access</button>}
            </div>
          </div>
        </div>
      )}
      {edit && (
        <div className="back" onMouseDown={() => setEdit(null)}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              setVisitors((x) => x.map((v) => (v.id === edit.id ? edit : v)));
              setEdit(null);
            }}
          >
            <div className="modalHead">
              <div>
                <span>PERBARUI DATA</span>
                <h2>Lounge/Tenant Visitor</h2>
              </div>
              <button type="button" onClick={() => setEdit(null)}>
                ×
              </button>
            </div>
            <div className="form">
              <label className="full">
                Nama Penumpang
                <input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                Flight
                <input
                  value={edit.flight}
                  onChange={(e) =>
                    setEdit({ ...edit, flight: e.target.value.toUpperCase() })
                  }
                />
              </label>
              <label>
                Sequence
                <input
                  value={edit.seq}
                  onChange={(e) => setEdit({ ...edit, seq: e.target.value })}
                />
              </label>
              <label>
                Date of Travel
                <input type="date" value={edit.travelDate || edit.date} onChange={(e) => setEdit({ ...edit, travelDate: e.target.value, dateSource: "Manual" })} />
              </label>
              <label>
                Kategori
                <select
                  value={edit.category}
                  onChange={(e) =>
                    setEdit({ ...edit, category: e.target.value })
                  }
                >
                  {cats.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Referensi
                <input
                  value={edit.reference}
                  onChange={(e) =>
                    setEdit({ ...edit, reference: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="modalActions">
              <button type="button" onClick={() => setEdit(null)}>
                Batal
              </button>
              <button className="primary">Simpan &amp; Konfirmasi</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
function Title({
  eye,
  title,
  sub,
}: {
  eye: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="title">
      <p>{eye}</p>
      <h1>{title}</h1>
      <span>{sub}</span>
    </div>
  );
}
function CardTitle({
  step,
  title,
  right,
  bad = false,
}: {
  step: string;
  title: string;
  right: string;
  bad?: boolean;
}) {
  return (
    <div className="cardTitle">
      <div>
        <span>{step}</span>
        <h2>{title}</h2>
      </div>
      <mark className={bad ? "bad" : ""}>{right}</mark>
    </div>
  );
}
function Notice({
  n,
  close,
}: {
  n: { kind: string; text: string };
  close: () => void;
}) {
  return (
    <div className={`notice ${n.kind}`}>
      <b>
        {n.kind === "ok"
          ? "Berhasil"
          : n.kind === "warn"
            ? "Perhatian"
            : "Tidak dapat diproses"}
      </b>
      <span>{n.text}</span>
      <button onClick={close}>×</button>
    </div>
  );
}
function SubTabs({
  items,
  value,
  setValue,
}: {
  items: string[];
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="subTabs">
      {items.map((item) => (
        <button
          key={item}
          className={value === item ? "selected" : ""}
          onClick={() => setValue(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
function ProcessPanel({
  title,
  description,
  items,
  action,
}: {
  title: string;
  description: string;
  items: string[];
  action: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <article className="card processPanel">
      <CardTitle
        step="WORKFLOW TEST"
        title={title}
        right={done ? "SIMULASI BERHASIL" : "READY"}
      />
      <p>{description}</p>
      <div className="processList">
        {items.map((x, i) => (
          <div key={x}>
            <i>{String(i + 1).padStart(2, "0")}</i>
            <span>{x}</span>
          </div>
        ))}
      </div>
      <button className="primary" onClick={() => setDone(true)}>
        {done ? "Simulasi Selesai" : action}
      </button>
    </article>
  );
}
function DonutChart({
  items,
  total,
  centerLabel,
  compact = false,
  onSelect,
}: {
  items: [string, number][];
  total: number;
  centerLabel: string;
  compact?: boolean;
  onSelect?: (name: string) => void;
}) {
  const colors = ["#087c96", "#32a6b1", "#1c5f82", "#70c7c9", "#eea84a", "#8067a7", "#d76969", "#7b9c55"];
  let cursor = 0;
  const stops = items.map(([, value], index) => {
    const start = cursor;
    cursor += total ? value / total * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return <div className={`donutChart ${compact ? "compact" : ""}`}>
    <div className="donutGraphic" style={{ background: total ? `conic-gradient(${stops})` : "#e4eef0" }} role="img" aria-label={`${centerLabel}: ${total.toLocaleString("id-ID")}`}><span><b>{total.toLocaleString("id-ID")}</b><small>{centerLabel}</small></span></div>
    {!compact && <div className="donutLegend">{items.map(([name, value], index) => {
      const content = <><i style={{ background: colors[index % colors.length] }} /><span>{name}</span><b>{value.toLocaleString("id-ID")}</b><small>{total ? (value / total * 100).toFixed(1) : "0.0"}%</small></>;
      return onSelect ? <button type="button" key={name} onClick={() => onSelect(name)}>{content}</button> : <div key={name}>{content}</div>;
    })}</div>}
  </div>;
}
function SortTh({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: string;
  current: SortState;
  onSort: (key: string) => void;
}) {
  return (
    <th>
      <button type="button" className="sortButton" onClick={() => onSort(sortKey)}>
        {label}
        <span>{current.key === sortKey ? (current.direction === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}
function MasterFilterBar({
  query,
  setQuery,
  value,
  setValue,
  options,
  value2,
  setValue2,
  options2,
  placeholder,
  count,
  label1 = "Filter Type",
  label2 = "Filter Status",
  searchLabel = "Search",
  queryOptions,
}: {
  query: string;
  setQuery: (value: string) => void;
  value: string;
  setValue: (value: string) => void;
  options: string[];
  value2: string;
  setValue2: (value: string) => void;
  options2: string[];
  placeholder: string;
  count: number;
  label1?: string;
  label2?: string;
  searchLabel?: string;
  queryOptions?: string[];
}) {
  return (
    <div className="filters masterFilters threeFilters">
      <FilterField label={label1}><SearchableSelect value={value} onChange={setValue} options={["Semua", ...options.filter((x) => x && x !== "Semua")]} placeholder={label1} /></FilterField>
      <FilterField label={label2}><SearchableSelect value={value2} onChange={setValue2} options={["Semua", ...options2.filter((x) => x && x !== "Semua")]} placeholder={label2} /></FilterField>
      <FilterField label={searchLabel}>{queryOptions ? <SearchableSelect value={query} onChange={setQuery} options={queryOptions} placeholder={placeholder} /> : <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />}</FilterField>
      <span>{count} data ditemukan</span>
    </div>
  );
}
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="filterField"><span>{label}</span>{children}</label>;
}
function SearchableSelect({ value, onChange, options, placeholder, disabled = false }: { value: string; onChange: (value: string) => void; options: string[]; placeholder: string; disabled?: boolean }) {
  const id = useId(), [textValue, setTextValue] = useState(value), [open, setOpen] = useState(false);
  // Keep the editable search text aligned with filter resets from its parent.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setTextValue(value), [value]);
  const cleanOptions = [...new Set(options.filter(Boolean))];
  function commit(next: string) {
    const match = cleanOptions.find((x) => x.toLowerCase() === next.trim().toLowerCase());
    if (match) { onChange(match); setTextValue(match); }
    else setTextValue(value);
  }
  const query = open && textValue === value ? "" : textValue.trim().toLowerCase();
  const filtered = cleanOptions.filter((x) => !query || x.toLowerCase().includes(query));
  return <div className={`searchableSelect ${open ? "open" : ""}`} id={id}>
    <input value={textValue} disabled={disabled} placeholder={placeholder} autoComplete="off" role="combobox" aria-controls={`${id}-options`} aria-expanded={open} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setTextValue(e.target.value); setOpen(true); }} onBlur={(e) => { window.setTimeout(() => { commit(e.target.value); setOpen(false); }, 180); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(textValue); setOpen(false); } if (e.key === "Escape") { setTextValue(value); setOpen(false); } if (e.key === "ArrowDown") setOpen(true); }} />
    <button type="button" tabIndex={-1} disabled={disabled} aria-label={`Buka pilihan ${placeholder}`} onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen((x) => !x)}>⌄</button>
    {open && !disabled && <div className="searchableOptions" id={`${id}-options`} role="listbox">
      {filtered.length ? filtered.map((option) => <button type="button" role="option" aria-selected={option === value} className={option === value ? "selected" : ""} key={option} onPointerDown={(e) => { e.preventDefault(); onChange(option); setTextValue(option); setOpen(false); }}>{option}</button>) : <span>Tidak ada pilihan yang sesuai</span>}
    </div>}
  </div>;
}
function VerificationPanel({
  visitors,
  role,
  canAct,
  statusKey,
  acceptLabel,
  rejectReasons,
  onDecision,
  visibleColumns,
  onManageTable,
}: {
  visitors: Visitor[];
  role: string;
  canAct: boolean;
  statusKey: "boStatus" | "vendorStatus";
  acceptLabel: string;
  rejectReasons: string[];
  visibleColumns: VerificationColumnKey[];
  onManageTable?: () => void;
  onDecision: (
    ids: string[],
    decision: "accept" | "reject",
    reason: string,
  ) => void;
}) {
  const [checked, setChecked] = useState<string[]>([]),
    [decision, setDecision] = useState<"accept" | "reject">("accept"),
    [reason, setReason] = useState(rejectReasons[0] || ""),
    [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const displayVisitors = sortData(visitors, sort, (v, key) => ({
    name: v.name, flight: v.flight, category: v.category, price: v.price, status: v[statusKey],
  }[key] || ""));
  function submitDecision() {
    if (!checked.length || (decision === "reject" && !reason)) return;
    onDecision(checked, decision, reason);
    setChecked([]);
  }
  return (
    <article className="card tableCard">
      <div className="miniHead">
        <div>
          <h2>{role} Verification</h2>
          <span>
            Pilih per pax atau sekaligus, kemudian tentukan diterima atau
            ditolak.
          </span>
        </div>
        <div className="verificationHeaderActions">
        {onManageTable && <button className="secondary manageTableButton" onClick={onManageTable}>Manage Table</button>}
        {canAct ? (
          <div className="verificationActions">
            <select
              value={decision}
              onChange={(e) =>
                setDecision(e.target.value as "accept" | "reject")
              }
            >
              <option value="accept">{acceptLabel}</option>
              <option value="reject">Tolak</option>
            </select>
            {decision === "reject" && (
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {rejectReasons.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            <button
              className={decision === "reject" ? "danger" : "primary"}
              disabled={!checked.length}
              onClick={submitDecision}
            >
              Proses ({checked.length})
            </button>
          </div>
        ) : (
          <span className="scopeBadge">View only sesuai role</span>
        )}
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  disabled={!canAct}
                  checked={
                    visitors.length > 0 && checked.length === visitors.length
                  }
                  onChange={(e) =>
                    setChecked(
                      e.target.checked ? visitors.map((v) => v.id) : [],
                    )
                  }
                />
              </th>
              {visibleColumns.includes("passenger") && <SortTh label="Passenger" sortKey="name" current={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />}
              {visibleColumns.includes("flight") && <SortTh label="Flight / Route" sortKey="flight" current={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />}
              {visibleColumns.includes("dot") && <th>Date of Travel</th>}
              {visibleColumns.includes("ffpNumber") && <th>FFP / Membership Number</th>}
              {visibleColumns.includes("tier") && <SortTh label="Tier / Product" sortKey="category" current={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />}
              {visibleColumns.includes("verifier") && <th>Verifier Organization</th>}
              {visibleColumns.includes("evidence") && <th>Evidence</th>}
              {visibleColumns.includes("price") && <SortTh label="Price/Pax" sortKey="price" current={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />}
              {visibleColumns.includes("status") && <SortTh label="Status" sortKey="status" current={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />}
            </tr>
          </thead>
          <tbody>
            {visitors.length ? (
              displayVisitors.map((v) => (
                <tr key={v.id}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!canAct}
                      checked={checked.includes(v.id)}
                      onChange={(e) =>
                        setChecked((s) =>
                          e.target.checked
                            ? [...s, v.id]
                            : s.filter((x) => x !== v.id),
                        )
                      }
                    />
                  </td>
                  {visibleColumns.includes("passenger") && <td>{v.name}</td>}
                  {visibleColumns.includes("flight") && <td>
                    {v.flight}
                    <small>{v.route}</small>
                  </td>}
                  {visibleColumns.includes("dot") && <td>{v.travelDate || v.date}</td>}
                  {visibleColumns.includes("ffpNumber") && <td><b>{v.reference || "—"}</b><small>{v.category.includes("Business") ? "Not required" : "Reference used for verification"}</small></td>}
                  {visibleColumns.includes("tier") && <td>{v.category}</td>}
                  {visibleColumns.includes("verifier") && <td>{v.verifierOrganization || v.verifier || "—"}</td>}
                  {visibleColumns.includes("evidence") && <td>{v.evidenceName || "—"}<small>{v.evidenceType || ""}</small></td>}
                  {visibleColumns.includes("price") && <td>{cash(v.price, v.currency)}</td>}
                  {visibleColumns.includes("status") && <td>
                    <mark
                      className={
                        v[statusKey] === "Accepted" ||
                        v[statusKey] === "Confirmed"
                          ? "green"
                          : v[statusKey] === "Rejected"
                            ? "red"
                            : "yellow"
                      }
                    >
                      {v[statusKey]}
                    </mark>
                    {statusKey === "boStatus" && v.boReason && (
                      <small>{v.boReason}</small>
                    )}
                  </td>}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={1 + visibleColumns.length}>
                  <div className="empty">
                    Belum ada visitor untuk diverifikasi.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

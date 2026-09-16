# Changelog

## v0.20.0

- Dashboard KPI cards now open the corresponding Visitor List, passenger-volume detail, or Reports & Sign-off view while preserving the active dashboard scope.
- Visitor Composition is presented as an interactive donut chart with accessible legend, values, and percentages.
- Lounge Utilization uses separate Business and Economy donut charts because each metric has a different denominator.
- Top 10 Branch Offices and Provider Cost Analysis are presented as drill-down tables with contribution, daily average, average cost per visitor, and total cost.
- Portal Management tabs use the existing shared tab component correctly and remain aligned across desktop and mobile layouts.
- Manage Table pop-ups use a wider responsive layout, aligned configuration rows, and sticky header/action areas.
- Search, filter, dropdown, selected-value, and placeholder text use regular font weight; placeholders remain muted and entered values remain dark.
- Dashboard and component styling was changed at its original definitions instead of being layered through a new override stylesheet.

## v0.19.0

- Dashboard monitoring ditambahkan untuk Super Admin, Admin, HO Admin, dan Report Viewer sesuai konfigurasi Super Admin.
- Dashboard mencakup executive summary, komposisi visitor, Business/Economy lounge utilization, Top 10 BO, provider cost, serta status verifikasi dan rekonsiliasi.
- Filter Dashboard mencakup period, area, Branch Office, dan Lounge/Provider; seluruh KPI mengikuti filter aktif.
- Passenger Volume dapat diimpor melalui template CSV/XLSX sebagai denominator Business/Economy pax sebelum integrasi DCS/API tersedia.
- `Tab & Table Builder` dikembangkan menjadi `Portal Management` dengan Dashboard Manager, Menu & Table Manager, Page & Text Editor, dan Translation Manager.
- Super Admin dapat mengatur role yang melihat Dashboard, widget per role, urutan widget, label ID/EN, dan status bahasa ID-only atau ID+EN.
- Tombol EN/ID disembunyikan otomatis ketika fitur bilingual dinonaktifkan; bahasa kembali ke ID agar tidak menampilkan campuran terjemahan.
- Tone warna eksisting dipertahankan.

## v0.18.0

- Browser tab icon now uses the transparent Garuda Indonesia wing mark.
- Super Admin receives a dedicated `Tab & Table Builder` for menu, tab, field, and table display configuration.
- Core and custom fields use Hide/Show or Archive/Restore; source data is not deleted.
- Builder supports ID/EN labels, field type, required status, reordering, Draft, Preview, Publish, and local prototype persistence.
- English/Indonesia coverage is expanded for page descriptions, steps, scan status, placeholders, date/time locale, dispute messages, and common actions; aviation terminology remains in English.
- Master Lounge/Provider search is now a searchable dropdown populated from Master Lounge/Tenant.
- `Irregularity / Exception` is renamed to `Irregularity`; passenger policy exceptions remain under Passenger Exceptional Access.
- `Passenger List Fallback` is renamed to `Import Passenger List` and includes an operational explanation for DCS/manual-import use.
- Verification `Manage Table` receives a visible button style and functional show/hide/reordering controls.
- Dispute actions are shown only to Lounge Officer/Lounge Manager for rejected records within their scope.
- Visitor and reconciliation cost summaries now calculate only Accepted/final payable records within all active filters.
- Visitor table footer and top KPI explicitly distinguish filtered rows from confirmed/payable visitors.

## v0.17.0

- Export route manual dinormalisasi menjadi kolom terpisah `Origin (ORG)` dan `Destination (DEST)`.
- Operating Airline Code dibaca dari tepat dua karakter sebelum angka Flight Number.
- Master Airline ditambahkan untuk validasi two-letter code dan routing organisasi verifier.
- Verification Table menampilkan FFP/Membership Number, Tier/Product, DOT, verifier organization, evidence, price, dan status.
- Manage Table khusus Verification tersedia untuk Super Admin.
- Model account diperluas menjadi user individual + organization/unit + role + station/program scope.
- Role Lounge Manager, HO Ancillary Coordinator/Verifier, Airline Coordinator/Verifier, dan Report Viewer ditambahkan.
- BO dibatasi untuk Business Class dan VIP/CIP/VVIP; membership/EMD/Paid Access diarahkan ke HO Ancillary; partner/SkyTeam diarahkan ke organisasi airline terkait.
- Passenger Exceptional Access dipisahkan dari Flight Irregularity; Lounge Manager memutus akses provisional dengan evidence dan final verification tetap diperlukan.
- Manage Role & Permission, versioned Eligibility Rules, operational manual-verification SLA, evidence retention, dan reopen reconciliation ditambahkan.
- Report mendukung Evidence Appendix dan tetap hanya memuat confirmed visitor.
- Integration Status dan connector contract Mock/Live ditambahkan untuk Flight Schedule, Passenger List/DCS, membership, EMD, partner airline, payment, evidence, dan notification.
- Passenger List CSV/XLSX fallback menyediakan mapping check, preview, duplicate count, dan error message.
- Semua filter utama memiliki persistent label; Lounge/Provider menggunakan searchable dropdown yang mengikuti station.
- Nama file unduhan visitor tidak menggunakan istilah sistem eksternal.

## v0.16.1

- Profile/My Profile dropdown diperbaiki agar dapat dibuka melalui browser smartphone.
- Warna teks menu Profile diperjelas pada seluruh pilihan.
- Penerjemahan EN/ID diperluas pada label, tombol, menu, dialog, dan placeholder; common aviation terms tetap dipertahankan.
- Date of Travel dan Cabin Class disejajarkan pada manual input.
- Seluruh searchable filter membuka daftar lengkap saat diklik dan dapat dipersempit dengan mengetik.
- Manage Report dan Additional Info Cost/Price disamakan tinggi, tipografi, dan ukurannya.
- Manage Table memakai formula builder bebas dengan pilihan core field, operator aritmetika, akar kuadrat, fungsi numerik, dan penggabungan teks.

## v0.16.0

- Date of Travel wajib dipilih pada Langkah 1 sebelum scan.
- Flight divalidasi terhadap DOT pilihan petugas, termasuk penerbangan setelah tengah malam.
- Duplicate key menjadi Passenger + Flight + Sequence + DOT.
- Eligibility final token dinormalisasi untuk Y/y/Ya/Yaa/Yaaa dan trailing spaces.
- Field hasil scan dikunci; fallback manual tetap dapat diedit.
- Companion manual untuk Platinum, Elite Plus, DPR, dan partner entitlement.
- Searchable dropdown internal menggantikan tampilan dropdown browser.
- Average Passenger Traffic per Hour dan peak-hour filter tetap tersedia.
- Manage Table untuk custom calculated column oleh Super Admin.
- Satu Reconciliation Report berisi confirmed visitor sebagai payment reference.
- Manage Report untuk judul, nama file, metadata, dan checklist kolom.
- Additional Info Cost/Price bersifat opsional.
- Logo Garuda Indonesia berada di tengah atas dokumen.
- Toggle bahasa menggunakan EN/ID dan mempertahankan common aviation terms.
- Login card, profile menu, notification, sign-out, modal, dan action button diperbarui.

## v0.15.0

- Flexible final-token eligibility parsing.
- Station-aware real-time local clock.
- Automatic Date of Travel, including midnight crossover.
- Average passenger traffic per hour and peak-hour summary.
- Date/time/station/category/status filters and searchable dropdowns.
- Verifier routing for BO, HO Ancillary, and partner airline.
- Standard dispute codes, evidence resubmission, notification inbox, and daily closing gate.
- Final and split PDF reports.
- Profile password change and Super Admin password override.
- Master Station and user CSV upload validation.
- Access Entitlement structure for membership, partnership, EMD, and paid access.
- Professional internal delete confirmation.

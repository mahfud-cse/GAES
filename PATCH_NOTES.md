# GAES — Next Revision Delta

## Basis

Delta ini dibuat terhadap baseline package GAES yang digunakan pada workspace saat revisi dimulai. Nama dan struktur file source dipertahankan. Tidak ada perubahan nomor versi aplikasi dan tidak ada file source berakhiran `clean`, `final`, atau nomor revisi.

## Perubahan

### 1. Visitor Bundle Upload

- Menambahkan tombol **Unduh Template Visitor** dan **Upload Visitor Bundle** pada Visitor List.
- Mendukung CSV, XLS, dan XLSX.
- Upload hanya tersedia untuk Super Admin, Admin, dan Lounge Manager.
- Lounge Manager dibatasi pada station akun.
- Menampilkan preview 25 baris pertama, jumlah data siap diverifikasi, dan jumlah data yang masih perlu dilengkapi.
- Maksimal 150 visitor per batch.
- Passenger Name wajib tersedia. Data lain dapat dilengkapi setelah upload.
- Data belum lengkap masuk dengan status `Needs Data Completion` dan tidak masuk antrean keputusan verifier sebelum lengkap.
- Data lengkap masuk dengan status `Ready for Verification`.
- Pemeriksaan duplikat tetap dijalankan apabila Name, Flight, Sequence, dan Date of Travel tersedia.
- Setiap data dan ringkasan batch tercatat pada Activity Log.

### 2. Eligibility Statement

- Mengganti pernyataan penolakan menjadi bahasa operasional yang profesional.
- Ketika indikator Y tidak ditemukan, sistem menjelaskan bahwa penumpang tidak memenuhi kriteria akses berdasarkan ketentuan yang berlaku.
- Pengguna diarahkan untuk memastikan hasil scan atau melakukan verifikasi manual sesuai kewenangan.
- Penolakan hasil scan dan input manual dicatat pada Activity Log tanpa menyimpan raw boarding-pass string.

### 3. Room Usage Analytics

- Menghapus grafik Planned vs Actual Usage.
- Mengganti grafik menjadi **Room Usage Traffic** dengan pola 24 jam seperti grafik trafik visitor.
- Grafik menggunakan actual completed usage/check-in data.
- Menampilkan average duration, peak hour, peak traffic, jumlah usage session, most-used rooms, actual usage hours, dan room utilization.
- Daily/Weekly/Monthly tidak diubah dari perbaikan manual sebelumnya.

### 4. Dashboard Bilingual

- Menambahkan mapping tepat `Ringkasan Penggunaan` menjadi `Usage Overview`.
- Tidak mengubah label Daily/Weekly/Monthly.

### 5. Vertical Signage

- Menambahkan Screen Orientation: Auto, Landscape, dan Portrait.
- Menambahkan Content Fit: Contain, Cover, dan Stretch.
- Menambahkan target resolution: Auto, 1920×1080, 1080×1920, 3840×2160, dan 2160×3840.
- Menambahkan preview orientasi dan panduan materi 16:9/9:16.
- Menambahkan Material Orientation pada Content Library.
- Menampilkan peringatan bila orientasi materi tidak sesuai dengan sebagian device.
- Menampilkan peringatan bila satu Output Group mencampur device landscape dan portrait.
- Profil display dikirim melalui heartbeat dan diterapkan oleh browser player.
- Pengaturan OS/perangkat fisik tetap harus disetel portrait untuk layar vertikal.

### 6. Activity Log Consolidation

- Menggabungkan log portal, room operation, dan display operation pada Activity Log utama.
- Menampilkan nama user dan role; UID lama dipetakan ke profil user bila tersedia.
- Menampilkan station, lounge, dan scope yang mudah dibaca tanpa menggunakan target document ID sebagai scope.
- Mengubah action code menjadi kalimat aktivitas yang mudah dipahami.
- Menambahkan detail actor, role, username, organization, station, scope, module, target, result, dan reason code untuk log baru.
- Penambahan, pembaruan, penghapusan, penerimaan, dan penolakan visitor melalui backend audit.
- Keputusan Terima/Tolak visitor kini diproses melalui backend dan tercatat atomik bersama perubahan status.
- Penerimaan hasil penolakan pada Dispute & Correction kini tersimpan di backend dan tercatat pada audit.
- Exceptional access request/grant dicatat.
- Device inventory save/approval dipindahkan melalui backend serta tercatat pada display activity.
- Room configuration save dicatat melalui backend activity endpoint.

## File yang Berubah

- `app/facility-operations.tsx`
- `app/globals.css`
- `app/page.tsx`
- `app/player/page.tsx`
- `lib/data-normalization.ts`
- `lib/firebase/api.ts`
- `netlify/functions/_audit.mjs`
- `netlify/functions/create-user.mjs`
- `netlify/functions/create-visitor.mjs`
- `netlify/functions/display-player.mjs`
- `netlify/functions/import-visitors.mjs`
- `netlify/functions/manage-activity.mjs`
- `netlify/functions/manage-display-content.mjs`
- `netlify/functions/manage-display-device.mjs`
- `netlify/functions/manage-user.mjs`
- `netlify/functions/manage-visitor.mjs`
- `tests/data-normalization.test.mjs`
- `tests/ui-foundation.test.mjs`

## Cara Menerapkan

1. Pastikan repository GitHub berada pada baseline package yang sama.
2. Ekstrak ZIP delta pada root repository.
3. Izinkan file di dalam delta menggantikan file dengan path yang sama.
4. Commit perubahan ke branch yang digunakan Netlify.
5. Jalankan deployment Netlify agar frontend dan Functions baru ikut dipublikasikan.
6. Pastikan deployment Production menggunakan commit terbaru.

## Deployment

- **Netlify frontend:** wajib deploy.
- **Netlify Functions:** wajib deploy karena terdapat function baru dan perubahan backend.
- **Firestore Rules:** tidak berubah; tidak perlu deploy ulang untuk delta ini.
- **Firebase indexes:** tidak berubah.
- **Environment variables:** tidak ada key baru. Pastikan `NEXT_PUBLIC_FIREBASE_PROJECT_ID` dan `FIREBASE_PROJECT_ID` pada Production mengarah ke project yang benar. Jika Deploy Preview dan Production diharapkan memakai data yang sama, scope environment variable keduanya harus konsisten.

## Verifikasi

- Logic tests: 10 passed.
- UI/regression tests: 31 passed.
- ESLint: 0 error; 24 warning baseline yang sudah ada sebelumnya.
- Production Next.js build: passed.
- Netlify function syntax check: passed.
- CSS `!important`: 0.

## UAT Minimum

1. Upload template visitor sebagai Lounge Manager dan pastikan station di luar scope ditolak.
2. Upload visitor tidak lengkap dan pastikan tampil pada Visitor List dengan status Perlu Pelengkapan Data.
3. Lengkapi data visitor lalu pastikan masuk ke Verifier Review.
4. Terima dan tolak visitor; pastikan Activity Log menampilkan nama user, role, station, target visitor, dan hasil.
5. Scan boarding pass tanpa indikator Y; pastikan pernyataan baru tampil dan aktivitas penolakan masuk ke log.
6. Buka Usage Analytics dan pastikan grafik Room Usage Traffic tampil tanpa Plan vs Actual.
7. Atur device menjadi Portrait 1080×1920, enroll/restart player, lalu pastikan profile dan fit mode diterapkan.
8. Buat Output Group campuran landscape/portrait dan pastikan peringatan tampil.
9. Bandingkan Deploy Preview dan Production untuk memastikan keduanya menggunakan deployment dan Firebase project yang dimaksud.

## Rollback

Gunakan fitur revert commit pada GitHub atau deploy ulang commit production sebelumnya. Delta ini tidak mengubah Firestore Rules maupun menghapus collection. Dokumen yang sudah dibuat oleh Visitor Bundle tetap berada di Firestore dan dapat dikelola melalui Visitor List sesuai kewenangan.

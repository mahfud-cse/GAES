# GAES v0.22.3 — Functional Recovery

Status: **lulus pemeriksaan statis, unit test, dan production build lokal**. UAT dengan Firebase/Netlify asli tetap wajib dilakukan melalui branch dan Deploy Preview sebelum merge ke `main`.

## Perbaikan utama

- Semua snapshot Firestore dinormalisasi; dokumen rusak dilewati sehingga tidak menjatuhkan seluruh halaman.
- Semua upload CSV/XLSX mengabaikan baris kosong, memvalidasi per baris, hanya menyimpan baris valid, dan menampilkan hasil parsial secara benar.
- Tambah, upload, edit ETD/status, hapus, irregularity, dan seasonal flight menulis ke Firestore dan baru menampilkan sukses setelah penyimpanan berhasil.
- Template flight tersedia dari halaman Flight Information.
- Seasonal schedule membentuk tanggal berdasarkan operating day, menyimpan hasil, lalu menampilkannya pada Daily Flight.
- Pemilihan lounge aktif mengikuti data Firebase; validasi visitor tidak lagi bergantung pada ID contoh statis.
- Edit visitor dan keputusan verifier disimpan ke Firestore dengan penanganan gagal/parsial.
- Parser kamera mendukung QR, Code 128, PDF417, Aztec, Data Matrix, Code 39, EAN-13, dan EAN-8; area panduan tidak membatasi orientasi kode.
- Parser boarding pass menerima payload IATA BCBP dan payload berlabel dengan pemisah spasi, `;`, `|`, atau koma untuk indikator eligibilitas.
- Notifikasi `ok`, `warn`, dan `error` tidak lagi ditentukan dari tebakan isi teks.
- Notifikasi inbox yang sudah dibaca tetap hilang setelah refresh pada browser dan akun yang sama.
- Pembuatan akun melakukan rollback Firebase Authentication bila profil Firestore gagal ditulis; update akun juga memulihkan Auth bila update profil gagal.
- Username, email, role, station, password sementara, duplikasi, dan baris upload akun divalidasi sebelum request.
- Kesalahan Firebase/Netlify menampilkan pesan yang lebih spesifik.
- Popup tetap dapat digulir vertikal maupun horizontal bila kontennya melebihi viewport.
- Logo Garuda Indonesia tetap menggunakan aset lokal pada login, header, loader, dan laporan.
- Firebase Storage tetap opsional; saat belum aktif, upload evidence memberi pesan yang jelas tanpa membuat halaman crash.

## Catatan UI yang dipertahankan

- Tone warna eksisting tidak diubah.
- Dashboard KPI dapat diklik; komposisi dan utilization memakai donut/pie; Top 10 BO dan analisis biaya berbentuk tabel dan dapat ditelusuri.
- Filter/search memakai placeholder abu-abu normal dan teks pilihan/input tidak bold.
- Sidebar dapat collapse, tidak memakai nomor urut, dan link menu mendukung klik kanan/open in new tab.
- Refresh memulihkan menu, submenu master, rekonsiliasi, atau flight terakhir melalui URL.
- Master Station dan Airline memiliki update, tambah manual, template, dan upload.

## Environment

- `FIREBASE_*` adalah service account project GAES/website lounge.
- `SOURCE_FIREBASE_*` adalah service account project Ground Experience Portal.
- `NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED` biarkan `false` selama Firebase Storage belum aktif.
- Environment variable Netlify tidak berasal dari commit GitHub; perubahan env memerlukan deploy baru.

## UAT minimum

1. Tambah satu akun manual dan login dengan password sementara.
2. Impor file akun berisi satu baris valid, satu invalid, dan satu kosong.
3. Sinkronisasi lounge/tenant dari project sumber.
4. Tambah dan upload flight, edit ETD/status, lalu refresh.
5. Generate seasonal schedule dan pastikan daftar tanggal muncul.
6. Scan dua payload berbeda, QR dan barcode linear, serta uji duplikasi.
7. Uji visitor setelah STD/ETD dan verifikasi BO.
8. Masukkan dokumen Firestore invalid pada environment UAT dan pastikan halaman tetap terbuka.

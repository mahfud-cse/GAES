# Demo wajah di browser — V5

## Yang dapat dijalankan sekarang

Mode **Uji Wajah di Browser** menjalankan YuNet untuk mendeteksi wajah dan SFace untuk mencocokkan satu wajah dengan satu foto petugas yang dipilih. Inferensi berjalan di Web Worker dengan ONNX Runtime Web 1.30.0/WebAssembly. Model/runtime disajikan dari website sendiri; tidak ada panggilan API pengenalan wajah pihak ketiga. Foto kamera tidak diunggah untuk pencocokan ini. Kamera dan hasil menggunakan tampilan lounge penuh dengan ID/EN.

Untuk sumber foto repository, tidak perlu Firebase Storage atau server Python tambahan. Firebase Auth, Firestore, master data dan Netlify Functions yang sudah berjalan tetap dipakai untuk autentikasi, penugasan, serta pengambilan satu foto referensi secara terotorisasi. Foto repository tetap berada di private/staff-enrollment; tidak dipindah ke public. File di public/face-models hanyalah model AI, runtime dan lisensi.

Foto pendaftaran yang diambil lewat kamera/attachment tetap menggunakan jalur Firebase Storage yang sudah dibuat. Demo tanpa Storage menggunakan foto repository.

## Pasang paket

1. Terapkan delta V5 di atas V4.3. Jika V4.3 belum diterapkan, unggah paket V4.3 dahulu agar jalur foto repository langsung sudah tersedia.
2. Unggah semua file delta dengan struktur folder tetap, termasuk package.json, package-lock.json, eslint.config.mjs, netlify.toml, folder scripts, lib dan app.
3. Jika repository sudah mempunyai .gitignore sendiri, tambahkan baris `/public/face-models/` ke file yang ada; pertahankan aturan lain. File .gitignore baru pada delta hanya menambahkan pengabaian aset hasil build tersebut.
4. Model dari paket sebelumnya harus tetap tersedia di face-service/models: yunet.onnx, MODEL_MANIFEST.json, kedua bagian sface.onnx.part01 dan part02, serta lisensinya. Model tidak dikirim ulang dalam delta.
5. Tunggu deployment Netlify dari branch yang digunakan selesai. Netlify memasang dependensi dan otomatis menjalankan prebuild untuk menyiapkan aset browser serta memverifikasi SHA-256 model. Tidak perlu memasang Node/Python/Docker pada laptop kantor. Jangan mengunggah folder node_modules atau aset public/face-models yang dihasilkan build.
6. Tidak perlu mengisi GAES_FACE_SERVICE_URL/KEY untuk mode browser. Pengaturan itu tetap milik mode mesin Python yang terpisah.

## Cara mencoba

1. Masuk menggunakan akun administrator yang berwenang di Seamless Access.
2. Di Registrasi Petugas, lengkapi identitas dan penugasan. Pilih foto Repository dengan nama file tepat (spasi di dalam nama diperbolehkan), centang persetujuan, lalu Impor foto.
3. Pilih **Simpan dan ajukan verifikasi**. Untuk uji browser, foto berstatus Menunggu peninjauan sudah dapat dipilih; persetujuan mesin Python tidak diperlukan. Status akses operasional tidak berubah karena demo.
4. Buka tab **Uji Wajah di Browser**. Tentukan station, lounge dan satu petugas untuk pencocokan. Pilihan berasal dari master data serta foto yang sudah diajukan untuk lounge itu.
5. Pilih orientasi mendatar/tegak dan video saat siaga bila diperlukan. Centang persetujuan sesi, lalu pilih **Buka kamera demo**.
6. Izinkan kamera. Tunggu model selesai dimuat pada pemakaian pertama. Koneksi yang lambat dapat memerlukan beberapa menit. Pemuatan dan inferensi berjalan di worker supaya halaman tetap responsif.
7. Posisikan satu wajah di depan kamera. Kecocokan menampilkan **Wajah sesuai referensi**, nama dan unit petugas. Wajah yang tidak cocok mendapat hasil tidak cocok. Tanpa wajah, layar menampilkan video/sambutan saat siaga.
8. Hasil tampil sekitar enam detik. Menjauh dari kamera mengembalikan video siaga dan menyiapkan pencocokan berikutnya dengan referensi yang sama. Sesi berakhir setelah sepuluh menit. Tekan Esc pada perangkat operator untuk menutup layar dan kamera.

Panel Kesiapan layanan server pada halaman operasional masih menunjukkan koneksi mesin Python. Mode browser dipilih melalui tab Uji Wajah di Browser dan memiliki proses pemuatan model sendiri.

## Jika belum berjalan

| Keadaan | Langkah |
| --- | --- |
| Petugas belum tersedia pada pilihan | Pastikan station/lounge benar dan foto sudah diajukan, lalu buka kembali tab browser. Foto yang hanya diimpor tetapi belum diajukan belum menjadi referensi demo. |
| Model browser belum tersedia | Periksa deployment terbaru. Pastikan semua file delta dan model lama ikut pada branch, lalu lihat log `prebuild`. |
| Model rusak/tidak lengkap | Build dan browser memeriksa checksum. Jangan mengedit bagian model atau mengganti ONNX dengan HTML/link unduhan. |
| Mesin browser gagal | Gunakan Chrome/Edge terkini, periksa apakah kebijakan perangkat mengizinkan WebAssembly dan kamera, kemudian coba kembali. |
| Kamera tidak terlihat | Periksa izin kamera untuk domain HTTPS website serta ketersediaan kamera pada perangkat. |
| Wajah terlalu kecil/kurang tajam | Dekatkan wajah, gunakan pencahayaan cukup dan foto referensi frontal yang jelas. |
| Sesi berakhir | Tutup layar dengan Esc dan siapkan sesi baru. |

## Batas hasil demo

Hasil browser adalah pencocokan lokal 1:1 dengan ambang cosine 0.5 sebagai titik awal demo; bukan hasil kalibrasi akurasi operasional. Foto hidup/anti-spoofing belum dievaluasi. Mode ini tidak mencari siapa seseorang di seluruh database, tidak menyimpan hasil sebagai verifikasi server, tidak mengaktifkan akun/akses, dan tidak memanggil autogate. Konfirmasi akses tetap dilakukan petugas.

Foto referensi dikirim hanya setelah admin memilih satu petugas, lokasi yang sesuai dan persetujuan sesi. Foto tidak disimpan di localStorage/IndexedDB. Worker dan referensi dilepas saat layar ditutup. Pengambilan referensi tetap menolak foto yang belum diajukan, akses yang dicabut, akun terkait yang dinonaktifkan dan lounge di luar penugasan.

## Pengujian V5

- 170 tes Node: 11 normalisasi, 40 UI dan 119 seamless; ESLint 0 error, 32 warning sebelumnya.
- 25 alur browser lolos tanpa uncaught runtime error, termasuk browser demo nyata memakai model YuNet/SFace, kamera simulasi dari foto uji lokal, pengembalian video siaga, kedaluwarsa sesi, ID/EN dan tanpa panggilan mesin server/autogate.
- Lima pemeriksaan khusus worker/model nyata: foto sama, variasi kecerahan, penolakan tanpa wajah, pengosongan referensi yang tidak valid dan penolakan model rusak oleh SHA-256 di bawah CSP yang membatasi koneksi ke same-origin.
- Build produksi Next.js/TypeScript, penyiapan aset dan bundling function lolos. Versi dependensi lama tetap; lima paket terkait ONNX Runtime ditambahkan melalui lockfile.
- Pengujian memakai Chromium headless. Kamera fisik pengguna, perangkat kantor dan deployment Firebase/Netlify pengguna belum diakses atau diuji langsung. Foto uji tidak disertakan sebagai data petugas.

Perintah pengujian pengembang (bukan langkah pengguna laptop kantor):

```text
npm test
GAES_FACE_TEST_IMAGE=/path/to/test.jpg npm run test:seamless:browser
GAES_FACE_TEST_IMAGE=/path/to/test.jpg npm run test:browser-face
```

Playwright/Chromium perlu tersedia untuk dua tes browser opsional. PLAYWRIGHT_MODULE dan CHROMIUM_EXECUTABLE_PATH dapat diarahkan ke instalasi penguji. Build Netlify tidak memerlukan Playwright.

Referensi implementasi:
- https://onnxruntime.ai/docs/tutorials/web/
- https://onnxruntime.ai/docs/tutorials/web/deploy.html
- https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_detect.cpp
- https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_recognize.cpp

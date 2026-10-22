# Unggah paket Seamless Access melalui website GitHub

Paket kumulatif ini menggantikan paket Seamless Access sebelumnya. Gunakan
bersama baseline GAES-V-22.2 yang sama; jangan membuat proyek/Firebase baru.

1. Unduh **kedua** ZIP: `GAES-Seamless-Access-Delta.zip` dan
   `GAES-Seamless-Access-Model-Part2.zip`.
2. Ekstrak keduanya ke **folder yang sama**, sehingga folder `face-service`
   dari kedua ZIP menyatu. ZIP kedua adalah arsip biasa yang dapat diekstrak
   sendiri, bukan volume ZIP yang harus digabung dengan aplikasi khusus.
3. Unggah **isi hasil ekstraksi**, bukan file ZIP, ke root repository/branch PR
   yang sedang digunakan. Pertahankan struktur folder; `app` tetap `app`,
   `face-service` tetap `face-service`. Sertakan perubahan file konfigurasi
   `.gitignore` dan `.dockerignore` di dalam `face-service`.
4. Pastikan kedua file berikut ada di repository sebelum build mesin wajah:
   - `face-service/models/sface.onnx.part01` — 20 MiB.
   - `face-service/models/sface.onnx.part02` — sekitar 16,9 MiB.
   Jangan unggah `sface.onnx` utuh (36,9 MiB). Jika file utuh sudah pernah
   dilacak di branch melalui cara lain, hapus file itu dari repository;
   `.gitignore` tidak menghapus file yang sudah dilacak.
5. Upload bisa dilakukan dalam beberapa batch pada branch PR yang sama.
   Selesaikan seluruh file sebelum merge. Jangan unggah model ke `public/`.

Saat membangun container server mesin wajah, Docker otomatis menjalankan
`prepare_models.py`. Skrip menggabungkan kedua bagian menurut urutan manifest,
memeriksa ukuran dan SHA-256 setiap bagian, lalu memeriksa SHA-256 model utuh.
Build gagal bila bagian hilang/rusak; tidak ada unduhan model dari internet.
Mode Python tanpa Docker juga menggabungkan otomatis ketika mesin dimulai.
File model utuh hasil penggabungan diabaikan oleh Git dan konteks build Docker.

Pembagian ini hanya mengubah distribusi file. Model, bobot, dan hasil inferensi
tetap sama. Deploy web di Netlify saja belum menjalankan server Python;
ikuti `face-service/README.md` untuk pemasangan server dan konfigurasi backend.
Tahap pertama tetap verifikasi 1:1; liveness dan pembukaan gerbang otomatis
belum diaktifkan.

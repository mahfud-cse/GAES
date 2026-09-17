# GAES v0.22.1 — Netlify Functions Hotfix

## Perubahan

- Memigrasikan seluruh fungsi server dari `handler(event)` lama ke default Web API handler berbasis `Request` dan `Response`.
- Mempertahankan nama endpoint, format payload, status HTTP, dan otorisasi yang digunakan frontend.
- Mempertahankan dua koneksi Firebase: target GAES dan source Ground Experience Portal.
- Mempertahankan fungsi tambah pengguna, import pengguna, manajemen pengguna, bootstrap Super Admin, penyimpanan visitor, perubahan password pertama, resolusi username, dan sinkronisasi lounge/tenant.
- Menambahkan kode error duplikasi penumpang ke respons JSON.

## Tidak berubah

- Environment variables Netlify.
- Firebase credentials dan Firestore rules.
- `netlify.toml`.
- UI dan halaman website.

## Validasi

- Seluruh sembilan modul lolos pemeriksaan sintaks Node.js.
- Tidak terdapat lagi legacy `handler(event)`, `event.httpMethod`, atau `event.body`.
- Seluruh sembilan modul mengembalikan Web API `Response`.
- Build produksi Next.js 16.2.6 berhasil, termasuk TypeScript dan static-page generation.

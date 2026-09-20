# Upload GAES v0.22.2 ke GitHub

Paket ini berisi file pengganti saja. Struktur folder di dalam paket sama dengan root repository GitHub.

1. Ekstrak ZIP.
2. Upload seluruh isi folder hasil ekstrak ke **root repository** GitHub, bukan folder pembungkus `GAES_v0.22.2_GitHub_Replacement_Files`.
3. Saat GitHub meminta konfirmasi, pilih penggantian file dengan path yang sama dan tambahkan file baru `lib/boarding-pass.ts`.
4. Commit satu kali, misalnya: `GAES v0.22.2 scanner and Netlify runtime fix`.
5. Biarkan Netlify melakukan deploy dari commit tersebut. Tidak perlu mengubah atau mengimpor ulang environment variables.

File yang diganti/ditambahkan:

- `app/page.tsx`
- `app/globals.css`
- `lib/boarding-pass.ts` (baru)
- `lib/firebase/api.ts`
- `package.json`
- `package-lock.json`
- `VERSION.txt`
- `docs/RELEASE_GAES_V0.22.2.md`

Setelah deploy berhasil, lakukan satu kali UAT untuk scan nyata, tambah/import user, dan sinkronisasi lounge. Status paket ini **statically verified**, belum dinyatakan live-verified sampai UAT produksi selesai.

# Upload GAES v0.22.3

Unggah seluruh isi paket ini ke **branch UAT**, dengan struktur folder tetap sama. File di dalam paket menggantikan file dengan path yang sama; tidak perlu menghapus file repository lain.

Setelah commit, buka Netlify Deploy Preview dan jalankan checklist pada `docs/RELEASE_GAES_V0.22.3.md`. Merge ke `main` hanya setelah UAT selesai.

Environment variable tidak tersimpan dalam GitHub. Perubahan env dilakukan di Netlify dan memerlukan deploy baru.

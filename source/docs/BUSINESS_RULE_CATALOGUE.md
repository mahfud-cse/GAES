# Business Rule Catalogue

1. Normalisasi scan menghapus trailing spaces dan control characters tanpa mengubah raw scan untuk audit.
2. Token terakhir yang mengandung huruf `Y` (case-insensitive) menghasilkan Eligible; selain itu Not Eligible.
3. Duplikasi visitor: nama + flight + check-in sequence.
4. Date of Travel dipilih berurutan dari Julian day boarding pass, flight schedule D-1/D/D+1, lalu konfirmasi manual bila ambigu.
5. Penerbangan pukul 01.00 yang dipindai pukul 22.00 hari sebelumnya dicatat pada tanggal keberangkatan berikutnya.
6. Local Time mengikuti station aktif; akun HO/Admin/Super Admin default Jakarta.
7. Data Declined dipertahankan untuk audit tetapi tidak menjadi payable visitor.
8. Evidence dispute dikirim kembali kepada verifier yang sama.
9. Sign-off per tanggal terkunci sampai seluruh data berstatus final.
10. Final PDF hanya memuat Accepted visitor; draft dan dispute report dapat memuat status lain.
11. Semua field referensi master menggunakan searchable dropdown dan tidak menerima nilai bebas yang tidak terdaftar.

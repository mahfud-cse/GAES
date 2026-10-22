# Perbaikan unggah foto V4.2 — hanya file berubah

## Pemasangan
Terapkan di atas paket V4.1 yang terakhir dikirim. Ekstrak ZIP dan unggah isi folder ke root repository/branch yang sama dengan website. Pertahankan struktur folder. Paket ini hanya berisi file baru/berubah; tidak berisi model ONNX, foto, node_modules, atau file konfigurasi Firebase/rules yang tidak berubah. Tidak ada file yang harus dihapus. Tunggu deployment branch yang sesuai berhasil, lalu coba impor/unggah kembali.

## Temuan dan perubahan
Pesan SERVICE_UNAVAILABLE sebelumnya menyembunyikan error dari Firebase Admin/Cloud Storage. Impor repository tetap memakai Firebase Storage yang sudah ada untuk menyimpan salinan foto; memiliki file di GitHub saja tidak menjamin penulisan ke Storage berhasil. Tidak ada akses ke log deployment atau kredensial produksi dalam sesi ini, sehingga penyebab infrastruktur pada deployment pengguna belum dipastikan dan keberhasilan unggah live tidak diklaim.

Adapter sekarang membedakan konfigurasi bucket, izin service account, kredensial, bucket/foto tidak ditemukan, status akun/penagihan, API dan kuota. Nama bucket yang sudah digunakan dinormalisasi bila berisi spasi di ujung, awalan gs:// atau satu slash penutup. Tidak menebak/membuat bucket baru dan tidak mengganti Firebase proyek.

Respons error membawa nomor referensi acak. UI menampilkannya di dekat foto. Log function seamless-operations hanya mencatat referensi, tahap operasi dan kode/status yang dibatasi; tidak mencatat foto, path personal, nama bucket, token, URL bertanda tangan atau pesan mentah penyedia. Foto belum dianggap tersimpan ketika upload gagal, dan pengajuan tetap diblokir sampai penyimpanan berhasil.

## Jika masih gagal
Baca pesan baru berikut nomor referensinya. Jangan mengirim private key atau token.

| Pesan/kode | Pemeriksaan administrator |
| --- | --- |
| STORAGE_NOT_CONNECTED / STORAGE_CONFIG_INVALID | Periksa FIREBASE_STORAGE_BUCKET atau NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET pada deployment function. Gunakan nama bucket yang sudah ada dari Firebase Storage; jangan memasukkan URL download atau path objek. |
| STORAGE_PERMISSION_DENIED | Service account yang dipakai FIREBASE_CLIENT_EMAIL perlu izin objek untuk membuat dan membaca foto di bucket tersebut. Mengubah Storage Rules publik tidak memperbaiki izin Admin SDK. |
| STORAGE_CREDENTIAL_INVALID | Periksa konfigurasi service account server tanpa membagikan kuncinya. |
| STORAGE_BUCKET_NOT_FOUND | Cocokkan nama bucket server dengan bucket yang sudah digunakan. |
| STORAGE_PROJECT_BLOCKED / STORAGE_API_DISABLED / STORAGE_QUOTA_EXCEEDED | Periksa status layanan, akun/penagihan, atau kuota pada proyek yang sama. Tidak ada perubahan penagihan otomatis dari paket ini. |
| REPOSITORY_PHOTO_NOT_FOUND | Periksa case/nama file dan keberhasilan deployment dari branch yang memuat foto. |
| REPOSITORY_READ_FAILED | Periksa file yang disertakan function dan izin baca deployment. |
| STORAGE_OPERATION_FAILED | Cari nomor referensi di log Netlify function seamless-operations; periksa tahap storage-save/read/metadata/preview. |

## Validasi
159 tes Node lolos (11 normalisasi, 40 UI, 108 seamless termasuk 14 tes adapter Storage). ESLint 0 error dan 32 warning sebelumnya. 20 pemeriksaan browser dengan simulasi kamera/Auth/Firestore/Storage/mesin wajah lolos, termasuk pesan izin Storage serta nomor referensi yang diteruskan melalui HTTP dan ditampilkan di dekat foto. Build/TypeScript diperiksa terpisah. Adapter Storage diuji dengan driver uji, bukan bucket produksi. Tidak ada unggah atau pemeriksaan IAM pada proyek pengguna dalam sesi ini.

Referensi resmi:
- https://firebase.google.com/docs/storage/admin/start
- https://cloud.google.com/storage/docs/json_api/v1/status-codes
- https://cloud.google.com/storage/docs/access-control/iam-permissions

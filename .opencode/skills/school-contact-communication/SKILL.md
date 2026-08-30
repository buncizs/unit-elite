# Skill: School Contact & Human WhatsApp Communication

## Tujuan
Menentukan kontak sekolah secara deterministik dari registry lokal, mempertahankan seluruh target sumber, dan menyusun pesan WhatsApp natural yang siap direview.

## Target completeness — hard rule
`SOURCE TARGET COUNT = OUTPUT TARGET COUNT`.
Setiap sekolah sumber harus muncul tepat satu kali di output operasional, termasuk jika:
- nomor tidak ada;
- format nomor tidak usable;
- akun WhatsApp belum/ tidak dapat diverifikasi;
- terjadi identity conflict;
- terjadi ambiguity.

Kegagalan kontak tidak boleh menghapus sekolah dari report.

## Identity resolution
1. NPSN adalah kunci utama jika tersedia.
2. Nama sekolah dan Kab/Kota adalah cross-check.
3. NPSN cocok tetapi nama material berbeda -> `IDENTITY_CONFLICT`; jangan silent correction.
4. Tanpa NPSN, gunakan nama sekolah ternormalisasi + Kab/Kota.
5. `SMK NEGERI` dan `SMKN` ekuivalen untuk pencarian, begitu pula variasi spasi/tanda baca.
6. Kandidat >1 -> `AMBIGUOUS`; jangan memilih diam-diam.

## Contact selection
1. Cari Kepala Sekolah dengan nomor mobile usable.
2. Bila tidak ada, pilih baris pertama dengan nomor usable pada NPSN yang sama sesuai urutan CSV sumber.
3. Bila tidak ada nomor usable sama sekali -> machine `NO_USABLE_CONTACT`; operasional: `Kontak sekolah belum tersedia pada registry`.
4. Jangan mengambil kontak dari NPSN lain.
5. Sebelum live WhatsApp verification tersedia, nomor valid format tetap dipertahankan dengan `WhatsApp Status=UNKNOWN`; jangan drop target.
6. Jika kelak ada bukti `NOT_REGISTERED`, boleh mencoba fallback contact berikutnya pada NPSN yang sama dan rekam basis fallback.

## Phone normalization
- hapus spasi, tanda hubung, kurung, simbol non-digit;
- `08...` -> `628...`;
- `8...` -> `628...`;
- `62...` dipertahankan;
- hanya bentuk mobile Indonesia akhir `628...` dengan panjang masuk akal yang dianggap usable;
- buat `https://wa.me/<normalized>`;
- `wa.me` bukan verifikasi akun WhatsApp.

## Separation: machine vs human language
Machine metadata boleh memuat enum/status teknis, tetapi pesan WA tidak boleh memuat enum tersebut.

### Banned machine strings in WA
`IDENTITY_CONFLICT`, `DEADLINE_PASSED`, `WHATSAPP_UNVERIFIED`, `UNVERIFIED_ACCOUNT`, `CONTACT_VERIFIED`, `FALLBACK_MANAGEMENT`, `MATCH_SCORE`, `HIGH_CONFIDENCE`, `LOW_CONFIDENCE`, `READY_FOR_REVIEW`, `SOURCE_RECORD`, `REGISTRY_MATCH`, `NO_USABLE_CONTACT`.

## Message drafting
### Informasi biasa
Gunakan bahasa staf Dinas yang wajar: salam, konteks singkat, maksud, tindakan, konfirmasi penerimaan.

### Pengantar surat/file
Salam -> "izin meneruskan" -> identifikasi konteks/surat yang terverifikasi -> nama sekolah -> tindakan yang diminta -> sebut file terlampir -> minta konfirmasi -> terima kasih.
Jangan salin surat panjang ke WA.

### Deadline yang sudah lewat
Jangan menulis seolah deadline masih masa depan. Ubah fungsi pesan menjadi tindak lanjut/konfirmasi status tanpa menampilkan enum `DEADLINE_PASSED`.

## XLSX
Gunakan dua sheet:
1. `PENGIRIMAN` untuk staf/manusia;
2. `QC_DETAIL` untuk machine/audit.

Baris tanpa kontak usable tetap ada dan bold pada `PENGIRIMAN`.

## Anti-hallucination
Dilarang:
- menebak nomor HP;
- mengklaim akun WhatsApp verified tanpa evidence;
- mengubah NPSN;
- menggabungkan kontak antar sekolah;
- menghilangkan target gagal;
- mengklaim pesan sudah dikirim;
- web-search nomor sebagai fallback kecuali disposisi eksplisit mengizinkan sumber eksternal.

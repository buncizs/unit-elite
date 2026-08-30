# Contact Registry Sekolah

Sumber awal: `nomor_ks.csv` yang diberikan pengguna pada 28 Agustus 2026.

Kolom sumber:
- No.
- Kab/Kota
- NPSN
- Nama SMK
- Nama PTK
- No HP
- Tugas Tambahan

## Aturan penggunaan
1. NPSN adalah identity key utama.
2. Prioritas kontak: Kepala Sekolah dengan nomor valid.
3. Jika nomor Kepala Sekolah kosong/tidak valid, gunakan **kontak valid pertama dalam sekolah/NPSN yang sama sesuai urutan sumber CSV**.
4. Jika tidak ada nomor valid pada seluruh kontak sekolah, tandai **SEKOLAH TIDAK UPDATE KONTAK**.
5. Nomor dinormalisasi untuk tautan `https://wa.me/<nomor>` dengan kode negara 62. Tautan wa.me hanya menunjukkan format yang dapat dicoba; sistem TIDAK mengklaim nomor benar-benar terdaftar pada WhatsApp tanpa verifikasi layanan eksternal.
6. Data kontak bersifat internal. Jangan dikirim ke web/MCP eksternal tanpa otorisasi.
7. Untuk memperbarui registry, ganti `nomor_ks.csv` dengan snapshot terbaru dengan header yang sama.

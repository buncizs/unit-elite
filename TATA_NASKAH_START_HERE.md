> **v1.3 note:** Untuk workflow terbaru, mulai dari `V13_START_HERE.md`. Dokumen ini dipertahankan sebagai referensi v1.1/v1.2.

# Unit Elite Tata Naskah Jatim v1.2

Paket ini menambahkan **institutional drafting rules** untuk naskah dinas Pemerintah Provinsi Jawa Timur ke Unit Elite OpenCode Desktop.

## Prinsip hierarki sumber

1. **Authority**: Pergub Jawa Timur Nomor 31 Tahun 2024 tentang Tata Naskah Dinas.
2. **Kearsipan/klasifikasi**: Pergub Jawa Timur Nomor 30 Tahun 2023, terbatas pada ketentuan yang diubah dan Lampiran II kode klasifikasi arsip.
3. **Master template v1.2**: template yang dinormalisasi dari aturan normatif + praktik Dinas Pendidikan.
4. **Practice reference**: contoh surat aktual hanya referensi implementasi, bukan sumber hukum.

Jika praktik lama bertentangan dengan Pergub, **Pergub menang**.

## Batas penting

Pergub 30/2023 adalah perubahan atas Pergub 26/2009. File Pergub 26/2009 belum tersedia di paket ini. Karena itu, skill `tata-kearsipan-jatim` pada v1.2 hanya boleh mengandalkan **kode klasifikasi dan perubahan yang memang terdapat dalam Pergub 30/2023**. Jangan menyimpulkan seluruh tata kearsipan dari file perubahan saja.

## Cara pakai di OpenCode Desktop

1. Buka folder proyek ini sebagai project OpenCode.
2. Pilih `ketua-tim`.
3. Untuk drafting naskah, sampaikan jenis produk dan data yang tersedia.
4. Ketua harus meneruskan ke drafter yang sesuai dan mengirim produk ke `verifikator-qc` sebelum final.
5. Jalankan `/uji-tata-naskah` untuk smoke test ringan.

## Aturan nomor surat

Nomor korespondensi mengikuti pola:

`[KODE KLASIFIKASI]/[NOMOR URUT AGENDA]/[KODE KOMPONEN PERANGKAT DAERAH]/[TAHUN]`

Agent **dilarang mengarang** nomor agenda atau kode komponen perangkat daerah. Jika data register aktual tidak tersedia, gunakan placeholder.

---
description: Pencarian cepat kontak sekolah melalui Narahubung dan registry lokal
agent: ketua-tim
---

Ini adalah **QUICK CONTACT LOOKUP**, bukan task substantif kecuali user meminta report/artifact.

Delegasikan hanya ke `narahubung`.
Narahubung wajib menggunakan `contact_lookup` dan aturan registry lokal.

Kembalikan untuk setiap sekolah:
- NPSN
- Nama sekolah
- Kab/Kota
- Nama kontak terpilih
- Jabatan
- Nomor WA normalized
- Link wa.me
- basis pemilihan (Kepala Sekolah/fallback)
- WhatsApp Status
- warning jika `SEKOLAH TIDAK UPDATE KONTAK`, `AMBIGUOUS`, `SCHOOL_NOT_FOUND`, atau `IDENTITY_CONFLICT`.

Jangan membuat klaim nomor benar-benar aktif di WhatsApp. Jangan menggunakan web search sebagai fallback.

PERMINTAAN:
$ARGUMENTS

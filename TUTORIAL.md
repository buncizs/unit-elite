> **v1.3 note:** Untuk workflow terbaru, mulai dari `V13_START_HERE.md`. Dokumen ini dipertahankan sebagai referensi v1.1/v1.2.

# Tutorial Operasional Unit Elite di OpenCode Desktop

Versi starter kit: **1.1 Desktop Edition**.

Panduan ini tidak mewajibkan terminal/CLI. OpenCode Desktop memakai project config yang sama: `opencode.json`, `AGENTS.md`, `.opencode/agents/`, `.opencode/commands/`, dan `.opencode/skills/`.

## A. Komponen yang Sudah Tersedia

- `opencode.json` — default primary agent `ketua-tim`, sharing disabled, MCP test disabled.
- `AGENTS.md` — Konstitusi Unit Elite.
- `.opencode/agents/` — 9 agent.
- `.opencode/skills/` — protokol disposisi, QC, korespondensi, drafting, komunikasi eksekutif, arsip.
- `.opencode/commands/disposisi.md` — `/disposisi`.
- `.opencode/commands/uji-unit.md` — `/uji-unit`.
- `knowledge/`, `workspace/`, `archive/` — struktur kerja.

## B. Membuka Starter Kit

Extract folder, lalu pada OpenCode Desktop pilih **Open Project** dan buka root starter kit.

Root harus langsung mengandung `opencode.json` dan `AGENTS.md`. Jika OpenCode dibuka pada `workspace/` atau subfolder lain, discovery dapat tidak sesuai.

## C. Provider dan Model

Sambungkan provider melalui UI Desktop. Pilih model dari model selector. Pada baseline, biarkan seluruh subagent mengikuti model primary agar tidak menambah variabel saat debugging.

Jika primary agent tidak otomatis menjadi `ketua-tim`, pilih `ketua-tim` dari agent selector.

## D. Uji Discovery

Tanyakan:

```text
Baca konfigurasi project dan daftar file di .opencode/agents. Laporkan agent yang kamu temukan tanpa mengubah file.
```

Kemudian ketik `/` dan pastikan `/uji-unit` serta `/disposisi` muncul.

Subagents normal dapat diuji melalui `@mention`, misalnya:

```text
@analis-dokumen analisis samples/SMOKE_TEST_CASE.md secara ringkas.
```

## E. Uji Orkestrasi

Jalankan:

```text
/uji-unit
```

Kriteria sukses:
- Ketua mendelegasikan;
- specialist mengembalikan output;
- QC melakukan verifikasi;
- tidak ada specialist yang mendelegasikan agent lain;
- arsiparis tidak dipakai pada test.

## F. Protokol Operasional

### Analisis hukum

```text
/disposisi Analisis kewenangan dan risiko hukum pada dokumen di workspace/inbox. Gunakan sumber resmi untuk dasar hukum material. Jangan buat draft surat dulu.
```

Expected: Dokumen bila perlu → Legal → QC → Ketua.

### Kebijakan + Telaah Staf

```text
/disposisi Analisis masalah pada workspace/inbox, susun minimal tiga opsi kebijakan beserta trade-off, lalu buat konsep Telaah Staf. Klaim faktual dan dasar hukum wajib diverifikasi.
```

Expected: Dokumen/Legal/Policy → QC I → Juru Korespondensi → QC II → Ketua.

### Legal drafting

```text
/disposisi Berdasarkan bahan terverifikasi, susun konsep Pergub. Jangan mengarang dasar hukum. Tandai data yang belum tersedia sebagai placeholder dan berikan harmonization flags.
```

Expected: Legal + Policy → QC I → Juru Kebijakan → QC II → Ketua.

### Paparan/sambutan

```text
/disposisi Ubah bahan terverifikasi menjadi executive brief 7 slide untuk Kepala Dinas. Setiap slide satu pesan utama dan tandai keputusan yang diminta.
```

Expected: sumber specialist → QC → Paparan/Sambutan → QC final bila ada klaim material → Ketua.

## G. Quality Gate

Ketua secara teknis menerima hasil child session, tetapi hasil specialist tidak boleh dianggap `accepted evidence` sebelum QC.

```text
RAW SPECIALIST RESULT
        ↓
QC
  ┌─────┴─────┐
FAIL       PASS / PASS WITH NOTES
  ↓              ↓
REWORK      ACCEPTED EVIDENCE
                  ↓
                KETUA
```

Untuk produk formal gunakan dua gate:
1. **QC I** terhadap evidence/analysis packet.
2. **QC II** terhadap draft final.

## H. Arsip

Arsiparis hanya digunakan setelah produk dianggap final. Jangan meminta arsiparis menentukan substansi benar/salah.

Metadata minimum:
- tanggal;
- topik;
- jenis produk;
- status;
- versi;
- sumber terkait;
- QC status.

## I. Menambahkan Pengetahuan dan Template

Masukkan regulasi ke `knowledge/regulations/`, template resmi ke `knowledge/templates/`, kebijakan ke `knowledge/policies/`, dan literatur/referensi ke `knowledge/references/`.

Gunakan nama file yang jelas, misalnya:

```text
UU-23-2014-Pemerintahan-Daerah.pdf
PP-48-2008-Pendanaan-Pendidikan.pdf
Template-Telaah-Staf.docx
Template-Nota-Dinas.docx
```

Hindari dump ribuan file tanpa struktur. Mulai dari corpus yang sering digunakan.

## J. MCP

MCP bukan syarat baseline. Untuk pengguna Desktop tanpa CLI, strategi awal adalah:
1. gunakan built-in tools untuk file/web;
2. gunakan remote MCP bila ada endpoint yang benar-benar dibutuhkan dan dapat dikonfigurasi melalui `opencode.json`;
3. local MCP baru digunakan jika runtime/executable-nya sudah tersedia di komputer;
4. aktifkan per agent, bukan global, jika tools banyak.

Lihat `MCP_PHASE2.md`.

## K. Success Criteria v1

Unit Elite dianggap siap dipakai terbatas bila:
- `ketua-tim` aktif sebagai primary;
- 8 specialist terdeteksi sebagai subagent;
- specialist tidak dapat membuat chain delegation;
- `/uji-unit` PASS;
- QC menghasilkan status eksplisit;
- drafting melewati QC II;
- arsip hanya menerima hasil final.

---

# v1.5 Communication Gateway quick tutorial

Offline first:

```text
/diagnostik-komunikasi
/uji-komunikasi
```

School forward example:

```text
/forward-sekolah forwardkan file Surat.pdf di inbox kepada sekolah sesuai list pada Daftar.xlsx
```

Expected result before approval: `READY_FOR_APPROVAL`. Review the preview. Only then, if desired:

```text
KIRIM PESAN
```

`TASK SELESAI` is separate and only closes/archives the task.

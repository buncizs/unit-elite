> **v1.3.1 Desktop Root Hotfix:** perbaikan `Path escapes project root: package.json`. Lihat `HOTFIX_v1.3.1.md`.

# Troubleshooting — OpenCode Desktop Edition

## 1. `ketua-tim` tidak muncul
Pastikan Anda membuka **root folder starter kit**, bukan `workspace/` atau `.opencode/`.

Root harus memuat:
```text
opencode.json
AGENTS.md
.opencode/agents/ketua-tim.md
```

Tutup project lalu buka kembali root folder. Buat session baru.

## 2. Desktop tetap memakai Build/Plan
Gunakan agent selector di UI dan pilih `ketua-tim` secara manual. `opencode.json` memang mengatur `default_agent`, tetapi session lama/UI state dapat mempertahankan agent sebelumnya.

## 3. Subagent tidak muncul saat mengetik `@`
Cek bahwa folder `.opencode/agents/` tetap utuh setelah extract. Nama file menjadi agent ID.

Yang seharusnya terlihat antara lain:
- `analis-legal`
- `analis-dokumen`
- `analis-kebijakan`
- `juru-korespondensi`
- `juru-kebijakan`
- `paparan-sambutan`
- `arsiparis`

`verifikator-qc` sengaja `hidden: true`, jadi tidak harus tampil di autocomplete.

## 4. `/uji-unit` atau `/disposisi` tidak muncul
Pastikan:
```text
.opencode/commands/uji-unit.md
.opencode/commands/disposisi.md
```
berada di project yang sedang dibuka.

Tutup dan buka kembali project/session setelah perubahan struktur.

## 5. Ketua tidak mendelegasikan
Pastikan agent aktif benar-benar `ketua-tim`. Lalu beri instruksi eksplisit:

```text
Untuk tugas ini wajib gunakan subagent yang paling relevan dan lakukan QC. Jangan kerjakan seluruh analisis sendiri.
```

Jika masih gagal, minta Ketua membaca `.opencode/agents/ketua-tim.md` dan melaporkan `permission.task` yang ia lihat.

## 6. Specialist mencoba memanggil agent lain
Setiap specialist seharusnya memiliki:

```yaml
permission:
  task: deny
```

Ketua adalah satu-satunya routing authority.

## 7. QC tidak muncul di `@`
Normal. `verifikator-qc` menggunakan `hidden: true`. Uji melalui `/uji-unit`, karena Ketua boleh memanggilnya via Task.

## 8. Draft tidak bisa ditulis
Beberapa drafter memakai permission edit yang dibatasi. Minta output ditulis pada `workspace/output/`, bukan pada root atau `archive/`.

Jika Desktop menampilkan dialog permission, baca target path sebelum memilih Allow.

## 9. Arsiparis gagal menyimpan
Arsiparis hanya untuk `archive/**`. Pastikan produk sudah final/QC accepted dan instruksi meminta pengarsipan.

## 10. Skill tidak ditemukan
Pastikan file bernama tepat:

```text
.opencode/skills/<skill-id>/SKILL.md
```

Buat session baru setelah perubahan skill.

## 11. Desktop membuka project path yang salah
OpenCode Desktop pernah memiliki bug terkait project-folder/workspace identity pada beberapa versi. Jika nama/path yang tampil tidak sesuai:
1. tutup project;
2. pastikan folder yang dipilih benar di File Explorer/Finder;
3. extract starter kit ke folder baru dengan nama unik;
4. buka folder baru tersebut sebagai project baru;
5. hindari membuka dua copy project dengan struktur/path yang hampir identik saat debugging.

## 12. Provider connected tetapi model tidak tersedia
Gunakan Settings/Providers dan model selector di Desktop. Untuk custom provider, masalah dapat berasal dari provider definition, bukan agent kit. Uji terlebih dahulu dengan provider/model standar yang sudah berhasil digunakan pada chat biasa.

## 13. MCP gagal
Abaikan MCP selama baseline. Starter kit tidak memerlukan MCP untuk agent, command, skill, dan QC dasar.

Untuk remote MCP, cek URL/auth. Untuk local MCP, executable/runtime yang disebut pada `command` harus tersedia pada komputer karena Desktop akan mencoba menjalankannya sebagai child process.

## 14. `/init` sudah terlanjur dijalankan
Bandingkan `AGENTS.md` dengan copy asli dari ZIP starter. Pulihkan Konstitusi Unit jika tertimpa.

## 15. Setelah update OpenCode, config bermasalah
OpenCode Desktop masih berkembang cepat. Sebelum mengubah seluruh kit, uji tiga hal secara terpisah:
1. provider/model bisa chat normal;
2. `ketua-tim` bisa dipilih;
3. `@analis-dokumen` bisa dipanggil.

Jika 1 gagal: provider/Desktop.
Jika 1 berhasil tetapi 2 gagal: config/agent discovery.
Jika 2 berhasil tetapi 3 gagal: subagent/permission discovery.
Jika 3 berhasil tetapi `/uji-unit` gagal: orchestrator/task/QC workflow.

## TASK SELESAI berhenti karena file masih terbuka
v1.3.3 melakukan hard-stop dengan status `BLOCKED_FILE_IN_USE`. Tutup Word/Excel/PowerPoint/PDF viewer yang membuka file task atau input inbox, kemudian jalankan `TASK SELESAI` lagi. Tool tidak membuat salinan task_done selama status blocked.

Jika masalah berasal dari residue partial-close v1.3.2, setelah file ditutup gunakan `/repair-partial-close`. Tool hanya menghapus residue jika sudah ada archive CLOSED yang cocok dan checksum seluruh residue sama.

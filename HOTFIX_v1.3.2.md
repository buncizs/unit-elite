# HOTFIX v1.3.2 — No-Spawn Artifact Engine

## Masalah yang diperbaiki

OpenCode Desktop Windows dapat menghasilkan `spawn EINVAL` ketika custom tool mencoba menjalankan `npm.cmd`/proses eksternal melalui Node child_process. v1.3.1 masih melakukan bootstrap dependency dengan spawn.

## Perubahan

- Menghapus seluruh proses `npm install`, `bun install`, `npm.cmd`, PowerShell, dan `cmd.exe` dari artifact engine.
- Tidak memerlukan `node_modules`.
- Menambahkan ZIP/Open XML engine internal untuk DOCX, PPTX, dan XLSX.
- Menambahkan PDF writer internal untuk executive summary dan PDF sederhana.
- `artifact_diagnostics` sekarang read-only dan tidak menjalankan child process.
- Seluruh Tata Naskah Dinas v1.2 dan Task Lifecycle v1.3 tetap dipertahankan.

## Tes pertama

1. Buka project v1.3.2 sebagai folder baru di OpenCode Desktop.
2. Jalankan `/diagnostik-artifact`.
3. Hasil yang diharapkan: `verdict: PASS`, `spawn_attempted: false`, `external_dependencies_required: false`.
4. Baru jalankan `/uji-v13-ringkas`.

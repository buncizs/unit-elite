# Catatan OpenCode V2 / `opencode2`

Paket ini menargetkan OpenCode stable (`opencode`).

OpenCode V2 beta menggunakan beberapa sintaks yang berbeda. Contoh penting:
- stable/V1: `agent`, `permission`, `task`, `bash`
- V2: `agents`, `permissions` array, `subagent`, `shell`
- V2 MCP menggunakan `mcp.servers` dan field `disabled`, bukan struktur stable yang sama.

Jangan copy-paste konfigurasi V2 ke paket stable tanpa konversi menyeluruh.

Jika nanti Anda memutuskan migrasi ke V2, lakukan setelah baseline/evaluation Unit Elite stabil agar error arsitektur tidak bercampur dengan error migrasi platform.

Dokumentasi V2: https://opencode.ai/v2/docs

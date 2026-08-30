# Hotfix v1.3.1 — OpenCode Desktop Project Root

## Error yang diperbaiki
`Path escapes project root: package.json`

## Penyebab
v1.3 menggunakan `context.worktree` untuk semua custom tool. Pada OpenCode, `context.directory` adalah direktori proyek/session, sedangkan `context.worktree` adalah root Git worktree. Pada folder Desktop biasa/non-Git, `worktree` bukan root yang tepat untuk artifact engine.

## Perbaikan
- semua custom tools memprioritaskan `context.directory`;
- `context.worktree` hanya fallback;
- `process.cwd()` fallback terakhir;
- path containment memakai `path.relative()` agar aman juga pada root Windows/POSIX;
- `/diagnostik-artifact` melaporkan directory/worktree/effective_root.

Semua fungsi v1.2 Tata Naskah, template, QC, artifact generation, TASK SELESAI, task_done, executive-summary.pdf, dan manifest tetap dipertahankan.

# Build Notes v1.3

- Base: Unit Elite OpenCode Desktop v1.2 Tata Naskah.
- Retains 7 normative DOCX master templates.
- Adds local custom artifact tools and task lifecycle runtime.
- Artifact engine v1.3.3 is embedded and dependency-free. No npm/Bun bootstrap or child-process spawn is used.
- No MCP required for file generation.
- Task closure uses explicit human keyword + QC gate + checksum verification.
- Master placeholder `TANDA_TANGAN/TTE` normalized to `TANDA_TANGAN_TTE` for executable templating.

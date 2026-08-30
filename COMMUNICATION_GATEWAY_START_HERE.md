# Unit Elite v1.5 — Communication Gateway Start Here

v1.5 extends v1.4 without removing Tata Naskah, artifact generation, atomic task lifecycle, or Narahubung.

## New role
`dispatcher-komunikasi` is the only communication-gateway subagent. Narahubung remains responsible for school contact resolution and message drafting.

## Offline test first
Run:

```text
/diagnostik-komunikasi
/uji-komunikasi
```

These tests do not send WhatsApp messages.

## Universal forward examples

```text
/forward-sekolah forwardkan file Surat.pdf di inbox kepada sekolah sesuai list pada Daftar.xlsx
```

or natural language:

```text
Ketua, forwardkan file Surat.pdf di inbox kepada sekolah sesuai list pada Daftar.xlsx.
```

Internal/pimpinan:

```text
/forward-internal kirim Paparan_Hasil_Telaah.pptx kepada Kepala Dinas
```

## Expected state
After preparation the package MUST stop at:

```text
READY_FOR_APPROVAL
```

No external send occurs.

## Human approval
Only after reviewing preview, user may explicitly say:

```text
KIRIM PESAN
KIRIM SEMUA
KIRIM NOMOR 1-10
KIRIM 1,3,7
KIRIM SEMUA KECUALI 5 DAN 9
```

If a live backend is not connected, the system must report `BACKEND_NOT_CONNECTED`; it must not fake `SENT`.

## Task closure
`TASK SELESAI` remains an archive/lifecycle command only. It is never approval to send.

## Live pilot backend options

v1.5 includes a narrow local Go-bridge adapter (`whatsapp_bridge_*`) but does not start or pair the bridge. The send tool is permission=`ask` and still requires an APPROVED Delivery Package.

Recommended pilot path:

```text
lharries/whatsapp-mcp Go bridge
        ↓ localhost:8080/api
Unit Elite whatsapp_bridge_* tools
        ↓
Communication Gateway
```

This avoids exposing the full private-chat MCP surface to Unit Elite. The complete upstream MCP remains an optional integration path documented in `integrations/whatsapp-mcp-pilot/`.

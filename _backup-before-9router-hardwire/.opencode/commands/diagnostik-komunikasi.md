---
description: Cek kesiapan local Communication Gateway dan registry tanpa menghubungi WhatsApp
agent: ketua-tim
---

Panggil `communication_diagnostics`. Ini read-only dan tidak mengirim apa pun.

Laporkan:
- local gateway PASS/FAIL;
- human approval policy;
- auto-send policy;
- registry readiness;
- bridge status.

`BRIDGE_OFFLINE` bukan kegagalan local gateway karena backend live memang optional/disabled by default.

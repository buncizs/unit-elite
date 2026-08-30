# Desktop Diagnostic Prompts

## Discovery
```text
Baca opencode.json, AGENTS.md, dan daftar file .opencode/agents. Laporkan konfigurasi yang ditemukan. Jangan mengedit apa pun.
```

## Orchestrator identity
```text
Siapa kamu? Jelaskan fungsi Ketua Tim dan siapa saja specialist yang boleh kamu panggil. Jangan jalankan subagent dulu.
```

## Manual subagent
```text
@analis-dokumen baca samples/SMOKE_TEST_CASE.md dan buat ringkasan struktur fakta. Jangan panggil agent lain.
```

## Delegation test
```text
Gunakan Analis Dokumen untuk memetakan samples/SMOKE_TEST_CASE.md, lalu gunakan Verifikator/QC untuk mengecek apakah ringkasan tersebut setia pada sumber. Jangan membuat surat.
```

## Full smoke test
```text
/uji-unit
```

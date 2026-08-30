# Unit Elite v1.5.1e — Filename Hotfix v2

Hotfix ini mengganti mekanisme patch inline PowerShell yang gagal karena quoting/parser dengan file `.ps1` terpisah.

## Target
Pada `DocumentMessage`, metadata dikirim sebagai:

```go
Title:    proto.String(filepath.Base(mediaPath)),
FileName: proto.String(filepath.Base(mediaPath)),
```

Sehingga path Windows internal seperti:

`D:\OpenCode\...\output\Executive_Summary.pdf`

tidak lagi dikirim sebagai nama file. Penerima hanya melihat:

`Executive_Summary.pdf`

## Cara pakai
1. Tutup `whatsapp-bridge.exe`.
2. Jalankan `01_APPLY_FILENAME_FIX.bat`.
3. Masukkan folder `whatsapp-bridge`.
4. Setelah PASS, jalankan `02_REBUILD_BRIDGE.bat`.
5. Jalankan kembali bridge.
6. Kirim ulang PDF yang sama ke nomor pilot.

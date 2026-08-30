# UNIT ELITE v1.5.1a - GCC PATH Hotfix

Hotfix ini mengganti hanya:

`integrations/whatsapp-mcp-pilot/windows/02_BUILD_BRIDGE.bat`

Perubahan:
- mencari GCC otomatis di `C:\msys64\ucrt64\bin`;
- fallback ke beberapa lokasi MSYS2 umum;
- jika masih tidak ditemukan, meminta folder yang berisi `gcc.exe`;
- PATH hanya diubah untuk jendela build tersebut, bukan PATH Windows global;
- `CGO_ENABLED=1` dan `CC=gcc` hanya berlaku selama proses build;
- tidak lagi memakai `go env -w` untuk mengubah konfigurasi Go global.

## Cara pasang
1. Tutup jendela build lama.
2. Copy folder `integrations` dari patch ini ke root project Unit Elite dan pilih Replace.
3. Jalankan ulang `02_BUILD_BRIDGE.bat`.
4. Bila GCC berada di lokasi default MSYS2 (`C:\msys64\ucrt64\bin`), script akan menemukannya otomatis.
5. Jika build masih gagal, kirim teks error mulai dari `[INFO] Menjalankan go build...` sampai akhir.

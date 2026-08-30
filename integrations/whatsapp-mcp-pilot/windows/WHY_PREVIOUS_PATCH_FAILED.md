# Mengapa v1.5.1d gagal

Masalah berada pada script hotfix, bukan pada Go bridge.

Versi sebelumnya menyisipkan ekspresi PowerShell panjang langsung di dalam `.bat`. Kombinasi quoting, kurung, dan operator redirection `>` menyebabkan parser PowerShell membaca bagian script secara tidak utuh, sehingga muncul:

- `Unexpected token '('`
- `Missing closing '}'`

v1.5.1e menghapus pola tersebut. Semua logika patch dipindahkan ke `Apply-FilenameFix.ps1` sehingga `.bat` hanya menjalankan file PowerShell dengan parameter path.

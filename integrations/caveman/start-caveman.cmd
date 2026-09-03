@echo off
REM ============================================================================
REM  start-caveman.cmd - PLACEHOLDER skeleton (integrations/caveman/)
REM  Caveman proxy launcher untuk Unit Elite (TECH-0002-optimasi-token, mode B2)
REM ============================================================================
REM  CATATAN: Ini SKELETON. Tidak menjalankan/install apa pun.
REM  Proxy nyata BELUM TERSEDIA; proxy belum diaktifkan (config default enabled:false).
REM ============================================================================
REM  CONTOH LANGGAN YANG AKAN DIISI SETELAH PROXY NYATA TERSEDIA
REM  (mengikuti pola start-9router.cmd - loopback-only, fail-closed terhadap 0.0.0.0):
REM    1. Resolve executable proxy segment (node.exe + binary caveman proxy).
REM    2. Pre-flight: pastikan 127.0.0.1:PORT bebas dan TANPA 0.0.0.0:PORT.
REM       - 0.0.0.0 listener -> FAIL CLOSED, exit 3.
REM    3. Start proxy dengan --bind 127.0.0.1:<port> bermaksud:
REM         listen    : http://127.0.0.1:<port>/v1
REM         upstream  : http://127.0.0.1:20129/v1        (dari Runtime Gateway)
REM         downstream_to : http://127.0.0.1:20128/v1     (tujuan 9Router)
REM    4. Poll health sampai 200; verifikasi listener loopback, tanpa 0.0.0.0.
REM    5. KEDEPAN: atur runtime-config.json upstream_router lewat proxy (fail-open).
REM  PENTING: Proxy WAJIB bypassable (fail-open ke 9Router asli) bila mati,
REM           agar runtime tetap bisa lanjut (kontrak CAVEMAN_INTEGRATION.md §4).
REM ============================================================================

echo [CAVEMAN][SKELETON] placeholder launcher - belum diaktifkan.
echo [CAVEMAN][SKELETON] Proxy Caveman belum tersedia/terverifikasi [NEEDS_VERIFICATION].
echo [CAVEMAN][SKELETON] Jalankan proxy nyata HANYA setelah SYSTEM ACCEPTANCE.
echo [CAVEMAN][SKELETON] Exit code: 2 = not available (draft).

exit /b 2
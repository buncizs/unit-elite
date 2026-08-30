# Windows Pilot Notes

The upstream `lharries/whatsapp-mcp` is a two-process integration:
1. Go WhatsApp bridge (QR pairing, local SQLite, REST bridge).
2. Python MCP server launched over stdio (commonly through `uv`).

On Windows the upstream project documents that `go-sqlite3` requires CGO and a C compiler. This means the WhatsApp pilot is **not** as self-contained as Unit Elite's embedded artifact engine.

Recommended test order:
1. Use a dedicated test WhatsApp account/number if possible.
2. Get the Go bridge running and paired independently.
3. Verify the local bridge responds.
4. Connect MCP to OpenCode with the server disabled first, then enable intentionally.
5. Test only a self-owned/authorized number.
6. Test `send_message`.
7. Test `send_file` with a harmless dummy PDF.
8. Add `verify_numbers` patch/adaptor.
9. Only after the above works, enable Unit Elite Dispatcher pilot.

Never put OTP, QR session data, or authentication secrets into agent prompts or project knowledge.

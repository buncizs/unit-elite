# Security — Unit Elite v1.5

## Filesystem
- No unrestricted delete for specialists.
- Task closure uses file-lock preflight + atomic rename.
- Attachments in Delivery Packages must already belong to task `input/`, `output/`, or `support/` and are checksum-bound at approval/dispatch.

## Contact data
- School/internal contact registries are local controlled sources.
- Agents may not guess phone numbers.
- NPSN is the primary school identity key.
- Contact failure must remain visible in report.

## Communication
- No automatic dispatch after QC.
- `TASK SELESAI` is archive authorization only.
- External dispatch requires explicit human `KIRIM ...` approval.
- Every recipient passes `communication_dispatch_guard` before external send.
- `SENT`, `DELIVERED`, and `READ` must reflect backend evidence; never infer them.

## WhatsApp pilot
The optional community `lharries/whatsapp-mcp` backend is NOT installed/enabled by this build. It exposes broader chat-reading capabilities than Unit Elite requires and carries prompt-injection/data-exfiltration risk typical of powerful messaging MCPs. Use least privilege, a dedicated pilot account when possible, and do not put WhatsApp authentication/session secrets in prompts or knowledge files.

## Production recommendation
Treat the community WhatsApp Web MCP as pilot/bridge. Before institutional high-volume use, assess an officially supported institutional messaging backend and applicable governance/consent requirements.

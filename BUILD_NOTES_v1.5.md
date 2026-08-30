# Build Notes v1.5 — Communication Gateway Edition

## Added
- 11th subagent: `dispatcher-komunikasi`.
- Universal Delivery Package lifecycle.
- Human approval gate separated from task closure.
- Communication audit folder inside every new task.
- Communication tools:
  - `communication_prepare`
  - `communication_status`
  - `communication_approve`
  - `communication_dispatch_guard`
  - `communication_record`
  - `communication_cancel`
  - `internal_contact_lookup`
- Commands for school/internal forwarding, approval, status, cancellation and offline smoke testing.
- Internal contact-registry template.
- Optional WhatsApp MCP pilot integration documentation (disabled by default).
- Executive Summary task archive now records Delivery Packages.

## Narahubung fixes from v1.4 testing
- Natural-message requirement strengthened.
- Machine enum leakage banned from human WA messages.
- Target completeness is a hard rule.
- Schools without usable contact/verification remain in output.
- WhatsApp `UNKNOWN` is not treated as NOT_REGISTERED.
- Two-sheet report model: `PENGIRIMAN` + `QC_DETAIL`.

## Security boundary
No live WhatsApp backend is installed or enabled automatically in this build. External dispatch remains impossible until a pilot backend is deliberately installed, paired, configured, and enabled.

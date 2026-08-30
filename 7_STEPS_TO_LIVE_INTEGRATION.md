# 7 Steps to Live Communication Integration

## 1. Communication quality & target completeness
Natural human messages, no machine enums in WA, and `SOURCE TARGET COUNT = OUTPUT TARGET COUNT`.

## 2. Isolated WhatsApp MCP pilot
Install/pair an external pilot backend separately. No mass sending.

## 3. Minimal adapter / least privilege
Expose only verify/send file/send message/status functions needed by Unit Elite. Do not expose full private-chat history by default.

## 4. Number verification & same-school fallback
When verification is available, `NOT_REGISTERED` can trigger fallback to the next management contact in the same NPSN. `UNKNOWN` must not be treated as NOT_REGISTERED.

## 5. Communication Gateway & Delivery Package
Every outbound operation becomes an auditable package: recipient, message, attachment, source, verification, state.

## 6. Human Approval Gate
System stops at `READY_FOR_APPROVAL`. Only explicit user command beginning `KIRIM ...` may approve selection. Every recipient then passes a dispatch guard.

## 7. Delivery tracking & production hardening
Record SENT/FAILED/SKIPPED and only record DELIVERED/READ when backend evidence exists. Evaluate migration to an institutional/official backend before high-volume production.

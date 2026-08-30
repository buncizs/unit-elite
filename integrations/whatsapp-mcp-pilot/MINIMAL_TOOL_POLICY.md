# Minimal WhatsApp MCP Tool Policy

Target production design Unit Elite is **least privilege**.

## Needed by Dispatcher
- verify number/account capability (after custom patch/adaptor exists)
- send_message
- send_file
- optional delivery/status capability if backend provides evidence

## Not needed by default
- list all chats
- list/search all private messages
- download arbitrary media
- broad contact-history mining

The upstream `lharries/whatsapp-mcp` exposes more capabilities than Unit Elite needs. Do not enable broad chat-reading by default for government workflow.

## Approval boundary
Even after MCP is connected:
1. Delivery Package must be `READY_FOR_APPROVAL`.
2. User explicitly says `KIRIM ...`.
3. Package becomes `APPROVED`.
4. `communication_dispatch_guard` must pass for each recipient.
5. Only then may Dispatcher call external send tools.
6. Record factual outcome with `communication_record`.

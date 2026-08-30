# MCP & External Integration Strategy — Unit Elite v1.5

MCP is still not required for local artifact generation or task lifecycle. It becomes relevant for external systems such as messaging, register numbers, DMS, JDIH, and enterprise data.

## WhatsApp in v1.5
The community `lharries/whatsapp-mcp` can be used as a pilot backend, but Unit Elite deliberately does **not** enable it automatically.

Two pilot approaches are documented:
1. **Recommended narrow adapter:** run only the upstream Go WhatsApp bridge and let Unit Elite's `whatsapp_bridge_*` custom tools call its local REST API. This reduces exposed capabilities.
2. **Full MCP:** connect the Python MCP server to OpenCode. If used, disable broad WhatsApp tools globally and expose only the minimum tools to Dispatcher.

Both approaches still require:
- human pairing/authentication;
- Delivery Package;
- explicit `KIRIM ...` approval;
- per-recipient dispatch guard;
- factual delivery logging.

## Other MCP candidates
- register/correspondence source of truth;
- Srikandi/DMS;
- SharePoint/Google Drive;
- regulatory/JDIH service;
- internal evidence/data services.

## Guardrails
- least privilege per agent;
- no credential/OTP/session data in prompts;
- never infer official register numbers;
- do not equate QC PASS with external action authorization;
- external system writes require explicit user approval appropriate to the action.

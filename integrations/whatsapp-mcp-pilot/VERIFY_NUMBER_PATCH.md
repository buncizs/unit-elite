# Verification capability required for Unit Elite pilot

The upstream project can send to a phone/JID but its current MCP interface does not expose a reliable account-registration verification tool.

For Unit Elite, add a narrow verification capability to the bridge/server rather than inferring WhatsApp registration from `wa.me` or chat history.

## Bridge concept (Go / whatsmeow)
Add an endpoint such as `POST /api/verify` receiving one or more normalized international numbers and calling the whatsmeow client's `IsOnWhatsApp(...)` method. Return a per-number result such as:

```json
{
  "results": [
    {"number":"62812...", "registered":true, "jid":"..."},
    {"number":"62813...", "registered":false}
  ]
}
```

Do not silently mutate numbers inside the bridge; input normalization remains Unit Elite's responsibility.

## MCP concept (Python/FastMCP)
Expose only a narrow tool, for example:

```text
verify_numbers(numbers: list[str])
```

that calls the local bridge `/api/verify` endpoint and returns the results.

## Contact fallback behavior
- `REGISTERED`: use selected contact.
- `NOT_REGISTERED`: Narahubung may try the next management contact within the SAME NPSN.
- `UNKNOWN` / backend failure: do not drop the school and do not claim NOT_REGISTERED.

## Target completeness remains mandatory
A school must remain in the report even when all contacts fail verification.

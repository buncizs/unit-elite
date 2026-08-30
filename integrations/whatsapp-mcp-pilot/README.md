# WhatsApp MCP Pilot (Optional)

This folder prepares Unit Elite v1.5 for an optional pilot using `lharries/whatsapp-mcp`.

**Important:** the full Unit Elite build does not include, install, start, pair, or enable that third-party MCP automatically.

Reasons:
- it requires external Go/Python/uv prerequisites;
- Windows needs additional CGO/C-compiler setup according to upstream documentation;
- pairing requires a human QR action;
- the upstream MCP exposes broader private-chat tools than Unit Elite needs;
- production communication requires explicit human approval and a narrower capability surface.

Files:
- `opencode-v2-snippet.jsonc`: disabled-by-default OpenCode local MCP example.
- `MINIMAL_TOOL_POLICY.md`: least-privilege target.
- `VERIFY_NUMBER_PATCH.md`: required verification capability design.
- `WINDOWS_PILOT_NOTES.md`: staged Windows test plan.

Upstream project: https://github.com/lharries/whatsapp-mcp

## Recommended Unit Elite pilot mode

For least privilege, Unit Elite v1.5 already includes `whatsapp_bridge_diagnostics`, `whatsapp_bridge_verify`, and `whatsapp_bridge_dispatch` custom tools that talk only to the upstream Go bridge REST API. This means the Python MCP server is optional for the initial send pilot.

The Go bridge must still be installed, running, and QR-paired by the human operator. `whatsapp_bridge_dispatch` cannot send unless the Delivery Package was explicitly approved.

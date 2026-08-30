# Upgrade from v1.4 Narahubung to v1.5 Communication Gateway

Recommended: use the v1.5 PATCH over your existing working v1.4/v1.3.3 project so `workspace/` is preserved.

1. Close OpenCode Desktop.
2. Back up the project folder.
3. Extract the v1.5 PATCH.
4. Copy/merge patch contents into project root and replace matching configuration/agent/tool files.
5. Do NOT delete `workspace/` or your existing contact registry.
6. Reopen OpenCode Desktop.
7. Run `/diagnostik-komunikasi`.
8. Run `/uji-komunikasi`.
9. Test `/forward-sekolah` offline and confirm it stops at `READY_FOR_APPROVAL`.
10. Do not configure WhatsApp MCP until the offline gateway test passes.

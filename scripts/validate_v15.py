from pathlib import Path
import json, csv, sys
root=Path(__file__).resolve().parents[1]
errors=[]
required_tools=[
'communication_prepare','communication_status','communication_approve','communication_dispatch_guard','communication_record','communication_cancel','internal_contact_lookup','whatsapp_bridge_diagnostics','whatsapp_bridge_verify','whatsapp_bridge_dispatch','communication_diagnostics'
]
required_files=[
'artifact_engine/communication.js',
'.opencode/agents/dispatcher-komunikasi.md',
'.opencode/skills/communication-gateway/SKILL.md',
'.opencode/commands/forward-sekolah.md',
'.opencode/commands/forward-internal.md',
'.opencode/commands/kirim-pesan.md',
'.opencode/commands/status-pengiriman.md',
'.opencode/commands/batalkan-pengiriman.md',
'.opencode/commands/uji-komunikasi.md',
'knowledge/contact-registry/internal/internal_contacts.csv',
'integrations/whatsapp-mcp-pilot/opencode-v2-snippet.jsonc',
'COMMUNICATION_GATEWAY_START_HERE.md',
'7_STEPS_TO_LIVE_INTEGRATION.md'
]
for t in required_tools:
    if not (root/'.opencode/tools'/f'{t}.js').exists(): errors.append('missing tool '+t)
for f in required_files:
    if not (root/f).exists(): errors.append('missing '+f)
try:
    cfg=json.loads((root/'config/unit-elite.json').read_text(encoding='utf-8'))
    if cfg.get('version')!='1.5': errors.append('config version not 1.5')
    cg=cfg.get('communication_gateway',{})
    if not cg.get('human_approval_required'): errors.append('human approval not required')
    if cg.get('auto_send_after_qc') is not False: errors.append('auto_send_after_qc must be false')
    if cg.get('live_backend')!='DISABLED_BY_DEFAULT': errors.append('live backend must be disabled by default')
except Exception as e: errors.append('config error: '+str(e))
kt=(root/'.opencode/agents/ketua-tim.md').read_text(encoding='utf-8')
for marker in ['dispatcher-komunikasi','KIRIM PESAN','TIDAK berarti boleh mengirim','forwardkan file X']:
    if marker not in kt: errors.append('ketua missing marker: '+marker)
nh=(root/'.opencode/agents/narahubung.md').read_text(encoding='utf-8')
for marker in ['TARGET COMPLETENESS INVARIANT','DILARANG bocor ke pesan manusia','PENGIRIMAN','QC_DETAIL']:
    if marker not in nh: errors.append('narahubung missing marker: '+marker)
comm=(root/'artifact_engine/communication.js').read_text(encoding='utf-8')
for marker in ['READY_FOR_APPROVAL','communication_dispatch_guard' if False else 'DISPATCH_ALLOWED','Attachment changed after approval','SKIPPED_NO_CONTACT']:
    if marker not in comm: errors.append('communication engine missing marker: '+marker)
# School registry still readable
try:
    with open(root/'knowledge/contact-registry/nomor_ks.csv',encoding='utf-8-sig',newline='') as f:
        rows=list(csv.DictReader(f,delimiter=';'))
    if not rows: errors.append('school registry empty')
except Exception as e: errors.append('school registry error: '+str(e))
print('UNIT ELITE v1.5 VALIDATION')
print('RESULT:', 'PASS' if not errors else 'FAIL')
print('Communication/bridge tools:', len(required_tools))
print('Human approval: REQUIRED')
print('Live WhatsApp backend: DISABLED BY DEFAULT')
print('School registry rows:', len(rows) if 'rows' in locals() else 0)
if errors:
    for e in errors: print('-',e)
    sys.exit(1)

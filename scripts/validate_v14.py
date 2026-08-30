from pathlib import Path
import json, csv, re, sys
root=Path(__file__).resolve().parents[1]
errors=[]
for rel in [
'.opencode/agents/narahubung.md','.opencode/tools/contact_lookup.js','.opencode/skills/school-contact-communication/SKILL.md',
'.opencode/commands/cari-kontak-sekolah.md','.opencode/commands/uji-narahubung.md','knowledge/contact-registry/nomor_ks.csv','NARAHUBUNG_START_HERE.md']:
    if not (root/rel).exists(): errors.append('missing '+rel)
try:
    with open(root/'knowledge/contact-registry/nomor_ks.csv',encoding='utf-8-sig',newline='') as f:
        r=csv.DictReader(f,delimiter=';'); rows=list(r)
    required={'Kab/Kota','NPSN','Nama SMK','Nama PTK','No HP','Tugas Tambahan'}
    if not required.issubset(set(r.fieldnames or [])): errors.append('registry headers invalid')
    if len(rows)<1: errors.append('registry empty')
except Exception as e: errors.append('registry read: '+str(e))
cfg=json.loads((root/'config/unit-elite.json').read_text(encoding='utf-8'))

try:
    ver = tuple(int(x) for x in str(cfg.get('version','0')).split('.')[:2])
except Exception:
    ver = (0,0)
if ver < (1,4): errors.append('version below 1.4')
agent=(root/'.opencode/agents/ketua-tim.md').read_text(encoding='utf-8')
if '"narahubung": allow' not in agent: errors.append('ketua cannot delegate narahubung')
print('UNIT ELITE v1.4 VALIDATION')
print('Registry rows:', len(rows) if 'rows' in locals() else 0)
print('RESULT:', 'PASS' if not errors else 'FAIL')
for e in errors: print('-',e)
sys.exit(1 if errors else 0)

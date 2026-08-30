from pathlib import Path
import json, csv, sys
root=Path(__file__).resolve().parents[1]
required=[
 'knowledge/regulations/Pergub_Jatim_31_2024_Tata_Naskah_Dinas.pdf',
 'knowledge/regulations/Pergub_Jatim_30_2023_Perubahan_Tata_Kearsipan.pdf',
 '.opencode/skills/tata-naskah-dinas-jatim/SKILL.md',
 '.opencode/skills/tata-kearsipan-jatim/SKILL.md',
 'knowledge/templates/tata-naskah-dinas/template_manifest.json',
 'knowledge/archive-classification/klasifikasi_prioritas_dindik.csv',
]
manifest=json.loads((root/'knowledge/templates/tata-naskah-dinas/template_manifest.json').read_text(encoding='utf-8'))
required += ['knowledge/templates/tata-naskah-dinas/'+x for x in manifest['templates'].values()]
missing=[p for p in required if not (root/p).exists()]
print('TATA NASKAH PACK VALIDATION')
print('Templates:',len(manifest['templates']))
print('Missing:',len(missing))
for x in missing: print('-',x)
print('RESULT:', 'PASS' if not missing else 'FAIL')
sys.exit(1 if missing else 0)

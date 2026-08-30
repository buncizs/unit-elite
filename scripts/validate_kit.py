from pathlib import Path
import json, sys, re

ROOT = Path(__file__).resolve().parents[1]
errors = []

required = [
    'opencode.json', 'AGENTS.md',
    '.opencode/agents/ketua-tim.md',
    '.opencode/agents/analis-legal.md',
    '.opencode/agents/analis-dokumen.md',
    '.opencode/agents/analis-kebijakan.md',
    '.opencode/agents/juru-korespondensi.md',
    '.opencode/agents/juru-kebijakan.md',
    '.opencode/agents/paparan-sambutan.md',
    '.opencode/agents/narahubung.md',
    '.opencode/agents/dispatcher-komunikasi.md',
    '.opencode/agents/verifikator-qc.md',
    '.opencode/agents/arsiparis.md',
    '.opencode/commands/disposisi.md',
    '.opencode/commands/uji-unit.md',
]

for rel in required:
    if not (ROOT / rel).exists():
        errors.append(f'Missing: {rel}')

try:
    cfg = json.loads((ROOT/'opencode.json').read_text(encoding='utf-8'))
    if cfg.get('default_agent') != 'ketua-tim':
        errors.append('opencode.json: default_agent must be ketua-tim')
    if cfg.get('subagent_depth') != 1:
        errors.append('opencode.json: subagent_depth should be 1')
    if cfg.get('share') != 'disabled':
        errors.append('opencode.json: share should be disabled')
except Exception as e:
    errors.append(f'opencode.json invalid: {e}')

for p in (ROOT/'.opencode/agents').glob('*.md'):
    txt = p.read_text(encoding='utf-8')
    if not txt.startswith('---\n'):
        errors.append(f'{p.name}: missing YAML frontmatter')
    if 'description:' not in txt:
        errors.append(f'{p.name}: missing description')
    if 'mode:' not in txt:
        errors.append(f'{p.name}: missing mode')

# Basic routing check in ketua prompt/frontmatter
kt = (ROOT/'.opencode/agents/ketua-tim.md').read_text(encoding='utf-8') if (ROOT/'.opencode/agents/ketua-tim.md').exists() else ''
for aid in ['analis-legal','analis-dokumen','analis-kebijakan','juru-korespondensi','juru-kebijakan','paparan-sambutan','narahubung','dispatcher-komunikasi','verifikator-qc','arsiparis']:
    if aid not in kt:
        errors.append(f'ketua-tim.md: routing/permission missing {aid}')

skills = list((ROOT/'.opencode/skills').glob('*/SKILL.md')) if (ROOT/'.opencode/skills').exists() else []
if len(skills) < 5:
    errors.append('Expected at least 5 skills')

print('UNIT ELITE KIT VALIDATION')
print('Root:', ROOT)
if errors:
    print('RESULT: FAIL')
    for e in errors:
        print('-', e)
    sys.exit(1)
else:
    print('RESULT: PASS')
    print(f'Agents: {len(list((ROOT/".opencode/agents").glob("*.md")))}')
    print(f'Skills: {len(skills)}')
    print('Default agent: ketua-tim')
    print('Subagent depth: 1')
    print('Sharing: disabled')

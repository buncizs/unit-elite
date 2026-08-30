from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
errors=[]
required_tools=['task_create','task_add_input','task_status','generate_docx','generate_pptx','generate_xlsx','generate_pdf','artifact_validate','qc_record','task_close','task_cancel','artifact_diagnostics','task_repair_partial_close']
for t in required_tools:
    if not (root/'.opencode'/'tools'/f'{t}.js').exists(): errors.append('Missing tool: '+t)
for f in ['artifact_engine/zip.js','artifact_engine/runtime.js','artifact_engine/task.js','artifact_engine/docx.js','artifact_engine/pptx.js','artifact_engine/xlsx.js','artifact_engine/pdf.js','knowledge/templates/pptx/Master_Paparan_Dindik_Jatim_15slide.pptx']:
    if not (root/f).exists(): errors.append('Missing embedded engine file: '+f)
pkg=json.loads((root/'package.json').read_text())
if pkg.get('dependencies'): errors.append('v1.3.3 must not require external package dependencies')
runtime=(root/'artifact_engine/runtime.js').read_text()
if 'node:child_process' in runtime or 'spawn(' in runtime: errors.append('runtime.js still contains child-process spawn')
task=(root/'artifact_engine/task.js').read_text()
for required in ['BLOCKED_FILE_IN_USE','atomic-rename','probeRenameFile','probeRenameDirectory','await fsp.rename(taskDir, doneDir)']:
    if required not in task: errors.append('task.js missing atomic-close marker: '+required)
if 'await copyRecursive(src, path.join(doneDir' in task: errors.append('task_close still contains copy-then-delete archive behavior')
cmd=(root/'.opencode/commands/task-selesai.md').read_text()
if 'Jangan retry otomatis' not in cmd or 'BLOCKED_FILE_IN_USE' not in cmd: errors.append('TASK SELESAI command missing hard-stop instruction')
diag=(root/'.opencode/tools/artifact_diagnostics.js').read_text()
if 'spawn_attempted: false' not in diag: errors.append('diagnostics does not declare spawn_attempted false')
print('UNIT ELITE v1.3.3 VALIDATION')
print('RESULT:', 'PASS' if not errors else 'FAIL')
print('Custom tools:', len(required_tools))
print('Artifact engine: EMBEDDED / NO-SPAWN')
print('Task closure: FILE-LOCK PREFLIGHT + ATOMIC RENAME')
print('External dependencies: NONE')
if errors:
    for e in errors: print('-',e)
    sys.exit(1)

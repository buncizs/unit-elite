const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  console.error("ERROR: This builder is intended for Windows.");
  process.exit(1);
}

const sourceRoot = process.cwd();
const outDir = path.join(sourceRoot, "_portable_output");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "unitelite-portable-build-"));
const stageParent = path.join(tempRoot, "stage");
const appRoot = path.join(stageParent, "UnitElite");
const vendor = path.join(appRoot, "vendor");

const required = [
  "START-UNIT-ELITE.cmd",
  "STOP-UNIT-ELITE.cmd",
  "STATUS-UNIT-ELITE.cmd",
  "RECOVER-UNIT-ELITE.cmd",
  "opencode.json",
  "scripts\\d7-production\\common.ps1",
  "scripts\\d7-production\\start.ps1",
  "scripts\\d7-production\\status.ps1",
  "scripts\\d7-production\\stop.ps1",
  "scripts\\d7-production\\recover.ps1",
  "integrations\\9router\\start-9router.cmd",
  "integrations\\9router\\stop-9router.ps1",
  "integrations\\9router\\runtime\\start-runtime.ps1",
  "integrations\\9router\\runtime\\runtime-gateway.cjs"
];

function fail(msg, code=1) {
  console.error("ERROR: " + msg);
  try { fs.rmSync(tempRoot, { recursive:true, force:true }); } catch {}
  process.exit(code);
}

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

for (const rel of required) {
  if (!exists(path.join(sourceRoot, rel))) fail("Missing required production file: " + rel, 2);
}

const nodeDirCandidates = [
  path.dirname(process.execPath),
  "C:\\Program Files\\nodejs"
];
const nodeDir = nodeDirCandidates.find(p => exists(path.join(p, "node.exe")));
if (!nodeDir) fail("Node runtime directory not found.", 3);

const nineRouterDir = path.join(process.env.APPDATA || "", "npm", "node_modules", "9router");
if (!exists(path.join(nineRouterDir, "cli.js"))) fail("9Router global package not found: " + nineRouterDir, 4);

const openCodeDir = path.join(process.env.LOCALAPPDATA || "", "Programs", "@opencode-aidesktop");
if (!exists(path.join(openCodeDir, "OpenCode.exe"))) fail("OpenCode Desktop installation not found: " + openCodeDir, 5);

const whatsappExeCandidates = [
  "D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge\\whatsapp-bridge.exe"
];
const whatsappExe = whatsappExeCandidates.find(exists);
if (!whatsappExe) fail("WhatsApp Bridge executable not found.", 6);

console.log("SOURCE_ROOT=" + sourceRoot);
console.log("NODE=" + nodeDir);
console.log("9ROUTER=" + nineRouterDir);
console.log("OPENCODE=" + openCodeDir);
console.log("WHATSAPP=" + whatsappExe);

fs.mkdirSync(outDir, { recursive:true });
fs.mkdirSync(stageParent, { recursive:true });

const sourceNorm = path.resolve(sourceRoot).toLowerCase();
const outNorm = path.resolve(outDir).toLowerCase();

function copyFilter(src) {
  const r = path.resolve(src).toLowerCase();
  if (r === outNorm || r.startsWith(outNorm + path.sep)) return false;
  const rel = path.relative(sourceRoot, src).replace(/\//g, "\\").toLowerCase();
  if (rel === ".git" || rel.startsWith(".git\\")) return false;
  if (rel === "vendor" || rel.startsWith("vendor\\")) return false;
  if (rel.includes("\\scripts\\d7-production\\state\\")) return false;
  if (rel.endsWith("\\runtime-gateway.pid") || rel.endsWith("\\runtime-gateway.log") || rel.endsWith("\\runtime-gateway.err.log")) return false;
  return true;
}

console.log("[1/7] Copying Unit Elite application...");
fs.cpSync(sourceRoot, appRoot, { recursive:true, force:true, errorOnExist:false, filter:copyFilter });

console.log("[2/7] Bundling vendor runtimes...");
fs.mkdirSync(vendor, { recursive:true });
fs.cpSync(nodeDir, path.join(vendor, "node"), { recursive:true, force:true, errorOnExist:false });
fs.cpSync(nineRouterDir, path.join(vendor, "9router"), { recursive:true, force:true, errorOnExist:false });
fs.cpSync(openCodeDir, path.join(vendor, "opencode"), { recursive:true, force:true, errorOnExist:false });
fs.mkdirSync(path.join(vendor, "whatsapp"), { recursive:true });
fs.copyFileSync(whatsappExe, path.join(vendor, "whatsapp", "whatsapp-bridge.exe"));

function read(rel) { return fs.readFileSync(path.join(appRoot, rel), "utf8"); }
function write(rel, s, encoding="utf8") { fs.writeFileSync(path.join(appRoot, rel), s.replace(/\r?\n/g, "\r\n"), encoding); }
function replaceExact(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) fail(`${label}: expected 1 anchor, found ${n}`, 20);
  return src.replace(from, to);
}

console.log("[3/7] Refactoring copied runtime to portable paths...");

let common = read("scripts\\d7-production\\common.ps1");
common = replaceExact(
  common,
  "$WhatsAppBridgeDir = 'D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge'",
  "$WhatsAppBridgeDir = Join-Path $Root 'vendor\\whatsapp'",
  "WhatsApp portable path"
);
common = replaceExact(
  common,
  "    $candidates = @(\r\n        (Join-Path $env:LOCALAPPDATA 'Programs\\@opencode-aidesktop\\OpenCode.exe')\r\n    )",
  "    $candidates = @(\r\n        (Join-Path $Root 'vendor\\opencode\\OpenCode.exe'),\r\n        (Join-Path $env:LOCALAPPDATA 'Programs\\@opencode-aidesktop\\OpenCode.exe')\r\n    )",
  "OpenCode portable candidate"
);
common = replaceExact(
  common,
  "    try {\r\n        $node = (Get-Command node -ErrorAction Stop).Source\r\n        Write-Host \"PREFLIGHT_NODE_OK path=$node\"\r\n    } catch {\r\n        Write-Host 'BLOCKED_NODE_NOT_FOUND'\r\n        return $false\r\n    }",
  "    try {\r\n        $portableNode = Join-Path $Root 'vendor\\node\\node.exe'\r\n        if (Test-Path -LiteralPath $portableNode) {\r\n            $node = $portableNode\r\n        } else {\r\n            $node = (Get-Command node -ErrorAction Stop).Source\r\n        }\r\n        Write-Host \"PREFLIGHT_NODE_OK path=$node\"\r\n    } catch {\r\n        Write-Host 'BLOCKED_NODE_NOT_FOUND'\r\n        return $false\r\n    }",
  "Portable preflight Node"
);
write("scripts\\d7-production\\common.ps1", common);

let startRouter = read("integrations\\9router\\start-9router.cmd");
startRouter = replaceExact(
  startRouter,
  'set "RESOLVED_BY="',
  'set "RESOLVED_BY="\r\nset "PORTABLE_ROOT=%~dp0..\\.."\r\nif exist "%PORTABLE_ROOT%\\vendor\\node\\node.exe" (\r\n    set "NODE_EXE=%PORTABLE_ROOT%\\vendor\\node\\node.exe"\r\n    set "RESOLVED_BY=portable-vendor-node"\r\n)\r\nif exist "%PORTABLE_ROOT%\\vendor\\9router\\cli.js" (\r\n    set "CLI_JS=%PORTABLE_ROOT%\\vendor\\9router\\cli.js"\r\n    set "RESOLVED_BY=!RESOLVED_BY!+portable-vendor-9router"\r\n)',
  "Portable 9Router bootstrap"
);
startRouter = startRouter.replace(
  'if defined GLOBAL_NM if exist "!GLOBAL_NM!\\9router\\cli.js" (',
  'if not defined CLI_JS if defined GLOBAL_NM if exist "!GLOBAL_NM!\\9router\\cli.js" ('
);
write("integrations\\9router\\start-9router.cmd", startRouter, "ascii");

let stopRouter = read("integrations\\9router\\stop-9router.ps1");
stopRouter = replaceExact(
  stopRouter,
  "$CanonicalCustomServer = Join-Path $env:APPDATA 'npm\\node_modules\\9router\\app\\custom-server.js'\r\n$CanonicalCli = Join-Path $env:APPDATA 'npm\\node_modules\\9router\\cli.js'",
  "$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path\r\n$Portable9Router = [System.IO.Path]::GetFullPath((Join-Path $Dir '..\\..\\vendor\\9router'))\r\n$CanonicalCustomServer = Join-Path $Portable9Router 'app\\custom-server.js'\r\n$CanonicalCli = Join-Path $Portable9Router 'cli.js'",
  "Portable 9Router stop identity"
);
write("integrations\\9router\\stop-9router.ps1", stopRouter);

let startRuntime = read("integrations\\9router\\runtime\\start-runtime.ps1");
startRuntime = replaceExact(
  startRuntime,
  "$node = (Get-Command node -ErrorAction Stop).Source",
  "$Root = [System.IO.Path]::GetFullPath((Join-Path $Dir '..\\..\\..'))\r\n$PortableNode = Join-Path $Root 'vendor\\node\\node.exe'\r\nif (Test-Path -LiteralPath $PortableNode) {\r\n    $node = $PortableNode\r\n} else {\r\n    $node = (Get-Command node -ErrorAction Stop).Source\r\n}",
  "Portable Runtime Node"
);
write("integrations\\9router\\runtime\\start-runtime.ps1", startRuntime);

console.log("[4/7] Adding encrypted credential migration tool...");
fs.mkdirSync(path.join(appRoot, "tools"), { recursive:true });
fs.writeFileSync(path.join(appRoot, "tools", "credential-tool.cjs"), "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst os = require(\"os\");\nconst crypto = require(\"crypto\");\nconst { spawnSync } = require(\"child_process\");\nconst net = require(\"net\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst MAGIC = Buffer.from(\"UECRED1\\0\", \"ascii\");\nconst HEADER_LEN = MAGIC.length + 16 + 12;\nconst TAG_LEN = 16;\n\nfunction fail(msg, code = 1) {\n  console.error(\"ERROR: \" + msg);\n  process.exit(code);\n}\n\nfunction exists(p) { try { return fs.existsSync(p); } catch { return false; } }\n\nfunction copyIfExists(src, dst, entries, name) {\n  if (!exists(src)) return false;\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });\n  entries.push({ name, included: true });\n  return true;\n}\n\nfunction execChecked(file, args, opts = {}) {\n  const r = spawnSync(file, args, { stdio: \"inherit\", windowsHide: true, ...opts });\n  if (r.error) throw r.error;\n  if (r.status !== 0) throw new Error(`${file} exited ${r.status}`);\n}\n\nfunction promptHidden(label) {\n  return new Promise((resolve, reject) => {\n    process.stdout.write(label);\n    const stdin = process.stdin;\n    if (!stdin.isTTY || typeof stdin.setRawMode !== \"function\") {\n      const readline = require(\"readline\");\n      const rl = readline.createInterface({ input: stdin, output: process.stdout });\n      rl.question(\"\", (answer) => { rl.close(); resolve(answer); });\n      return;\n    }\n\n    stdin.setRawMode(true);\n    stdin.resume();\n    stdin.setEncoding(\"utf8\");\n    let value = \"\";\n\n    function cleanup() {\n      stdin.removeListener(\"data\", onData);\n      try { stdin.setRawMode(false); } catch {}\n      stdin.pause();\n      process.stdout.write(\"\\n\");\n    }\n\n    function onData(chunk) {\n      for (const ch of chunk) {\n        if (ch === \"\\u0003\") {\n          cleanup();\n          reject(new Error(\"Cancelled\"));\n          return;\n        }\n        if (ch === \"\\r\" || ch === \"\\n\") {\n          cleanup();\n          resolve(value);\n          return;\n        }\n        if (ch === \"\\u0008\" || ch === \"\\u007f\") {\n          if (value.length) {\n            value = value.slice(0, -1);\n            process.stdout.write(\"\\b \\b\");\n          }\n          continue;\n        }\n        if (ch >= \" \") {\n          value += ch;\n          process.stdout.write(\"*\");\n        }\n      }\n    }\n\n    stdin.on(\"data\", onData);\n  });\n}\n\nfunction isPortOpen(port, timeout = 350) {\n  return new Promise((resolve) => {\n    const s = new net.Socket();\n    let done = false;\n    const finish = (v) => {\n      if (done) return;\n      done = true;\n      try { s.destroy(); } catch {}\n      resolve(v);\n    };\n    s.setTimeout(timeout);\n    s.once(\"connect\", () => finish(true));\n    s.once(\"timeout\", () => finish(false));\n    s.once(\"error\", () => finish(false));\n    s.connect(port, \"127.0.0.1\");\n  });\n}\n\nasync function assertServicesStopped() {\n  const ports = [20128, 20129, 8080];\n  const open = [];\n  for (const p of ports) if (await isPortOpen(p)) open.push(p);\n  if (open.length) {\n    fail(`Unit Elite services still running on port(s): ${open.join(\", \")}. Run STOP-UNIT-ELITE.cmd first.`, 10);\n  }\n}\n\nasync function encryptFile(input, output, password) {\n  const salt = crypto.randomBytes(16);\n  const iv = crypto.randomBytes(12);\n  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });\n  const cipher = crypto.createCipheriv(\"aes-256-gcm\", key, iv);\n\n  await new Promise((resolve, reject) => {\n    const out = fs.createWriteStream(output, { flags: \"w\" });\n    out.on(\"error\", reject);\n    out.write(Buffer.concat([MAGIC, salt, iv]));\n\n    const inputStream = fs.createReadStream(input);\n    inputStream.on(\"error\", reject);\n    cipher.on(\"error\", reject);\n\n    cipher.on(\"data\", (chunk) => {\n      if (!out.write(chunk)) cipher.pause();\n    });\n    out.on(\"drain\", () => cipher.resume());\n\n    cipher.on(\"end\", () => {\n      try {\n        out.write(cipher.getAuthTag());\n        out.end();\n      } catch (e) {\n        reject(e);\n      }\n    });\n    out.on(\"finish\", resolve);\n\n    inputStream.pipe(cipher);\n  });\n}\n\nasync function decryptFile(input, output, password) {\n  const st = fs.statSync(input);\n  if (st.size <= HEADER_LEN + TAG_LEN) throw new Error(\"Credential bundle is truncated.\");\n\n  const fd = fs.openSync(input, \"r\");\n  const header = Buffer.alloc(HEADER_LEN);\n  fs.readSync(fd, header, 0, HEADER_LEN, 0);\n  const tag = Buffer.alloc(TAG_LEN);\n  fs.readSync(fd, tag, 0, TAG_LEN, st.size - TAG_LEN);\n  fs.closeSync(fd);\n\n  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(\"Invalid .uecred magic/version.\");\n\n  const salt = header.subarray(MAGIC.length, MAGIC.length + 16);\n  const iv = header.subarray(MAGIC.length + 16, HEADER_LEN);\n  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });\n  const decipher = crypto.createDecipheriv(\"aes-256-gcm\", key, iv);\n  decipher.setAuthTag(tag);\n\n  await new Promise((resolve, reject) => {\n    const inputStream = fs.createReadStream(input, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 });\n    const out = fs.createWriteStream(output, { flags: \"w\" });\n    inputStream.on(\"error\", reject);\n    decipher.on(\"error\", reject);\n    out.on(\"error\", reject);\n    out.on(\"finish\", resolve);\n    inputStream.pipe(decipher).pipe(out);\n  });\n}\n\nfunction timestamp() {\n  const d = new Date();\n  const p = (n) => String(n).padStart(2, \"0\");\n  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;\n}\n\nfunction findSourceWhatsAppStore() {\n  const candidates = [\n    path.join(ROOT, \"vendor\", \"whatsapp\", \"store\"),\n    \"D:\\\\OpenCode\\\\whatsapp-mcp-main\\\\whatsapp-bridge\\\\store\"\n  ];\n  return candidates.find(exists) || null;\n}\n\nasync function doExport(outArg) {\n  await assertServicesStopped();\n\n  const password = await promptHidden(\"Credential bundle password: \");\n  if (!password || password.length < 8) fail(\"Password must be at least 8 characters.\", 11);\n  const confirm = await promptHidden(\"Confirm password: \");\n  if (password !== confirm) fail(\"Passwords do not match.\", 12);\n\n  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), \"unitelite-cred-export-\"));\n  const stage = path.join(tmp, \"payload\");\n  fs.mkdirSync(stage, { recursive: true });\n  const entries = [];\n\n  copyIfExists(path.join(process.env.APPDATA || \"\", \"9router\"), path.join(stage, \"9router-data\"), entries, \"9router-data\");\n  copyIfExists(path.join(os.homedir(), \".unit-elite-secrets\"), path.join(stage, \"unit-elite-secrets\"), entries, \"unit-elite-secrets\");\n\n  const waStore = findSourceWhatsAppStore();\n  if (waStore) copyIfExists(waStore, path.join(stage, \"whatsapp-store\"), entries, \"whatsapp-store\");\n\n  copyIfExists(path.join(process.env.APPDATA || \"\", \"GitHub CLI\"), path.join(stage, \"github-cli\"), entries, \"github-cli\");\n  copyIfExists(path.join(os.homedir(), \".gemini\"), path.join(stage, \"gemini-cli\"), entries, \"gemini-cli\");\n\n  const manifest = {\n    format: \"UnitElite-Credentials\",\n    version: 1,\n    created_at: new Date().toISOString(),\n    source_machine: os.hostname(),\n    entries,\n    restore_policy: \"full overwrite after automatic backup\",\n    contains_sensitive_data: true\n  };\n  fs.writeFileSync(path.join(stage, \"credentials-manifest.json\"), JSON.stringify(manifest, null, 2), \"utf8\");\n\n  if (!entries.some(e => e.name === \"9router-data\")) fail(\"9Router data was not found; refusing incomplete export.\", 13);\n  if (!entries.some(e => e.name === \"unit-elite-secrets\")) fail(\"Unit Elite local secrets were not found; refusing incomplete export.\", 14);\n  if (!entries.some(e => e.name === \"whatsapp-store\")) fail(\"WhatsApp store was not found; refusing incomplete export.\", 15);\n\n  const tarPath = path.join(tmp, \"credentials.tar\");\n  execChecked(\"tar.exe\", [\"-cf\", tarPath, \"-C\", stage, \".\"]);\n\n  const output = path.resolve(outArg || path.join(process.cwd(), `UnitElite-Credentials-${timestamp()}.uecred`));\n  await encryptFile(tarPath, output, password);\n\n  const hash = crypto.createHash(\"sha256\").update(fs.readFileSync(output)).digest(\"hex\").toUpperCase();\n  console.log(\"CREDENTIAL_EXPORT_PASS\");\n  console.log(\"FILE=\" + output);\n  console.log(\"SHA256=\" + hash);\n  console.log(\"ENTRIES=\" + entries.map(e => e.name).join(\",\"));\n\n  fs.rmSync(tmp, { recursive: true, force: true });\n}\n\nfunction backupExisting(src, backupRoot, name) {\n  if (!exists(src)) return;\n  const dst = path.join(backupRoot, name);\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });\n}\n\nfunction restoreDir(src, dst) {\n  if (!exists(src)) return;\n  fs.rmSync(dst, { recursive: true, force: true });\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });\n}\n\nasync function doImport(inArg) {\n  if (!inArg) fail(\"Usage: credential-tool.cjs import <UnitElite-Credentials.uecred>\", 20);\n  await assertServicesStopped();\n\n  const input = path.resolve(inArg);\n  if (!exists(input)) fail(\"Credential file not found: \" + input, 21);\n  const password = await promptHidden(\"Credential bundle password: \");\n\n  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), \"unitelite-cred-import-\"));\n  const tarPath = path.join(tmp, \"credentials.tar\");\n  const stage = path.join(tmp, \"payload\");\n  fs.mkdirSync(stage, { recursive: true });\n\n  try {\n    await decryptFile(input, tarPath, password);\n  } catch (e) {\n    fs.rmSync(tmp, { recursive: true, force: true });\n    fail(\"Credential decryption/integrity check failed. Wrong password or damaged bundle.\", 22);\n  }\n\n  execChecked(\"tar.exe\", [\"-xf\", tarPath, \"-C\", stage]);\n\n  const manifestPath = path.join(stage, \"credentials-manifest.json\");\n  if (!exists(manifestPath)) fail(\"Credential manifest missing after decryption.\", 23);\n  const manifest = JSON.parse(fs.readFileSync(manifestPath, \"utf8\"));\n  if (manifest.format !== \"UnitElite-Credentials\" || manifest.version !== 1) fail(\"Unsupported credential bundle version.\", 24);\n\n  const backupRoot = path.join(ROOT, \"credential-backups\", timestamp());\n  fs.mkdirSync(backupRoot, { recursive: true });\n\n  const target9 = path.join(process.env.APPDATA || \"\", \"9router\");\n  const targetSecrets = path.join(os.homedir(), \".unit-elite-secrets\");\n  const targetWa = path.join(ROOT, \"vendor\", \"whatsapp\", \"store\");\n  const targetGh = path.join(process.env.APPDATA || \"\", \"GitHub CLI\");\n  const targetGemini = path.join(os.homedir(), \".gemini\");\n\n  backupExisting(target9, backupRoot, \"9router-data\");\n  backupExisting(targetSecrets, backupRoot, \"unit-elite-secrets\");\n  backupExisting(targetWa, backupRoot, \"whatsapp-store\");\n  backupExisting(targetGh, backupRoot, \"github-cli\");\n  backupExisting(targetGemini, backupRoot, \"gemini-cli\");\n\n  restoreDir(path.join(stage, \"9router-data\"), target9);\n  restoreDir(path.join(stage, \"unit-elite-secrets\"), targetSecrets);\n  restoreDir(path.join(stage, \"whatsapp-store\"), targetWa);\n  restoreDir(path.join(stage, \"github-cli\"), targetGh);\n  restoreDir(path.join(stage, \"gemini-cli\"), targetGemini);\n\n  try {\n    if (exists(targetSecrets)) {\n      spawnSync(\"icacls.exe\", [targetSecrets, \"/inheritance:r\"], { stdio: \"ignore\", windowsHide: true });\n      const user = `${process.env.USERDOMAIN || \"\"}\\\\${process.env.USERNAME || \"\"}`.replace(/^\\\\/, \"\");\n      if (user) spawnSync(\"icacls.exe\", [targetSecrets, \"/grant:r\", `${user}:(OI)(CI)F`], { stdio: \"ignore\", windowsHide: true });\n    }\n  } catch {}\n\n  console.log(\"CREDENTIAL_IMPORT_PASS\");\n  console.log(\"BACKUP=\" + backupRoot);\n  console.log(\"RESTORED=\" + (manifest.entries || []).map(e => e.name).join(\",\"));\n\n  fs.rmSync(tmp, { recursive: true, force: true });\n}\n\n(async () => {\n  if (process.platform !== \"win32\") fail(\"This credential tool is intended for Windows.\", 30);\n  const cmd = (process.argv[2] || \"\").toLowerCase();\n  if (cmd === \"export\") return doExport(process.argv[3]);\n  if (cmd === \"import\") return doImport(process.argv[3]);\n  fail(\"Usage: credential-tool.cjs export [output.uecred] | import <input.uecred>\", 31);\n})().catch((e) => fail(e && e.message ? e.message : String(e), 99));\n", "utf8");

const exportCmd = [
  "@echo off",
  "setlocal",
  "\"%~dp0vendor\\node\\node.exe\" \"%~dp0tools\\credential-tool.cjs\" export \"%~dp0..\\UnitElite-Credentials.uecred\"",
  "exit /b %errorlevel%",
  ""
].join("\r\n");
const importCmd = [
  "@echo off",
  "setlocal",
  "if \"%~1\"==\"\" (",
  "  echo Usage: IMPORT-CREDENTIALS.cmd ^<UnitElite-Credentials.uecred^>",
  "  exit /b 2",
  ")",
  "\"%~dp0vendor\\node\\node.exe\" \"%~dp0tools\\credential-tool.cjs\" import \"%~1\"",
  "exit /b %errorlevel%",
  ""
].join("\r\n");
fs.writeFileSync(path.join(appRoot, "EXPORT-CREDENTIALS.cmd"), exportCmd, "ascii");
fs.writeFileSync(path.join(appRoot, "IMPORT-CREDENTIALS.cmd"), importCmd, "ascii");

const readme = `UNIT ELITE PORTABLE - QUICK START

SOURCE LAPTOP:
1. Run STOP-UNIT-ELITE.cmd before credential export.
2. Portable builder produces UnitElite-Portable.zip and UnitElite-Credentials.uecred.

OFFICE LAPTOP:
1. Extract UnitElite-Portable.zip to any writable folder, recommended:
   %LOCALAPPDATA%\\UnitElite
2. Put UnitElite-Credentials.uecred anywhere convenient.
3. Run:
   IMPORT-CREDENTIALS.cmd <path-to-UnitElite-Credentials.uecred>
4. Enter the credential-bundle password.
5. Run:
   START-UNIT-ELITE.cmd
6. Verify:
   STATUS-UNIT-ELITE.cmd

EXPECTED:
ROUTER=READY
RUNTIME=READY
WHATSAPP=READY_OWNED
OPENCODE=RUNNING_OWNED

SECURITY:
- .uecred is encrypted with AES-256-GCM and a password-derived key.
- Do not share the .uecred file or its password.
- WhatsApp store/session is restored only from the encrypted credential bundle.
`;
fs.writeFileSync(path.join(appRoot, "PORTABLE-README.txt"), readme.replace(/\n/g, "\r\n"), "ascii");

console.log("[5/7] Validating generated portable scripts...");
const validator = path.join(tempRoot, "validate-ps.ps1");
fs.writeFileSync(validator, [
  "param([Parameter(Mandatory=$true)][string]$Target)",
  "$tokens=$null",
  "$errors=$null",
  "[void][System.Management.Automation.Language.Parser]::ParseFile($Target,[ref]$tokens,[ref]$errors)",
  "if($errors.Count -gt 0){",
  "  Write-Host ('SYNTAX_FAIL '+$Target)",
  "  $errors | ForEach-Object { Write-Host $_.Message }",
  "  exit 1",
  "}",
  "Write-Host ('SYNTAX_PASS '+$Target)",
  "exit 0",
  ""
].join("\r\n"), "utf8");

const psTargets = [
  path.join(appRoot, "scripts", "d7-production", "common.ps1"),
  path.join(appRoot, "scripts", "d7-production", "start.ps1"),
  path.join(appRoot, "scripts", "d7-production", "status.ps1"),
  path.join(appRoot, "scripts", "d7-production", "stop.ps1"),
  path.join(appRoot, "scripts", "d7-production", "recover.ps1"),
  path.join(appRoot, "integrations", "9router", "stop-9router.ps1"),
  path.join(appRoot, "integrations", "9router", "runtime", "start-runtime.ps1"),
  path.join(appRoot, "integrations", "9router", "runtime", "stop-runtime.ps1")
];

let r;
for (const target of psTargets) {
  r = spawnSync(
    "powershell.exe",
    ["-NoProfile","-ExecutionPolicy","Bypass","-File",validator,"-Target",target],
    { stdio:"inherit", windowsHide:true }
  );
  if (r.error || r.status !== 0) {
    fail("Portable PowerShell syntax validation failed: " + target, 30);
  }
}

// Portability guard: production control-plane files must not retain the old
// source root or the old absolute WhatsApp path after refactoring.
const portabilityScanTargets = [
  path.join(appRoot, "scripts", "d7-production", "common.ps1"),
  path.join(appRoot, "scripts", "d7-production", "start.ps1"),
  path.join(appRoot, "scripts", "d7-production", "status.ps1"),
  path.join(appRoot, "scripts", "d7-production", "stop.ps1"),
  path.join(appRoot, "scripts", "d7-production", "recover.ps1"),
  path.join(appRoot, "integrations", "9router", "start-9router.cmd"),
  path.join(appRoot, "integrations", "9router", "stop-9router.ps1"),
  path.join(appRoot, "integrations", "9router", "runtime", "start-runtime.ps1"),
  path.join(appRoot, "integrations", "9router", "runtime", "stop-runtime.ps1"),
  path.join(appRoot, "opencode.json")
];

const forbiddenPortableRefs = [
  sourceRoot.toLowerCase(),
  "d:\\opencode\\whatsapp-mcp-main\\whatsapp-bridge"
];

for (const f of portabilityScanTargets) {
  const body = fs.readFileSync(f, "utf8").toLowerCase();
  for (const forbidden of forbiddenPortableRefs) {
    if (forbidden && body.includes(forbidden)) {
      fail("PORTABILITY_GUARD_FAIL absolute source path remains in: " + f, 32);
    }
  }
}
console.log("PORTABILITY_GUARD_PASS");

const bundledNode = path.join(vendor, "node", "node.exe");
for (const js of [
  path.join(appRoot, "tools", "credential-tool.cjs"),
  path.join(appRoot, "integrations", "9router", "runtime", "runtime-gateway.cjs")
]) {
  r = spawnSync(bundledNode, ["--check", js], { stdio:"inherit", windowsHide:true });
  if (r.error || r.status !== 0) fail("Node syntax validation failed: " + js, 31);
}

const manifest = {
  format: "UnitElite-Portable",
  version: 1,
  built_at: new Date().toISOString(),
  source_root: sourceRoot,
  portable_root_name: "UnitElite",
  bundled: {
    node: path.join(vendor, "node", "node.exe"),
    nineRouter: path.join(vendor, "9router", "cli.js"),
    openCode: path.join(vendor, "opencode", "OpenCode.exe"),
    whatsapp: path.join(vendor, "whatsapp", "whatsapp-bridge.exe")
  }
};
fs.writeFileSync(path.join(appRoot, "portable-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

console.log("[6/7] Creating encrypted credential file...");
const credOut = path.join(outDir, "UnitElite-Credentials.uecred");
r = spawnSync(
  bundledNode,
  [path.join(appRoot, "tools", "credential-tool.cjs"), "export", credOut],
  { stdio:"inherit", windowsHide:false, cwd:appRoot }
);
if (r.error || r.status !== 0) fail("Credential export failed. Ensure Unit Elite is STOPPED.", 40);

console.log("[7/7] Creating portable ZIP...");
const zipOut = path.join(outDir, "UnitElite-Portable.zip");
try { fs.rmSync(zipOut, { force:true }); } catch {}
r = spawnSync("tar.exe", ["-a","-cf",zipOut,"-C",stageParent,"UnitElite"], { stdio:"inherit", windowsHide:true });
if (r.error || r.status !== 0) fail("Portable ZIP creation failed.", 41);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

console.log("");
console.log("PORTABLE_BUILD_PASS");
console.log("FILE1=" + zipOut);
console.log("SHA256_FILE1=" + sha256(zipOut));
console.log("FILE2=" + credOut);
console.log("SHA256_FILE2=" + sha256(credOut));
console.log("NEXT=Copy only these two files to the office laptop.");

try { fs.rmSync(tempRoot, { recursive:true, force:true }); } catch {}

#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const {pathToFileURL} = require("url");

function readStoredZipEntries(buf) {
  const entries = new Map();
  let off = 0;

  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const compressedSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buf.length) throw new Error("ZIP_LOCAL_ENTRY_TRUNCATED");
    if (method !== 0) throw new Error("ZIP_METHOD_UNEXPECTED_" + method);

    const name = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    entries.set(name, buf.slice(dataStart, dataEnd));
    off = dataEnd;
  }

  return entries;
}

(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const core = path.join(root, ".opencode", "tools", "lib", "communication_v2_core.js");
  const bulk = path.join(root, ".opencode", "tools", "whatsapp_bulk_v2.js");
  const state = path.join(root, "integrations", "whatsapp-service", "transport-state.json");
  const common = path.join(root, "scripts", "d7-production", "common.ps1");
  const start = path.join(root, "scripts", "d7-production", "start.ps1");

  let bad = 0;
  function check(name, actual, expected=true) {
    const pass = actual === expected;
    console.log(name + "=" + (pass ? "PASS" : "FAIL"));
    if (!pass) bad++;
  }

  for (const p of [core, bulk]) {
    const r = cp.spawnSync(process.execPath, ["--check", p], {encoding:"utf8"});
    check("NODE_SYNTAX_" + path.basename(p), r.status === 0);
    if (r.status !== 0) console.log(r.stderr || r.stdout);
  }

  const psValidator = [
    "$files=@(",
    "'" + common.replace(/'/g,"''") + "',",
    "'" + start.replace(/'/g,"''") + "'",
    ")",
    "$bad=0",
    "foreach($f in $files){",
    " $tokens=$null;$errors=$null;",
    " [void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$tokens,[ref]$errors);",
    " if($errors.Count -gt 0){Write-Host ('PS_SYNTAX_'+[IO.Path]::GetFileName($f)+'=FAIL');$errors|%{Write-Host $_.Message};$bad++}",
    " else{Write-Host ('PS_SYNTAX_'+[IO.Path]::GetFileName($f)+'=PASS')}",
    "}",
    "if($bad -gt 0){exit 1}"
  ].join("\r\n");

  const pr = cp.spawnSync("powershell.exe", ["-NoProfile","-ExecutionPolicy","Bypass","-Command",psValidator], {encoding:"utf8"});
  process.stdout.write(pr.stdout || "");
  process.stderr.write(pr.stderr || "");
  if (pr.status !== 0) bad++;

  const stateObj = JSON.parse(fs.readFileSync(state,"utf8"));
  check("TRANSPORT_DEFAULT_SUSPENDED", stateObj.mode === "SUSPENDED");

  const coreText = fs.readFileSync(core,"utf8");
  const bulkText = fs.readFileSync(bulk,"utf8");
  const commonText = fs.readFileSync(common,"utf8");
  const startText = fs.readFileSync(start,"utf8");

  check("CORE_XLSX_EXPORT_PRESENT", coreText.includes("export function exportFallbackExcel"));
  check("CORE_SHARED_STRINGS_PRESENT", coreText.includes('name:"xl/sharedStrings.xml"'));
  check("CORE_BRIDGE_STATUS_PRESENT", coreText.includes("export async function bridgeOperationalStatus"));
  check("BULK_EXPORT_ACTION_PRESENT", bulkText.includes('action === "export_excel"'));
  check("BULK_WAIT_ACTION_PRESENT", bulkText.includes('action === "wait"'));
  check("BULK_CANCEL_ACTION_PRESENT", bulkText.includes('action === "cancel"'));
  check("BULK_RESUME_ACTION_PRESENT", bulkText.includes('action === "resume"'));
  check("NO_AUTO_SEND_WAIT", bulkText.includes("auto_send:false"));
  check("CONTROLLER_SUSPEND_GATE", commonText.includes("WHATSAPP_SUSPENDED reason=bridge_under_repair"));
  check("START_ALLOWS_SUSPENDED", startText.includes("$s.WhatsApp -eq 'SUSPENDED'"));

  const mod = await import(pathToFileURL(core).href + "?accept=" + Date.now());
  const bytes = mod.buildFallbackWorkbookBytes({
    package_id:"WA-BULK-ACCEPTANCE",
    status:"BRIDGE_UNAVAILABLE",
    transport_status:"SUSPENDED",
    requested_count:3,
    duplicates_removed:0,
    message:"TEST FALLBACK",
    recipients:[
      {input:"A",status:"RESOLVED",phone:"628111111111",display_name:"TEST A",institution:"Instansi A",send_status:"PENDING_FALLBACK"},
      {input:"B",status:"RESOLVED",phone:"628222222222",display_name:"TEST B",institution:"Instansi B",send_status:"PENDING_FALLBACK"},
      {input:"+628333333333",status:"RESOLVED",phone:"628333333333",send_status:"PENDING_FALLBACK"}
    ]
  },"acceptance");

  check("XLSX_ZIP_MAGIC", Buffer.isBuffer(bytes) && bytes.slice(0,4).toString("hex") === "504b0304");
  check("XLSX_NONTRIVIAL_SIZE", bytes.length > 5000);

  const entries = readStoredZipEntries(bytes);
  check("XLSX_HAS_SHEET1", entries.has("xl/worksheets/sheet1.xml"));
  check("XLSX_HAS_SHEET2", entries.has("xl/worksheets/sheet2.xml"));
  check("XLSX_HAS_SHARED_STRINGS", entries.has("xl/sharedStrings.xml"));
  check("XLSX_HAS_HYPERLINK_RELS", entries.has("xl/worksheets/_rels/sheet1.xml.rels"));

  const sheet1 = (entries.get("xl/worksheets/sheet1.xml") || Buffer.alloc(0)).toString("utf8");
  const shared = (entries.get("xl/sharedStrings.xml") || Buffer.alloc(0)).toString("utf8");
  const rels = (entries.get("xl/worksheets/_rels/sheet1.xml.rels") || Buffer.alloc(0)).toString("utf8");
  const contentTypes = (entries.get("[Content_Types].xml") || Buffer.alloc(0)).toString("utf8");
  const workbookRels = (entries.get("xl/_rels/workbook.xml.rels") || Buffer.alloc(0)).toString("utf8");

  check("XLSX_DIMENSION_CORRECT", sheet1.includes('<dimension ref="A1:H4"/>'));
  const autoFilterOrderPos = sheet1.indexOf("<autoFilter");
  const hyperlinksOrderPos = sheet1.indexOf("<hyperlinks>");
  check("XLSX_SCHEMA_ORDER_AUTOFILTER_BEFORE_HYPERLINKS", autoFilterOrderPos >= 0 && hyperlinksOrderPos >= 0 && autoFilterOrderPos < hyperlinksOrderPos);
  check("XLSX_PHONE_CELL_SHARED_STRING", sheet1.includes('r="D2" t="s" s="2"'));
  check("XLSX_PHONE_NOT_INLINE_NUMERIC", !sheet1.includes("628111111111"));
  check("XLSX_NAME_PRESERVED", shared.includes("TEST A"));
  check("XLSX_INSTITUTION_PRESERVED", shared.includes("Instansi A"));
  check("XLSX_PHONE_TEXT_PRESERVED", shared.includes("628111111111"));
  check("XLSX_MESSAGE_PRESERVED", shared.includes("TEST FALLBACK"));
  check("XLSX_MANUAL_STATUS_PRESERVED", shared.includes("READY_MANUAL"));
  check("XLSX_RAW_PHONE_NOT_USED_AS_NAME", shared.includes("(nama tidak tersedia)"));
  check("XLSX_MISSING_INSTITUTION_EXPLICIT", shared.includes("(instansi tidak tersedia)"));
  check("XLSX_WAME_LINK_PRESENT", rels.includes("https://wa.me/628111111111?text=TEST%20FALLBACK"));
  const expectedWaUrl = "https://wa.me/628111111111?text=TEST%20FALLBACK";
  check("XLSX_VISIBLE_FULL_WAME_URL", shared.includes(expectedWaUrl));
  check("XLSX_CLICKABLE_WAME_LINK", rels.includes(expectedWaUrl));
  check("XLSX_VISIBLE_URL_MATCHES_HYPERLINK_TARGET", shared.includes(expectedWaUrl) && rels.includes(expectedWaUrl));
  check("XLSX_VISIBLE_URL_HEADER_PRESENT", shared.includes("URL Lengkap"));
  check("XLSX_VISIBLE_URL_CELL_SHARED_STRING", sheet1.includes('r="G2" t="s" s="3"'));
  check("XLSX_STATUS_MOVED_TO_H", sheet1.includes('r="H2" t="s" s="2"'));
  check("XLSX_CONTENT_TYPE_SHARED_STRINGS", contentTypes.includes("/xl/sharedStrings.xml"));
  check("XLSX_WORKBOOK_REL_SHARED_STRINGS", workbookRels.includes("sharedStrings.xml"));

  if (bad) {
    console.log("WA_EXCEL_FALLBACK_V2_ACCEPTANCE_FAIL");
    process.exit(1);
  }

  console.log("WA_EXCEL_FALLBACK_V2_STATIC_ACCEPTANCE_PASS");
})().catch(e => {
  console.error(e);
  process.exit(1);
});

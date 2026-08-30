import path from "node:path";
import { ensureDependencies, getTask, sanitizeFilename, sha256File } from "./runtime.js";
import { registerOutput } from "./task.js";
import { validateArtifactFile } from "./validate.js";
import { writeZipFile } from "./zip.js";

function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function colLetter(n) { let s=""; while(n>0){n--; s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26);} return s; }
function safeSheetName(name, fallback) {
  let s = String(name || fallback).replace(/[\\\/\?\*\[\]:]/g, "-").slice(0,31).trim();
  return s || fallback;
}
function cellXml(ref, value, style = 0) {
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}" t="inlineStr"><is><t></t></is></c>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}
function sheetXml(spec, headers, rows, note) {
  const boldSet = new Set((spec.bold_rows || spec.boldRows || []).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0));
  const colCount = Math.max(headers.length, ...rows.map(r => Array.isArray(r) ? r.length : 1), 1);
  const allRows = [];
  let rowIndex = 1;
  if (headers.length) {
    allRows.push(`<row r="${rowIndex}" ht="24" customHeight="1">${headers.map((v,i)=>cellXml(`${colLetter(i+1)}${rowIndex}`,v,1)).join("")}</row>`);
    rowIndex++;
  }
  let dataRowNo = 1;
  for (const r0 of rows) {
    const r = Array.isArray(r0) ? r0 : [r0];
    const rowStyle = boldSet.has(dataRowNo) ? 3 : 0;
    allRows.push(`<row r="${rowIndex}">${r.map((v,i)=>cellXml(`${colLetter(i+1)}${rowIndex}`,v,rowStyle)).join("")}</row>`);
    rowIndex++; dataRowNo++;
  }
  if (note) {
    rowIndex++;
    allRows.push(`<row r="${rowIndex}">${cellXml(`A${rowIndex}`, note, 2)}</row>`);
  }
  const dims = `A1:${colLetter(colCount)}${Math.max(1,rowIndex)}`;
  const cols = Array.from({length:colCount},(_,i)=>`<col min="${i+1}" max="${i+1}" width="22" customWidth="1"/>`).join("");
  const freeze = headers.length ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const autofilter = headers.length ? `<autoFilter ref="A1:${colLetter(colCount)}${Math.max(1, rows.length+1)}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dims}"/>${freeze}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${allRows.join("")}</sheetData>${autofilter}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>`;
}

export async function generateXlsx(root, { taskId, filename, workbook = {} }) {
  await ensureDependencies(root);
  const { taskDir } = await getTask(root, taskId);
  const sheets = Array.isArray(workbook.sheets) && workbook.sheets.length ? workbook.sheets : [{name:"Sheet1",headers:["Data"],rows:[]}];
  const entries = new Map();
  const now = new Date().toISOString();
  const overrides = [];
  const sheetTags = [];
  const relTags = [];

  sheets.forEach((spec, idx) => {
    const n = idx + 1;
    const name = safeSheetName(spec.name, `Sheet${n}`);
    const headers = Array.isArray(spec.headers) ? spec.headers : [];
    const rows = Array.isArray(spec.rows) ? spec.rows : [];
    entries.set(`xl/worksheets/sheet${n}.xml`, {name:`xl/worksheets/sheet${n}.xml`, data:Buffer.from(sheetXml(spec,headers,rows,spec.note||""),"utf8")});
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    sheetTags.push(`<sheet name="${esc(name)}" sheetId="${n}" r:id="rId${n}"/>`);
    relTags.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
  });
  const styleRid = sheets.length + 1;
  relTags.push(`<Relationship Id="rId${styleRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides.join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${sheetTags.join("")}</sheets><calcPr calcId="191029"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags.join("")}</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font><font><i/><color rgb="FF555555"/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Unit Elite - Dinas Pendidikan Provinsi Jawa Timur</dc:creator><cp:lastModifiedBy>Unit Elite</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Unit Elite Embedded Engine</Application></Properties>`;
  const add=(name,data)=>entries.set(name,{name,data:Buffer.from(data,"utf8")});
  add("[Content_Types].xml",contentTypes); add("_rels/.rels",rootRels); add("xl/workbook.xml",workbookXml); add("xl/_rels/workbook.xml.rels",workbookRels); add("xl/styles.xml",styles); add("docProps/core.xml",core); add("docProps/app.xml",app);

  const safe = sanitizeFilename(filename || `Matriks-${taskId}.xlsx`);
  const finalName = safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`;
  const outPath = path.join(taskDir, "output", finalName);
  await writeZipFile(outPath, entries);
  const validation = await validateArtifactFile(outPath);
  if (!validation.valid) throw new Error(`Generated XLSX failed validation: ${validation.reason}`);
  const rel = path.relative(root, outPath).replaceAll(path.sep, "/");
  await registerOutput(root, taskId, { type:"XLSX", path:rel, validation:"PASS", sha256:await sha256File(outPath) });
  return { path: rel, sheet_count: sheets.length, validation, engine:"embedded-no-spawn" };
}

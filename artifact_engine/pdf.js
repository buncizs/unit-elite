import fsp from "node:fs/promises";
import path from "node:path";
import { ensureDependencies, ensureDir } from "./runtime.js";

function latin1Safe(s) {
  return String(s ?? "")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}
function pdfEscape(s) { return latin1Safe(s).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)"); }
function wrap(text, width=92) {
  const out=[];
  for (const para of latin1Safe(text).split(/\r?\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    const words=para.split(/\s+/); let line="";
    for (const w of words) {
      const next=line?`${line} ${w}`:w;
      if (next.length<=width) line=next; else { if(line) out.push(line); line=w; }
    }
    if(line) out.push(line);
  }
  return out;
}
function makePdf(title, sections, footer) {
  const lines=[];
  lines.push({t:title,b:true,s:16,g:22}); lines.push({t:"",s:10,g:10});
  for (const sec of sections) {
    if(sec.heading) for(const l of wrap(sec.heading,82)) lines.push({t:l,b:true,s:11.5,g:16});
    for(const l of wrap(sec.body||"",94)) lines.push({t:l,b:false,s:10.5,g:14});
    lines.push({t:"",s:10,g:8});
  }
  const pages=[]; let cur=[]; let used=0; const max=735;
  for(const line of lines){ const gap=line.g||14; if(used+gap>max && cur.length){pages.push(cur);cur=[];used=0;}cur.push(line);used+=gap; }
  if(cur.length||!pages.length) pages.push(cur);

  const objs=new Map();
  const pageRefs=[];
  const fontRegular=3, fontBold=4;
  let next=5;
  for(const pageLines of pages){
    const pageObj=next++, contentObj=next++; pageRefs.push(pageObj);
    let y=790; const ops=["BT"];
    for(const line of pageLines){ const size=line.s||10.5; const font=line.b?"F2":"F1"; ops.push(`/${font} ${size} Tf`); ops.push(`1 0 0 1 54 ${y.toFixed(2)} Tm`); ops.push(`(${pdfEscape(line.t)}) Tj`); y-=line.g||14; }
    ops.push("ET");
    // footer
    ops.push("BT /F1 8 Tf 1 0 0 1 54 24 Tm"); ops.push(`(${pdfEscape(footer)}) Tj ET`);
    const stream=Buffer.from(ops.join("\n"),"latin1");
    objs.set(contentObj, Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,`ascii`),stream,Buffer.from("\nendstream","ascii")]));
    objs.set(pageObj, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObj} 0 R >>`,`ascii`));
  }
  objs.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>","ascii"));
  objs.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map(n=>`${n} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`,`ascii`));
  objs.set(fontRegular, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>","ascii"));
  objs.set(fontBold, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>","ascii"));

  const maxObj=Math.max(...objs.keys()); const parts=[Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n","binary")]; const offsets=new Array(maxObj+1).fill(0); let pos=parts[0].length;
  for(let n=1;n<=maxObj;n++){ offsets[n]=pos; const body=objs.get(n)||Buffer.from("<<>>","ascii"); const a=Buffer.from(`${n} 0 obj\n`,`ascii`), b=Buffer.from("\nendobj\n","ascii"); parts.push(a,body,b); pos+=a.length+body.length+b.length; }
  const xrefPos=pos; let xref=`xref\n0 ${maxObj+1}\n0000000000 65535 f \n`;
  for(let n=1;n<=maxObj;n++) xref+=`${String(offsets[n]).padStart(10,"0")} 00000 n \n`;
  xref+=`trailer\n<< /Size ${maxObj+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  parts.push(Buffer.from(xref,"ascii"));
  return Buffer.concat(parts);
}

export async function createSimplePdf(root, { outputPath, title, sections = [], footer = "Unit Elite - Dinas Pendidikan Provinsi Jawa Timur" }) {
  await ensureDependencies(root);
  await ensureDir(path.dirname(outputPath));
  await fsp.writeFile(outputPath, makePdf(title, sections, footer));
  return outputPath;
}

export async function createExecutiveSummaryPdf(root, { outputPath, task, executiveSummary, validations, closedAtLocal, timezone }) {
  const inputList = (task.inputs || []).map((x) => `- ${x.filename}`).join("\n") || "- Tidak ada input terdaftar";
  const outputList = (task.outputs || []).map((x) => `- ${path.basename(x.path)} [${x.type}]`).join("\n") || "- Tidak ada output terdaftar";
  const validationList = (validations || []).map((v) => `- ${path.basename(v.path)}: ${v.valid ? "PASS" : "FAIL"} (${v.reason})`).join("\n") || "- Belum ada validasi";
  const communicationList = (task.communications?.packages || []).map((x) => `- ${x.package_id}: ${x.title || "Delivery"} [${x.channel || "-"}] status=${x.state || "-"}`).join("\n") || "- Tidak ada Delivery Package";
  const sections = [
    { heading: "1. Identitas Task", body: `TASK-ID: ${task.task_id}\nJudul: ${task.title}\nMulai: ${task.started_at_local} (${task.timezone})\nSelesai: ${closedAtLocal} (${timezone})` },
    { heading: "2. Disposisi", body: task.disposition || "-" },
    { heading: "3. Input", body: inputList },
    { heading: "4. Ringkasan Eksekutif", body: executiveSummary || "Tidak ada ringkasan eksekutif yang diberikan." },
    { heading: "5. Output", body: outputList },
    { heading: "6. Quality Control", body: `Status QC: ${task.qc?.status || "PENDING"}\nLaporan QC terakhir: ${task.qc?.latest_report || "-"}` },
    { heading: "7. Validasi Artifact", body: validationList },
    { heading: "8. Komunikasi/Delivery", body: communicationList },
    { heading: "9. Catatan Audit", body: "Penutupan task hanya dilakukan setelah QC diterima dan seluruh artifact yang terdaftar lolos pemeriksaan struktur file. Delivery Package dan log komunikasi ikut diarsipkan bersama task. Penghapusan dari inbox dilakukan hanya terhadap sumber yang checksum-nya tidak berubah sejak task dimulai." },
  ];
  return createSimplePdf(root, { outputPath, title: `EXECUTIVE SUMMARY - ${task.title}`, sections });
}

export async function generatePdf(root, { taskId, filename, title, sections = [] }) {
  const { getTask, sanitizeFilename, sha256File } = await import("./runtime.js");
  const { registerOutput } = await import("./task.js");
  const { validateArtifactFile } = await import("./validate.js");
  const { taskDir } = await getTask(root, taskId);
  const safe = sanitizeFilename(filename || `Dokumen-${taskId}.pdf`);
  const finalName = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
  const outPath = path.join(taskDir, "output", finalName);
  await createSimplePdf(root, { outputPath: outPath, title, sections });
  const validation = await validateArtifactFile(outPath);
  if (!validation.valid) throw new Error(`Generated PDF failed validation: ${validation.reason}`);
  const rel = path.relative(root, outPath).replaceAll(path.sep, "/");
  await registerOutput(root, taskId, { type: "PDF", path: rel, validation: "PASS", sha256: await sha256File(outPath) });
  return { path: rel, validation, engine: "embedded-no-spawn" };
}

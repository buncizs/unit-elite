import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function norm(s) {
  return String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function phone(s) {
  let d = String(s ?? "").replace(/\D/g, "");
  if (d.startsWith("08")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^628\d{7,12}$/.test(d) ? d : "";
}
function parseDelimited(text, sep = ";") {
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(q && text[i+1]==='"'){cell+='"';i++;} else q=!q;
    } else if(c===sep && !q){row.push(cell);cell="";}
    else if((c==='\n' || c==='\r') && !q){
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(cell); cell="";
      if(row.some(x=>x!=="")) rows.push(row);
      row=[];
    } else cell+=c;
  }
  row.push(cell); if(row.some(x=>x!=="")) rows.push(row);
  return rows;
}

export default tool({
  description: "Mencari kontak internal/pimpinan dari registry lokal. Mengembalikan exact/single match atau AMBIGUOUS/NOT_FOUND. Tidak mencari di web dan tidak menebak nomor.",
  args: {
    query: tool.schema.string().describe("Nama, jabatan, atau unit; contoh: Kepala Dinas"),
  },
  async execute(args, context) {
    const root = path.resolve(context.directory || context.worktree || process.cwd());
    const csv = path.join(root, "knowledge/contact-registry/internal/internal_contacts.csv");
    if(!fs.existsSync(csv)) return JSON.stringify({status:"REGISTRY_NOT_FOUND", path:path.relative(root,csv)}, null, 2);
    const rows=parseDelimited(await fsp.readFile(csv,"utf8"));
    if(rows.length<2) return JSON.stringify({status:"EMPTY_REGISTRY", path:path.relative(root,csv)}, null, 2);
    const headers=rows[0].map(norm);
    const idx=(name)=>headers.indexOf(norm(name));
    const q=norm(args.query);
    const data=rows.slice(1).map(r=>({
      nama:r[idx("Nama")]||"",
      jabatan:r[idx("Jabatan")]||"",
      unit:r[idx("Unit")]||"",
      no_hp:r[idx("Nomor HP")]||"",
      status:r[idx("Status")]||"",
      catatan:r[idx("Catatan")]||"",
    })).filter(x=>norm(x.status||"ACTIVE")!=="INACTIVE");
    const scored=data.map(x=>{
      const fields=[norm(x.nama),norm(x.jabatan),norm(x.unit)];
      let score=0;
      if(fields.some(f=>f===q)) score=100;
      else if(fields.some(f=>f.includes(q) || q.includes(f))) score=70;
      else {
        const tokens=q.split(" ").filter(Boolean);
        const hay=fields.join(" ");
        score=tokens.length ? Math.round(tokens.filter(t=>hay.includes(t)).length/tokens.length*50) : 0;
      }
      return {...x, score, phone_normalized:phone(x.no_hp)};
    }).filter(x=>x.score>=50).sort((a,b)=>b.score-a.score);
    if(!scored.length) return JSON.stringify({status:"NOT_FOUND", query:args.query}, null, 2);
    const top=scored[0].score;
    const candidates=scored.filter(x=>x.score===top);
    if(candidates.length!==1) return JSON.stringify({status:"AMBIGUOUS", query:args.query, candidates:candidates.map(x=>({nama:x.nama,jabatan:x.jabatan,unit:x.unit,phone_normalized:x.phone_normalized,score:x.score}))}, null, 2);
    const x=candidates[0];
    return JSON.stringify({status:"FOUND", query:args.query, nama:x.nama,jabatan:x.jabatan,unit:x.unit,no_hp_source:x.no_hp,phone_normalized:x.phone_normalized,wa_link:x.phone_normalized?`https://wa.me/${x.phone_normalized}`:"",contact_status:x.phone_normalized?"CONTACT_AVAILABLE":"NO_USABLE_CONTACT",score:x.score}, null, 2);
  }
});

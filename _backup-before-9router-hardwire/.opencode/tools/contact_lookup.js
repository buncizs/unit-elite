import { tool } from "@opencode-ai/plugin";
import fs from "node:fs/promises";
import path from "node:path";

function parseCsv(text, delimiter = ";") {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoted) {
      if (ch==='"' && text[i+1]==='"') { field+='"'; i++; }
      else if (ch==='"') quoted=false;
      else field+=ch;
    } else {
      if (ch==='"') quoted=true;
      else if (ch===delimiter) { row.push(field); field=""; }
      else if (ch==='\n') { row.push(field.replace(/\r$/,"")); rows.push(row); row=[]; field=""; }
      else field+=ch;
    }
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/,"")); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim()!==""));
}
function normText(v) {
  return String(v||"").toUpperCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\bSMK\s+NEGERI\b/g,"SMKN").replace(/\bSMK\s+SWASTA\b/g,"SMKS")
    .replace(/\bKABUPATEN\b/g,"KAB").replace(/\bKAB\.\b/g,"KAB")
    .replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function compact(v) { return normText(v).replaceAll(" ",""); }
function phone(v) {
  const raw=String(v||"").trim();
  if (!raw || /^(NODATA|NO DATA|DATA TIDAK ADA|NULL|N\/A|-|0)$/i.test(raw)) return {valid:false,raw};
  let d=raw.replace(/\D/g,"");
  if (d.startsWith("0")) d="62"+d.slice(1);
  else if (d.startsWith("8")) d="62"+d;
  if (!/^628\d{7,12}$/.test(d)) return {valid:false,raw,normalized:d||""};
  return {valid:true,raw,normalized:d,wa_link:`https://wa.me/${d}`};
}
async function loadRegistry(root) {
  const p=path.join(root,"knowledge","contact-registry","nomor_ks.csv");
  const text=(await fs.readFile(p,"utf8")).replace(/^\uFEFF/,"");
  const parsed=parseCsv(text,";");
  if (!parsed.length) throw new Error("Contact registry kosong");
  const headers=parsed[0].map(x=>x.trim());
  const rows=parsed.slice(1).map((r,idx)=>{
    const o={}; headers.forEach((h,i)=>o[h]=String(r[i]??"").trim());
    o.__source_order=idx+2; return o;
  });
  const groups=new Map();
  for (const r of rows) {
    const key=r["NPSN"]||`NAME:${normText(r["Nama SMK"])}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  return {path:p,rows,groups};
}
function resolveGroup(reg,q) {
  const npsn=String(q.npsn||"").trim();
  const school=String(q.school_name||q.nama_sekolah||"").trim();
  const district=String(q.district||q.kab_kota||"").trim();
  let candidates=[];
  if (npsn) {
    const rs=reg.groups.get(npsn); if (rs) candidates=[rs];
  } else if (school) {
    const qn=normText(school), qc=compact(school), qd=normText(district);
    for (const rs of reg.groups.values()) {
      const name=rs[0]["Nama SMK"]||"", kab=rs[0]["Kab/Kota"]||"";
      const exact=normText(name)===qn || compact(name)===qc;
      const loose=!exact && (compact(name).includes(qc) || qc.includes(compact(name)));
      const districtOk=!qd || normText(kab)===qd || compact(kab).includes(compact(district)) || compact(district).includes(compact(kab));
      if ((exact||loose) && districtOk) candidates.push(rs);
    }
    const exacts=candidates.filter(rs=>normText(rs[0]["Nama SMK"])===qn || compact(rs[0]["Nama SMK"])===qc);
    if (exacts.length) candidates=exacts;
  }
  if (!candidates.length) return {status:"SCHOOL_NOT_FOUND",query:q};
  if (candidates.length>1) return {status:"AMBIGUOUS",query:q,candidates:candidates.slice(0,10).map(rs=>({npsn:rs[0]["NPSN"],school_name:rs[0]["Nama SMK"],district:rs[0]["Kab/Kota"]}))};
  const rs=candidates[0], base=rs[0];
  if (npsn && school) {
    const a=compact(school), b=compact(base["Nama SMK"]);
    if (!(a===b || a.includes(b) || b.includes(a))) return {status:"IDENTITY_CONFLICT",query:q,registry:{npsn:base["NPSN"],school_name:base["Nama SMK"],district:base["Kab/Kota"]}};
  }
  const head=rs.find(r=>normText(r["Tugas Tambahan"])==="KEPALA SEKOLAH" && phone(r["No HP"]).valid);
  let selected=head || rs.find(r=>phone(r["No HP"]).valid);
  if (!selected) return {status:"SEKOLAH TIDAK UPDATE KONTAK",npsn:base["NPSN"],school_name:base["Nama SMK"],district:base["Kab/Kota"],contact_count:rs.length,whatsapp_status:"NOT_AVAILABLE"};
  const p=phone(selected["No HP"]);
  const fallback=!head;
  return {
    status:fallback?"FALLBACK_MANAGEMENT":"KEPALA_SEKOLAH",
    npsn:base["NPSN"], school_name:base["Nama SMK"], district:base["Kab/Kota"],
    contact_name:selected["Nama PTK"], role:selected["Tugas Tambahan"], phone_source:selected["No HP"],
    phone_wa:p.normalized, wa_link:p.wa_link, whatsapp_status:"UNVERIFIED_ACCOUNT",
    fallback_used:fallback,
    selection_basis:fallback?"Kepala Sekolah tidak memiliki nomor valid; menggunakan kontak valid pertama pada sekolah/NPSN yang sama sesuai urutan sumber CSV.":"Nomor valid Kepala Sekolah tersedia.",
    source_row:selected.__source_order,
    alternate_valid_contacts:Math.max(0,rs.filter(r=>phone(r["No HP"]).valid).length-1)
  };
}

export default tool({
  description: "Mencari kontak sekolah dari registry lokal nomor_ks.csv. Prioritas Kepala Sekolah; fallback kontak valid pertama dalam NPSN yang sama. Menghasilkan nomor 62 dan link wa.me tanpa mengklaim akun WhatsApp terverifikasi.",
  args: {
    queries_json: tool.schema.string().describe('JSON array, contoh [{"school_name":"SMKN 1 BANDUNG","district":"Kab. Tulungagung"},{"npsn":"20510099"}]')
  },
  async execute(args, context) {
    let queries; try { queries=JSON.parse(args.queries_json); } catch(e) { throw new Error(`queries_json tidak valid: ${e.message}`); }
    if (!Array.isArray(queries) || !queries.length) throw new Error("queries_json harus berupa array non-kosong");
    if (queries.length>500) throw new Error("Maksimum 500 target per pemanggilan; pecah batch.");
    const root=(context.directory || context.worktree || process.cwd());
    const reg=await loadRegistry(root);
    const results=queries.map(q=>resolveGroup(reg,q||{}));
    const summary={
      total:results.length,
      kepala_sekolah:results.filter(x=>x.status==="KEPALA_SEKOLAH").length,
      fallback_management:results.filter(x=>x.status==="FALLBACK_MANAGEMENT").length,
      sekolah_tidak_update:results.filter(x=>x.status==="SEKOLAH TIDAK UPDATE KONTAK").length,
      not_found:results.filter(x=>x.status==="SCHOOL_NOT_FOUND").length,
      ambiguous:results.filter(x=>x.status==="AMBIGUOUS").length,
      identity_conflict:results.filter(x=>x.status==="IDENTITY_CONFLICT").length
    };
    return JSON.stringify({registry:"knowledge/contact-registry/nomor_ks.csv",whatsapp_note:"wa.me link is a convenience link; account registration is UNVERIFIED unless separately verified.",summary,results},null,2);
  }
});

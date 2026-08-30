import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CONTACT_DIR = path.join(ROOT, "workspace", "system", "contacts");
export const CONTACT_FILE = path.join(CONTACT_DIR, "contacts.json");
export const CONTACT_AUDIT = path.join(CONTACT_DIR, "contact-change-log.jsonl");
export const WA_DIR = path.join(ROOT, "workspace", "system", "communication", "whatsapp");
export const PACKAGE_DIR = path.join(WA_DIR, "packages");
export const DISPATCH_LOG = path.join(WA_DIR, "dispatch-log.jsonl");
export const PACKAGE_LOG = path.join(WA_DIR, "package-log.jsonl");
export const BRIDGE = "http://127.0.0.1:8080";
export const MAX_RECIPIENTS = 500;
export const VERIFY_CHUNK = 50;
export const SEND_DELAY_MS = 250;

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function atomicJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}
function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}
export function cleanText(s) {
  return String(s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}
export function textKey(s) {
  return cleanText(s)
    .toLowerCase()
    .replace(/\b(kabupaten|kab\.?)\b/g, "kab")
    .replace(/\b(kota)\b/g, "kota")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function normalizeIndonesianPhone(input) {
  const raw = cleanText(input);
  if (!raw) return { ok:false, status:"INVALID_PHONE_NUMBER", input:raw, reason:"EMPTY" };
  if (/[a-zA-Z]/.test(raw)) return { ok:false, status:"INVALID_PHONE_NUMBER", input:raw, reason:"CONTAINS_LETTERS" };
  let s = raw.replace(/[^\d+]/g, "");
  if ((s.match(/\+/g) || []).length > 1 || (s.includes("+") && !s.startsWith("+"))) {
    return { ok:false, status:"INVALID_PHONE_NUMBER", input:raw, reason:"INVALID_PLUS" };
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0062")) s = "62" + s.slice(4);
  else if (s.startsWith("08")) s = "62" + s.slice(1);
  else if (s.startsWith("62")) {}
  else return { ok:false, status:"INVALID_PHONE_NUMBER", input:raw, reason:"UNSUPPORTED_PREFIX" };

  if (!/^628\d{7,12}$/.test(s)) {
    return { ok:false, status:"INVALID_PHONE_NUMBER", input:raw, canonical:s, reason:"INVALID_INDONESIAN_MOBILE_LENGTH_OR_PREFIX" };
  }
  return { ok:true, status:"NORMALIZED", input:raw, canonical:s, display:"+" + s };
}
export function looksPhoneLike(s) {
  const t = cleanText(s);
  return /^[+()\d\s.\-]+$/.test(t) && /\d/.test(t);
}
export function loadRegistry() {
  ensureDir(CONTACT_DIR);
  if (!fs.existsSync(CONTACT_FILE)) {
    const initial = { version:2, updated_at:nowIso(), contacts:[] };
    atomicJson(CONTACT_FILE, initial);
    return initial;
  }
  const obj = JSON.parse(fs.readFileSync(CONTACT_FILE, "utf8"));
  if (!Array.isArray(obj.contacts)) obj.contacts = [];
  return obj;
}
export function saveRegistry(reg) {
  reg.version = 2;
  reg.updated_at = nowIso();
  atomicJson(CONTACT_FILE, reg);
}
function contactHaystack(c) {
  return [
    c.display_name, c.person_name, c.institution, c.role, c.district,
    ...(Array.isArray(c.aliases) ? c.aliases : []),
    c.phone
  ].filter(Boolean).map(textKey).join(" | ");
}
function scoreContact(c, query) {
  const q = textKey(query);
  if (!q) return 0;
  const vals = [
    c.display_name, c.person_name, c.institution, c.role, c.district,
    ...(Array.isArray(c.aliases) ? c.aliases : [])
  ].filter(Boolean).map(textKey);
  if (vals.some(v => v === q)) return 1000;
  const hay = contactHaystack(c);
  if (hay.includes(q)) return 800 + q.length;
  const tokens = q.split(" ").filter(x => x.length > 1);
  if (!tokens.length) return 0;
  const matched = tokens.filter(t => hay.includes(t)).length;
  return matched === tokens.length ? 500 + matched * 10 : matched * 20;
}
export function searchContacts(query, { includeInactive=false, limit=10 } = {}) {
  const reg = loadRegistry();
  const rows = reg.contacts
    .filter(c => includeInactive || c.active !== false)
    .map(c => ({ contact:c, score:scoreContact(c, query) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score || String(a.contact.display_name||"").localeCompare(String(b.contact.display_name||"")))
    .slice(0, limit);
  return rows;
}
export function resolveUniqueContact(query, opts={}) {
  const rows = searchContacts(query, { includeInactive:!!opts.includeInactive, limit:10 });
  if (!rows.length) return { status:"NOT_FOUND", candidates:[] };
  const top = rows[0];
  const second = rows[1];
  if (second && second.score === top.score && second.contact.contact_id !== top.contact.contact_id) {
    return { status:"AMBIGUOUS", candidates:rows.slice(0,5).map(x => x.contact) };
  }
  if (top.score < 60) return { status:"NOT_FOUND", candidates:rows.slice(0,5).map(x => x.contact) };
  return { status:"FOUND", contact:top.contact };
}
function makeContactId() {
  return "CT-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}
export function contactCreate(input) {
  const phone = normalizeIndonesianPhone(input.phone);
  if (!phone.ok) return phone;
  const reg = loadRegistry();
  const dup = reg.contacts.find(c =>
    c.active !== false &&
    c.phone === phone.canonical &&
    textKey(c.display_name || c.institution || c.person_name) === textKey(input.display_name || input.institution || input.person_name)
  );
  if (dup) return { status:"EXISTS", contact:dup };

  const now = nowIso();
  const contact = {
    contact_id: makeContactId(),
    display_name: cleanText(input.display_name || input.person_name || input.institution || phone.display),
    person_name: cleanText(input.person_name || ""),
    institution: cleanText(input.institution || ""),
    role: cleanText(input.role || ""),
    district: cleanText(input.district || ""),
    phone: phone.canonical,
    aliases: Array.from(new Set((input.aliases || []).map(cleanText).filter(Boolean))),
    active: true,
    created_at: now,
    updated_at: now
  };
  reg.contacts.push(contact);
  saveRegistry(reg);
  appendJsonl(CONTACT_AUDIT, { timestamp:now, action:"CREATE", contact_id:contact.contact_id, after:contact });
  return { status:"CREATED", contact };
}
export function contactUpdate(query, changes) {
  const found = resolveUniqueContact(query, { includeInactive:false });
  if (found.status !== "FOUND") return found;
  const reg = loadRegistry();
  const idx = reg.contacts.findIndex(c => c.contact_id === found.contact.contact_id);
  if (idx < 0) return { status:"NOT_FOUND" };
  const before = JSON.parse(JSON.stringify(reg.contacts[idx]));
  const c = reg.contacts[idx];

  if (changes.phone) {
    const p = normalizeIndonesianPhone(changes.phone);
    if (!p.ok) return p;
    c.phone = p.canonical;
  }
  for (const [src, dst] of [
    ["display_name","display_name"],["person_name","person_name"],["institution","institution"],
    ["role","role"],["district","district"]
  ]) if (changes[src] != null && cleanText(changes[src])) c[dst] = cleanText(changes[src]);

  if (Array.isArray(changes.aliases)) c.aliases = Array.from(new Set(changes.aliases.map(cleanText).filter(Boolean)));
  c.updated_at = nowIso();
  reg.contacts[idx] = c;
  saveRegistry(reg);
  appendJsonl(CONTACT_AUDIT, { timestamp:c.updated_at, action:"UPDATE", contact_id:c.contact_id, before, after:c });
  return { status:"UPDATED", before, contact:c };
}
export function contactSoftDelete(query) {
  const found = resolveUniqueContact(query, { includeInactive:false });
  if (found.status !== "FOUND") return found;
  const reg = loadRegistry();
  const idx = reg.contacts.findIndex(c => c.contact_id === found.contact.contact_id);
  const before = JSON.parse(JSON.stringify(reg.contacts[idx]));
  reg.contacts[idx].active = false;
  reg.contacts[idx].updated_at = nowIso();
  saveRegistry(reg);
  appendJsonl(CONTACT_AUDIT, { timestamp:reg.contacts[idx].updated_at, action:"SOFT_DELETE", contact_id:reg.contacts[idx].contact_id, before, after:reg.contacts[idx] });
  return { status:"DELETED", contact:reg.contacts[idx] };
}
export function contactRestore(query) {
  const found = resolveUniqueContact(query, { includeInactive:true });
  if (found.status !== "FOUND") return found;
  const reg = loadRegistry();
  const idx = reg.contacts.findIndex(c => c.contact_id === found.contact.contact_id);
  const before = JSON.parse(JSON.stringify(reg.contacts[idx]));
  reg.contacts[idx].active = true;
  reg.contacts[idx].updated_at = nowIso();
  saveRegistry(reg);
  appendJsonl(CONTACT_AUDIT, { timestamp:reg.contacts[idx].updated_at, action:"RESTORE", contact_id:reg.contacts[idx].contact_id, before, after:reg.contacts[idx] });
  return { status:"RESTORED", contact:reg.contacts[idx] };
}
export function contactList(includeInactive=false) {
  return loadRegistry().contacts.filter(c => includeInactive || c.active !== false);
}

export function resolveRecipientToken(token) {
  const value = cleanText(token);
  if (!value) return { input:value, status:"MISSING" };
  if (looksPhoneLike(value)) {
    const p = normalizeIndonesianPhone(value);
    if (!p.ok) return { input:value, status:"INVALID_PHONE_NUMBER", reason:p.reason };
    return { input:value, status:"RESOLVED", source:"DIRECT_NUMBER", phone:p.canonical, display_name:p.display };
  }
  const found = resolveUniqueContact(value, { includeInactive:false });
  if (found.status === "FOUND") {
    const p = normalizeIndonesianPhone(found.contact.phone);
    if (!p.ok) return { input:value, status:"INVALID_PHONE_NUMBER", contact:found.contact, reason:p.reason };
    return {
      input:value, status:"RESOLVED", source:"CONTACT_REGISTRY",
      contact_id:found.contact.contact_id,
      phone:p.canonical,
      display_name:found.contact.display_name || found.contact.institution || found.contact.person_name || p.display,
      institution:found.contact.institution || "",
      role:found.contact.role || ""
    };
  }
  return { input:value, status:found.status, candidates:found.candidates || [] };
}
async function postJson(url, body, timeoutMs=12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),
      signal:ctl.signal
    });
    let data;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
    return { ok:res.ok, http_status:res.status, data };
  } finally {
    clearTimeout(timer);
  }
}
function boolFrom(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s=v.toLowerCase();
    if (["true","yes","registered","ok","on_whatsapp"].includes(s)) return true;
    if (["false","no","not_registered","not_on_whatsapp"].includes(s)) return false;
  }
  return null;
}
function resultPhone(x) {
  for (const k of ["number","phone","query","input","recipient","jid"]) {
    if (x && x[k] != null) {
      const raw = String(x[k]).split("@")[0];
      const p = normalizeIndonesianPhone(raw);
      if (p.ok) return p.canonical;
    }
  }
  return null;
}
function resultRegistered(x) {
  for (const k of ["is_on_whatsapp","isOnWhatsApp","registered","is_registered","exists","on_whatsapp"]) {
    if (x && Object.prototype.hasOwnProperty.call(x,k)) {
      const b=boolFrom(x[k]); if (b !== null) return b;
    }
  }
  if (x && typeof x.status === "string") {
    const b=boolFrom(x.status); if (b !== null) return b;
  }
  return null;
}
function flattenVerify(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ["results","numbers","data","result"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  if (data.results && typeof data.results === "object") {
    return Object.entries(data.results).map(([number,v]) => typeof v === "object" ? {number,...v} : {number,registered:v});
  }
  return [];
}
export async function verifyNumbers(numbers) {
  const unique = Array.from(new Set(numbers));
  const out = new Map();
  for (let i=0; i<unique.length; i+=VERIFY_CHUNK) {
    const chunk = unique.slice(i, i+VERIFY_CHUNK);
    const res = await postJson(BRIDGE + "/api/verify", { numbers:chunk }, 15000);
    if (!res.ok) {
      for (const n of chunk) out.set(n, { registered:false, status:"VERIFY_ERROR", http_status:res.http_status, detail:res.data });
      continue;
    }
    const rows = flattenVerify(res.data);
    if (!rows.length && chunk.length === 1) {
      const b = resultRegistered(res.data);
      if (b !== null) out.set(chunk[0], { registered:b, status:b?"REGISTERED":"NOT_REGISTERED", detail:res.data });
    }
    for (const row of rows) {
      const n = resultPhone(row);
      const b = resultRegistered(row);
      if (n && b !== null) out.set(n, { registered:b, status:b?"REGISTERED":"NOT_REGISTERED", detail:row });
    }
    for (const n of chunk) if (!out.has(n)) out.set(n, { registered:false, status:"VERIFY_UNKNOWN", detail:res.data });
  }
  return out;
}
export function packageId() {
  const d = new Date();
  const z = n => String(n).padStart(2,"0");
  return "WA-BULK-" + d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+"-"+z(d.getHours())+z(d.getMinutes())+z(d.getSeconds())+"-"+crypto.randomBytes(2).toString("hex").toUpperCase();
}
export function dispatchId() {
  const d = new Date();
  const z = n => String(n).padStart(2,"0");
  return "WA-" + d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+"-"+z(d.getHours())+z(d.getMinutes())+z(d.getSeconds())+"-"+crypto.randomBytes(2).toString("hex").toUpperCase();
}
export function snapshotHash(message, recipients) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({message:cleanText(message), recipients:recipients.map(r => r.phone).sort()}))
    .digest("hex");
}
export function savePackage(pkg) {
  ensureDir(PACKAGE_DIR);
  atomicJson(path.join(PACKAGE_DIR, pkg.package_id + ".json"), pkg);
}
export function loadPackage(id) {
  const p = path.join(PACKAGE_DIR, String(id) + ".json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p,"utf8"));
}
export function logDispatch(e) { appendJsonl(DISPATCH_LOG, e); }
export function logPackage(e) { appendJsonl(PACKAGE_LOG, e); }
export async function sendOne(phone, message) {
  const res = await postJson(BRIDGE + "/api/send", { recipient:phone, message }, 20000);
  const success = res.ok && !(res.data && res.data.success === false);
  return { success, http_status:res.http_status, response:res.data };
}
export function sleep(ms) { return new Promise(r => setTimeout(r,ms)); }

/* UNIT_ELITE_MANAGED:WA_EXCEL_FALLBACK_V2_BEGIN */

export const TRANSPORT_STATE_FILE = path.join(ROOT, "integrations", "whatsapp-service", "transport-state.json");
export const WA_EXPORT_DIR = path.join(WA_DIR, "exports");

export function getWhatsAppTransportState() {
  try {
    if (!fs.existsSync(TRANSPORT_STATE_FILE)) {
      return { version:1, mode:"ACTIVE", reason:null, fallback:"EXCEL_WA_ME" };
    }
    const x = JSON.parse(fs.readFileSync(TRANSPORT_STATE_FILE, "utf8"));
    return {
      version: Number(x.version || 1),
      mode: String(x.mode || "ACTIVE").toUpperCase(),
      reason: x.reason || null,
      fallback: x.fallback || "EXCEL_WA_ME",
      updated_at: x.updated_at || null
    };
  } catch (e) {
    return {
      version:1,
      mode:"SUSPENDED",
      reason:"transport_state_unreadable:" + String(e?.message || e),
      fallback:"EXCEL_WA_ME"
    };
  }
}

export async function bridgeOperationalStatus() {
  const configured = getWhatsAppTransportState();
  if (configured.mode === "SUSPENDED") {
    return {
      ready:false,
      status:"SUSPENDED",
      reason:configured.reason || "bridge_under_repair",
      fallback:configured.fallback || "EXCEL_WA_ME"
    };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(BRIDGE + "/api/health", {
      method:"GET",
      signal:ctl.signal
    });
    let data = {};
    const txt = await res.text();
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw:txt }; }

    const connected =
      data?.connected === true ||
      data?.ready === true ||
      data?.status === "READY" ||
      data?.status === "ready";

    if (res.ok && connected) {
      return { ready:true, status:"READY", reason:null, detail:data };
    }
    return {
      ready:false,
      status:res.ok ? "NOT_CONNECTED" : "HTTP_ERROR",
      reason:res.ok ? "bridge_not_connected" : "bridge_health_http_" + res.status,
      detail:data
    };
  } catch (e) {
    return {
      ready:false,
      status:"STOPPED",
      reason:String(e?.name === "AbortError" ? "bridge_health_timeout" : (e?.message || e))
    };
  } finally {
    clearTimeout(timer);
  }
}

function xlsxXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function xlsxCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function dosTimeDate(d = new Date()) {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds()/2);
  const date = ((year - 1980) << 9) | ((d.getMonth()+1) << 5) | d.getDate();
  return {time, date};
}
function crc32(buf) {
  let c = 0 ^ (-1);
  for (let i=0; i<buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  }
  return (c ^ (-1)) >>> 0;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n=0; n<256; n++) {
    let c=n;
    for (let k=0; k<8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function zipStore(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const dt = dosTimeDate();

  for (const ent of entries) {
    const name = Buffer.from(ent.name.replace(/\\/g,"/"), "utf8");
    const data = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(String(ent.data), "utf8");
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dt.time, 10);
    lh.writeUInt16LE(dt.date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);

    local.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dt.time, 12);
    ch.writeUInt16LE(dt.date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, centralBuf, eocd]);
}
function inlineCell(ref, value, style=0) {
  const s = style ? ' s="' + style + '"' : "";
  return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' +
    xlsxXml(value) + '</t></is></c>';
}
function numberCell(ref, value, style=0) {
  const s = style ? ' s="' + style + '"' : "";
  return '<c r="' + ref + '"' + s + '><v>' + Number(value || 0) + '</v></c>';
}
function rowXml(rowNum, cells) {
  return '<row r="' + rowNum + '">' + cells.join("") + '</row>';
}
function localTimestamp(d=new Date()) {
  const z = n => String(n).padStart(2,"0");
  return d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+"-"+z(d.getHours())+z(d.getMinutes())+z(d.getSeconds());
}

export function buildFallbackWorkbookBytes(pkg, reason="bridge_unavailable") {
  const candidates = (pkg.recipients || []).filter(r =>
    r &&
    r.phone &&
    r.status === "RESOLVED" &&
    r.send_status !== "SENT"
  );

  const headers = ["No","Nama Penerima","Instansi","Nomor WA","Pesan","Link WhatsApp","URL Lengkap","Status"];
  const hyperlinks = [];
  const sharedValues = [];
  const sharedMap = new Map();
  let sharedRefCount = 0;
  let relCounter = 1;

  function sharedIndex(value) {
    const v = String(value ?? "");
    if (sharedMap.has(v)) return sharedMap.get(v);
    const idx = sharedValues.length;
    sharedValues.push(v);
    sharedMap.set(v, idx);
    return idx;
  }

  function sharedCell(ref, value, style=2) {
    sharedRefCount++;
    const s = style ? ' s="' + style + '"' : "";
    return '<c r="' + ref + '" t="s"' + s + '><v>' + sharedIndex(value) + '</v></c>';
  }

  function looksLikePhoneInput(value) {
    const v = String(value ?? "").trim();
    return /^\+?[0-9][0-9\s().-]{7,20}$/.test(v);
  }

  function recipientDisplayName(r) {
    const direct = String(r.display_name || r.name || r.contact_name || "").trim();
    if (direct) return direct;

    const input = String(r.input || "").trim();
    if (input && !looksLikePhoneInput(input)) return input;

    return "(nama tidak tersedia)";
  }

  function recipientInstitution(r) {
    const value = String(
      r.institution ||
      r.organization ||
      r.organization_name ||
      r.instansi ||
      ""
    ).trim();
    return value || "(instansi tidak tersedia)";
  }

  const rows = [];
  rows.push(rowXml(1, headers.map((h,i) => sharedCell(xlsxCol(i+1)+"1", h, 1))));

  for (let i=0; i<candidates.length; i++) {
    const r = candidates[i];
    const rn = i + 2;
    const display = recipientDisplayName(r);
    const institution = recipientInstitution(r);
    const phone = String(r.phone || "").trim();
    const message = String(pkg.message || "");
    const link = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
    const relId = "rId" + relCounter++;

    rows.push(rowXml(rn, [
      numberCell("A"+rn, i+1),
      sharedCell("B"+rn, display, 2),
      sharedCell("C"+rn, institution, 2),
      sharedCell("D"+rn, phone, 2),
      sharedCell("E"+rn, message, 3),
      sharedCell("F"+rn, "Klik untuk WhatsApp", 2),
      sharedCell("G"+rn, link, 3),
      sharedCell("H"+rn, "READY_MANUAL", 2)
    ]));

    hyperlinks.push({ref:"F"+rn, id:relId, target:link});
  }

  const sheet1LastRow = Math.max(1, candidates.length + 1);
  const sheet1 =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <dimension ref="A1:H${sheet1LastRow}"/>
 <sheetViews>
  <sheetView workbookViewId="0">
   <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
   <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
  </sheetView>
 </sheetViews>
 <sheetFormatPr defaultRowHeight="15"/>
 <cols>
  <col min="1" max="1" width="7" customWidth="1"/>
  <col min="2" max="2" width="28" customWidth="1"/>
  <col min="3" max="3" width="32" customWidth="1"/>
  <col min="4" max="4" width="20" customWidth="1"/>
  <col min="5" max="5" width="52" customWidth="1"/>
  <col min="6" max="6" width="24" customWidth="1"/>
  <col min="7" max="7" width="72" customWidth="1"/>
  <col min="8" max="8" width="18" customWidth="1"/>
 </cols>
 <sheetData>${rows.join("")}</sheetData>
 <autoFilter ref="A1:H${sheet1LastRow}"/>
 ${hyperlinks.length ? '<hyperlinks>' + hyperlinks.map(h => '<hyperlink ref="' + h.ref + '" r:id="' + h.id + '"/>').join("") + '</hyperlinks>' : ""}
</worksheet>`;

  const sheet1Rels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hyperlinks.map(h => '<Relationship Id="' + h.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xlsxXml(h.target) + '" TargetMode="External"/>').join("")}
</Relationships>`;

  const summaryPairs = [
    ["Package ID", pkg.package_id || ""],
    ["Waktu dibuat", new Date().toISOString()],
    ["Alasan fallback", reason || "bridge_unavailable"],
    ["Transport status", pkg.transport_status || "UNAVAILABLE"],
    ["Jumlah penerima diminta", pkg.requested_count ?? (pkg.recipients || []).length],
    ["Jumlah link manual", candidates.length],
    ["Duplikat dihapus", pkg.duplicates_removed || 0],
    ["Status package", pkg.status || ""],
    ["Isi pesan", pkg.message || ""],
    ["Catatan", "Klik kolom Link WhatsApp pada sheet PENGIRIMAN atau salin URL Lengkap di kolom sebelahnya. Pesan sudah diisi otomatis; pengiriman tetap dilakukan manual oleh pengguna."]
  ];

  const s2rows = [
    rowXml(1, [sharedCell("A1","RINGKASAN FALLBACK WHATSAPP",1)])
  ];
  for (let i=0; i<summaryPairs.length; i++) {
    const rn = i + 3;
    s2rows.push(rowXml(rn, [
      sharedCell("A"+rn, summaryPairs[i][0], 1),
      sharedCell("B"+rn, String(summaryPairs[i][1] ?? ""), 3)
    ]));
  }

  const sheet2LastRow = summaryPairs.length + 2;
  const sheet2 =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <dimension ref="A1:B${sheet2LastRow}"/>
 <sheetViews><sheetView workbookViewId="0"/></sheetViews>
 <sheetFormatPr defaultRowHeight="15"/>
 <cols>
  <col min="1" max="1" width="26" customWidth="1"/>
  <col min="2" max="2" width="78" customWidth="1"/>
 </cols>
 <sheetData>${s2rows.join("")}</sheetData>
</worksheet>`;

  const sharedStrings =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 count="${sharedRefCount}" uniqueCount="${sharedValues.length}">
${sharedValues.map(v => '<si><t xml:space="preserve">' + xlsxXml(v) + '</t></si>').join("")}
</sst>`;

  const workbook =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <bookViews><workbookView activeTab="0"/></bookViews>
 <sheets>
  <sheet name="PENGIRIMAN" sheetId="1" r:id="rId1"/>
  <sheet name="RINGKASAN" sheetId="2" r:id="rId2"/>
 </sheets>
 <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
 <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const styles =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="2">
  <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
 </fonts>
 <fills count="2">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
 </fills>
 <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="4">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const contentTypes =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
 <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
 <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
 <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const coreProps =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <dc:title>Unit Elite WhatsApp Manual Fallback</dc:title>
 <dc:creator>Unit Elite</dc:creator>
 <cp:lastModifiedBy>Unit Elite</cp:lastModifiedBy>
 <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;

  const appProps =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
 <Application>Unit Elite</Application>
</Properties>`;

  return zipStore([
    {name:"[Content_Types].xml", data:contentTypes},
    {name:"_rels/.rels", data:rootRels},
    {name:"docProps/core.xml", data:coreProps},
    {name:"docProps/app.xml", data:appProps},
    {name:"xl/workbook.xml", data:workbook},
    {name:"xl/_rels/workbook.xml.rels", data:workbookRels},
    {name:"xl/styles.xml", data:styles},
    {name:"xl/sharedStrings.xml", data:sharedStrings},
    {name:"xl/worksheets/sheet1.xml", data:sheet1},
    {name:"xl/worksheets/_rels/sheet1.xml.rels", data:sheet1Rels},
    {name:"xl/worksheets/sheet2.xml", data:sheet2}
  ]);
}

export function exportFallbackExcel(pkg, reason="bridge_unavailable") {
  ensureDir(WA_EXPORT_DIR);
  const filename = "WA-FALLBACK-" + localTimestamp(new Date()) + ".xlsx";
  const filePath = path.join(WA_EXPORT_DIR, filename);
  const bytes = buildFallbackWorkbookBytes(pkg, reason);
  const tmp = filePath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, filePath);

  const count = (pkg.recipients || []).filter(r =>
    r && r.phone && r.status === "RESOLVED" && r.send_status !== "SENT"
  ).length;

  return {
    filename,
    file_path:filePath,
    recipient_count:count,
    bytes:bytes.length
  };
}

/* UNIT_ELITE_MANAGED:WA_EXCEL_FALLBACK_V2_END */

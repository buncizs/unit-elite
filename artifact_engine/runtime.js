import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function resolveInside(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const relative = path.relative(base, target);
  // Safer than string-prefix matching for filesystem roots such as '/' or 'C:\'.
  if (relative === "") return target;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  return target;
}

export function sanitizeFilename(name, fallback = "output") {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

export function slugify(text, max = 60) {
  const out = String(text || "task")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, max);
  return out || "task";
}

export async function readConfig(root) {
  const p = resolveInside(root, "config/unit-elite.json");
  return JSON.parse(await fsp.readFile(p, "utf8"));
}

function partsInZone(timeZone) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export async function timestampInfo(root) {
  const cfg = await readConfig(root);
  const p = partsInZone(cfg.timezone || "Asia/Jakarta");
  const compact = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
  const folder = `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
  const local = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  return { compact, folder, local, timezone: cfg.timezone || "Asia/Jakarta" };
}

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

export async function readJson(p) {
  return JSON.parse(await fsp.readFile(p, "utf8"));
}

export async function writeJson(p, obj) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export async function sha256File(p) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(p);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function copyRecursive(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.cp(src, dest, { recursive: true, force: true, preserveTimestamps: true });
}

export async function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export async function dependencyStatus(root) {
  const pkg = resolveInside(root, "package.json");
  const engine = resolveInside(root, "artifact_engine/zip.js");
  return {
    package_json: fs.existsSync(pkg),
    embedded_engine: fs.existsSync(engine),
    node_modules_required: false,
    spawn_required: false,
    mode: "embedded-no-spawn",
  };
}

export async function ensureDependencies(root) {
  const status = await dependencyStatus(root);
  if (!status.embedded_engine) throw new Error("Embedded artifact engine is missing: artifact_engine/zip.js");
  return { installed: true, action: "embedded-no-spawn", node_modules_required: false };
}

export async function getTask(root, taskId) {
  if (!/^TASK-[A-Za-z0-9-]+$/.test(taskId)) throw new Error("Invalid TASK-ID format");
  const taskDir = resolveInside(root, `workspace/active/${taskId}`);
  const taskJsonPath = path.join(taskDir, "task.json");
  if (!fs.existsSync(taskJsonPath)) throw new Error(`Active task not found: ${taskId}`);
  const task = await readJson(taskJsonPath);
  return { taskDir, taskJsonPath, task };
}

export async function saveTask(taskJsonPath, task) {
  task.updated_at = new Date().toISOString();
  await writeJson(taskJsonPath, task);
}

export async function verifyCopyByChecksum(src, dest) {
  if (!fs.existsSync(src) || !fs.existsSync(dest)) return false;
  return (await sha256File(src)) === (await sha256File(dest));
}

export async function manifestForDirectory(rootDir) {
  const files = await listFilesRecursive(rootDir);
  const items = [];
  for (const f of files) {
    items.push({
      path: path.relative(rootDir, f).replaceAll(path.sep, "/"),
      size: (await fsp.stat(f)).size,
      sha256: await sha256File(f),
    });
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  return items;
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  resolveInside,
  slugify,
  timestampInfo,
  ensureDir,
  sha256File,
  readConfig,
  getTask,
  saveTask,
  copyRecursive,
  manifestForDirectory,
  writeJson,
  listFilesRecursive,
} from "./runtime.js";
import { validateArtifactFile } from "./validate.js";
import { createExecutiveSummaryPdf } from "./pdf.js";

function rel(root, p) {
  return path.relative(root, p).replaceAll(path.sep, "/");
}

function isOfficeLockFile(p) {
  const base = path.basename(p);
  return base.startsWith("~$") || base.endsWith(".tmp~") || base.endsWith(".lock");
}

function friendlyBusyReason(err) {
  const code = err?.code || "UNKNOWN";
  if (["EBUSY", "EPERM", "EACCES", "EINVAL"].includes(code)) return `${code}: file/folder sedang digunakan atau dikunci aplikasi lain`;
  return `${code}: ${err?.message || "filesystem operation failed"}`;
}

async function probeRenameFile(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const token = crypto.randomBytes(5).toString("hex");
  const probe = path.join(dir, `.${base}.ue-close-probe-${token}`);
  let moved = false;
  try {
    await fsp.rename(file, probe);
    moved = true;
    await fsp.rename(probe, file);
    moved = false;
    return { ok: true };
  } catch (err) {
    if (moved && fs.existsSync(probe) && !fs.existsSync(file)) {
      try { await fsp.rename(probe, file); } catch (_) {}
    }
    return { ok: false, reason: friendlyBusyReason(err), code: err?.code || "UNKNOWN" };
  }
}

async function probeRenameDirectory(dir) {
  const parent = path.dirname(dir);
  const token = crypto.randomBytes(5).toString("hex");
  const probe = path.join(parent, `.${path.basename(dir)}.ue-close-probe-${token}`);
  let moved = false;
  try {
    await fsp.rename(dir, probe);
    moved = true;
    await fsp.rename(probe, dir);
    moved = false;
    return { ok: true };
  } catch (err) {
    if (moved && fs.existsSync(probe) && !fs.existsSync(dir)) {
      try { await fsp.rename(probe, dir); } catch (_) {}
    }
    return { ok: false, reason: friendlyBusyReason(err), code: err?.code || "UNKNOWN" };
  }
}

async function preflightClosure(root, taskDir, task, { cleanupInbox = true, includeInbox = true } = {}) {
  const blocked = [];
  const taskFiles = await listFilesRecursive(taskDir);

  // Strong Office signal: Word/Excel/PowerPoint commonly create ~$ lock files while a document is open.
  for (const f of taskFiles) {
    if (isOfficeLockFile(f)) {
      blocked.push({ path: rel(root, f), reason: "Office lock file terdeteksi; dokumen kemungkinan masih terbuka." });
    }
  }

  if (blocked.length === 0) {
    for (const f of taskFiles) {
      const r = await probeRenameFile(f);
      if (!r.ok) blocked.push({ path: rel(root, f), reason: r.reason, code: r.code });
    }
  }

  // Probe the whole active task directory too. This mirrors the atomic rename used for commit.
  if (blocked.length === 0) {
    const d = await probeRenameDirectory(taskDir);
    if (!d.ok) blocked.push({ path: rel(root, taskDir), reason: d.reason, code: d.code });
  }

  // If inbox originals are scheduled for cleanup, verify unchanged originals are movable too.
  if (blocked.length === 0 && cleanupInbox && includeInbox) {
    for (const inp of task.inputs || []) {
      const original = resolveInside(root, inp.original_path);
      if (!fs.existsSync(original)) continue;
      const currentHash = await sha256File(original);
      if (currentHash !== inp.sha256) continue; // changed source is retained by policy; no cleanup probe needed.
      const lockCandidate = path.join(path.dirname(original), `~$${path.basename(original)}`);
      if (fs.existsSync(lockCandidate)) {
        blocked.push({ path: inp.original_path, reason: "Office lock file terdeteksi pada input inbox; file kemungkinan masih terbuka." });
        continue;
      }
      const r = await probeRenameFile(original);
      if (!r.ok) blocked.push({ path: inp.original_path, reason: r.reason, code: r.code });
    }
  }

  if (blocked.length) {
    return {
      ok: false,
      status: "BLOCKED_FILE_IN_USE",
      warning: "TASK SELESAI dihentikan. Tutup file/folder yang masih terbuka atau digunakan aplikasi lain, lalu jalankan TASK SELESAI lagi.",
      blocked_files: blocked,
      archive_created: false,
      active_task_retained: true,
      inbox_untouched: true,
      retry_allowed_after_close: true,
    };
  }
  return { ok: true, status: "READY_TO_COMMIT" };
}

export async function createTask(root, { title, disposition, inputPaths = [] }) {
  const cfg = await readConfig(root);
  const ts = await timestampInfo(root);
  const slug = slugify(title);
  let taskId = `TASK-${ts.compact}-${slug}`;
  let counter = 1;
  while (fs.existsSync(resolveInside(root, `${cfg.task_paths.active}/${taskId}`))) {
    taskId = `TASK-${ts.compact}-${slug}-${counter++}`;
  }

  const taskDir = resolveInside(root, `${cfg.task_paths.active}/${taskId}`);
  for (const sub of ["input", "working", "output", "support", "qc", "communication"]) await ensureDir(path.join(taskDir, sub));

  const inputs = [];
  const inboxRoot = resolveInside(root, cfg.task_paths.inbox);
  for (const relPath of inputPaths) {
    const source = resolveInside(root, relPath.startsWith("workspace/") ? relPath : `${cfg.task_paths.inbox}/${relPath}`);
    if (source !== inboxRoot && !source.startsWith(inboxRoot + path.sep)) throw new Error(`Task input must come from ${cfg.task_paths.inbox}: ${relPath}`);
    const stat = await fsp.stat(source);
    if (!stat.isFile()) throw new Error(`Input is not a file: ${relPath}`);
    const dest = path.join(taskDir, "input", path.basename(source));
    await copyRecursive(source, dest);
    inputs.push({
      original_path: rel(root, source),
      task_copy: rel(root, dest),
      filename: path.basename(source),
      size: stat.size,
      sha256: await sha256File(source),
    });
  }

  const task = {
    schema_version: "1.5",
    task_id: taskId,
    title,
    slug,
    status: "ACTIVE",
    timezone: ts.timezone,
    started_at_local: ts.local,
    started_at_iso: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    disposition,
    inputs,
    outputs: [],
    support: [],
    qc: { status: "PENDING", latest_report: null, reports: [] },
    communications: { packages: [] },
    lifecycle: {
      done_keyword: cfg.task_done_keyword,
      cancel_keyword: cfg.task_cancel_keyword,
      cleanup_inbox_on_close: Boolean(cfg.cleanup_inbox_on_close),
      archive_working_files: Boolean(cfg.archive_working_files),
      close_mode: "atomic-rename",
      block_when_files_busy: true,
    },
  };
  await writeJson(path.join(taskDir, "task.json"), task);
  return task;
}

export async function addTaskInput(root, { taskId, inputPath }) {
  const cfg = await readConfig(root);
  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  const inboxRoot = resolveInside(root, cfg.task_paths.inbox);
  const source = resolveInside(root, inputPath.startsWith("workspace/") ? inputPath : `${cfg.task_paths.inbox}/${inputPath}`);
  if (source !== inboxRoot && !source.startsWith(inboxRoot + path.sep)) throw new Error(`Task input must come from ${cfg.task_paths.inbox}: ${inputPath}`);
  const stat = await fsp.stat(source);
  if (!stat.isFile()) throw new Error(`Input is not a file: ${inputPath}`);
  if (task.inputs.some((x) => x.original_path === rel(root, source))) return { status: "ALREADY_REGISTERED", task_id: taskId, input: path.basename(source) };
  const dest = path.join(taskDir, "input", path.basename(source));
  await copyRecursive(source, dest);
  const item = {
    original_path: rel(root, source),
    task_copy: rel(root, dest),
    filename: path.basename(source),
    size: stat.size,
    sha256: await sha256File(source),
    added_at: new Date().toISOString(),
  };
  task.inputs.push(item);
  await saveTask(taskJsonPath, task);
  return { status: "ADDED", task_id: taskId, input: item };
}

export async function registerOutput(root, taskId, entry) {
  const { taskJsonPath, task } = await getTask(root, taskId);
  const normalized = {
    type: entry.type,
    path: entry.path.replaceAll(path.sep, "/"),
    created_at: new Date().toISOString(),
    validation: entry.validation || "PENDING",
    sha256: entry.sha256 || null,
  };
  const existing = task.outputs.findIndex((o) => o.path === normalized.path);
  if (existing >= 0) task.outputs[existing] = { ...task.outputs[existing], ...normalized };
  else task.outputs.push(normalized);
  await saveTask(taskJsonPath, task);
  return normalized;
}

export async function recordQc(root, { taskId, status, report }) {
  const allowed = ["PASS", "PASS WITH NOTES", "FAIL"];
  if (!allowed.includes(status)) throw new Error(`QC status must be one of: ${allowed.join(", ")}`);
  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  const ts = await timestampInfo(root);
  const file = path.join(taskDir, "qc", `${ts.compact}_qc.json`);
  const payload = { task_id: taskId, status, recorded_at: new Date().toISOString(), report };
  await writeJson(file, payload);
  const reportRel = rel(root, file);
  task.qc.status = status;
  task.qc.latest_report = reportRel;
  task.qc.reports.push(reportRel);
  await saveTask(taskJsonPath, task);
  return payload;
}

export async function taskStatus(root, taskId) {
  const { task } = await getTask(root, taskId);
  return task;
}

export async function closeTask(root, { taskId, confirmationPhrase, executiveSummary, cleanupInbox = true }) {
  const cfg = await readConfig(root);
  if (String(confirmationPhrase || "").trim().toUpperCase() !== String(cfg.task_done_keyword).toUpperCase()) {
    throw new Error(`Closure blocked. Required confirmation phrase: ${cfg.task_done_keyword}`);
  }

  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  if (!["PASS", "PASS WITH NOTES"].includes(task.qc?.status)) {
    throw new Error(`Closure blocked. QC status is ${task.qc?.status || "PENDING"}; PASS or PASS WITH NOTES required.`);
  }
  if (!task.outputs?.length) throw new Error("Closure blocked. No registered output artifacts.");

  // Validate artifacts first, but do not create archive copies.
  const validations = [];
  for (const out of task.outputs) {
    const absolute = resolveInside(root, out.path);
    const result = await validateArtifactFile(absolute);
    if (!result.valid) throw new Error(`Artifact validation failed for ${out.path}: ${result.reason}`);
    out.validation = "PASS";
    out.sha256 = await sha256File(absolute);
    validations.push({ path: out.path, ...result });
  }
  await saveTask(taskJsonPath, task);

  // PRE-COMMIT GATE: if any task/inbox file is busy, stop BEFORE creating task_done.
  const preflight = await preflightClosure(root, taskDir, task, { cleanupInbox: Boolean(cleanupInbox && task.lifecycle.cleanup_inbox_on_close), includeInbox: true });
  if (!preflight.ok) return { task_id: taskId, ...preflight };

  const ts = await timestampInfo(root);
  const doneParent = resolveInside(root, cfg.task_paths.done);
  await ensureDir(doneParent);
  const doneDir = path.join(doneParent, `${ts.folder}__${task.slug}`);
  if (fs.existsSync(doneDir)) throw new Error(`Archive destination already exists: ${doneDir}`);

  let moved = false;
  let execPath = null;
  try {
    // ATOMIC COMMIT: move the whole task tree in one filesystem rename. No copy-then-delete duplication.
    try {
      await fsp.rename(taskDir, doneDir);
      moved = true;
    } catch (err) {
      if (["EBUSY", "EPERM", "EACCES", "EINVAL"].includes(err?.code)) {
        return {
          task_id: taskId,
          status: "BLOCKED_FILE_IN_USE",
          warning: "TASK SELESAI dihentikan karena file/folder menjadi terkunci saat commit. Tutup file yang masih terbuka lalu ulangi TASK SELESAI.",
          blocked_files: [{ path: rel(root, taskDir), reason: friendlyBusyReason(err), code: err?.code || "UNKNOWN" }],
          archive_created: false,
          active_task_retained: true,
          inbox_untouched: true,
          retry_allowed_after_close: true,
        };
      }
      throw err;
    }

    // Update task state only after the atomic move succeeds.
    task.status = "CLOSED";
    task.closed_at_local = ts.local;
    task.closed_at_iso = new Date().toISOString();
    task.archive_path = rel(root, doneDir);
    await writeJson(path.join(doneDir, "task.json"), task);

    execPath = path.join(doneDir, "executive-summary.pdf");
    await createExecutiveSummaryPdf(root, {
      outputPath: execPath,
      task,
      executiveSummary,
      validations,
      closedAtLocal: ts.local,
      timezone: ts.timezone,
    });
    const execValidation = await validateArtifactFile(execPath);
    if (!execValidation.valid) throw new Error(`Executive summary validation failed: ${execValidation.reason}`);

    const manifest = {
      schema_version: "1.5",
      task_id: task.task_id,
      title: task.title,
      slug: task.slug,
      status: "CLOSED",
      started_at_local: task.started_at_local,
      closed_at_local: ts.local,
      timezone: ts.timezone,
      disposition: task.disposition,
      inputs: task.inputs,
      outputs: task.outputs.map((o) => ({ ...o, archived_path: `output/${path.basename(o.path)}` })),
      qc: task.qc,
      communications: task.communications || { packages: [] },
      artifact_validations: validations,
      close_mode: "atomic-rename",
      file_lock_preflight: "PASS",
      cleanup_inbox_requested: Boolean(cleanupInbox),
      cleanup_inbox_results: [],
    };

    // Verify every registered output still exists after the atomic move and matches pre-move checksum.
    for (const out of task.outputs) {
      const archived = path.join(doneDir, "output", path.basename(out.path));
      if (!fs.existsSync(archived)) throw new Error(`Archived output missing after atomic move: ${archived}`);
      const h = await sha256File(archived);
      if (h !== out.sha256) throw new Error(`Archived output checksum mismatch after atomic move: ${path.basename(out.path)}`);
    }
    for (const inp of task.inputs) {
      const archived = path.join(doneDir, "input", inp.filename);
      if (!fs.existsSync(archived)) throw new Error(`Archived input missing after atomic move: ${archived}`);
    }

    // Build manifest file list excluding manifest.json itself to avoid self-referential checksums.
    manifest.files = (await manifestForDirectory(doneDir)).filter((x) => x.path !== "manifest.json");
    await writeJson(path.join(doneDir, "manifest.json"), manifest);

    // Inbox cleanup is deliberately LAST. If a file changed, retain it. If it became busy in a race, retain with warning.
    if (cleanupInbox && task.lifecycle.cleanup_inbox_on_close) {
      for (const inp of task.inputs) {
        const original = resolveInside(root, inp.original_path);
        const result = { path: inp.original_path, removed: false, reason: null };
        if (!fs.existsSync(original)) {
          result.reason = "already-missing";
        } else {
          const currentHash = await sha256File(original);
          if (currentHash !== inp.sha256) {
            result.reason = "source-changed-since-task-start; retained";
          } else {
            try {
              await fsp.unlink(original);
              result.removed = true;
              result.reason = "archived-and-checksum-verified";
            } catch (err) {
              result.reason = `cleanup-failed; retained; ${friendlyBusyReason(err)}`;
            }
          }
        }
        manifest.cleanup_inbox_results.push(result);
      }
      manifest.files = (await manifestForDirectory(doneDir)).filter((x) => x.path !== "manifest.json");
      await writeJson(path.join(doneDir, "manifest.json"), manifest);
    }

    const cleanupWarnings = manifest.cleanup_inbox_results.filter((x) => !x.removed && !["already-missing", "source-changed-since-task-start; retained"].includes(x.reason));
    return {
      task_id: taskId,
      status: cleanupWarnings.length ? "CLOSED_WITH_NOTES" : "CLOSED",
      archive_path: rel(root, doneDir),
      executive_summary: rel(root, execPath),
      cleanup_inbox_results: manifest.cleanup_inbox_results,
      close_mode: "atomic-rename",
      active_task_removed_by_atomic_move: true,
      duplicate_active_output_possible: false,
    };
  } catch (err) {
    // Roll back the atomic move if finalization failed before inbox cleanup became authoritative.
    if (moved && fs.existsSync(doneDir) && !fs.existsSync(taskDir)) {
      try {
        for (const extra of ["manifest.json", "executive-summary.pdf"]) {
          const p = path.join(doneDir, extra);
          if (fs.existsSync(p)) await fsp.rm(p, { force: true });
        }
        task.status = "ACTIVE";
        delete task.closed_at_local;
        delete task.closed_at_iso;
        delete task.archive_path;
        await writeJson(path.join(doneDir, "task.json"), task);
        await fsp.rename(doneDir, taskDir);
      } catch (rollbackErr) {
        throw new Error(`Task close failed and automatic rollback also failed. Close error: ${err.message}. Rollback error: ${rollbackErr.message}`);
      }
    }
    throw err;
  }
}

export async function cancelTask(root, { taskId, confirmationPhrase, reason = "" }) {
  const cfg = await readConfig(root);
  if (String(confirmationPhrase || "").trim().toUpperCase() !== String(cfg.task_cancel_keyword).toUpperCase()) {
    throw new Error(`Cancellation blocked. Required confirmation phrase: ${cfg.task_cancel_keyword}`);
  }
  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  const preflight = await preflightClosure(root, taskDir, task, { cleanupInbox: false, includeInbox: false });
  if (!preflight.ok) {
    return {
      task_id: taskId,
      status: "BLOCKED_FILE_IN_USE",
      warning: "BATALKAN TASK dihentikan. Tutup file/folder yang masih terbuka lalu ulangi BATALKAN TASK.",
      blocked_files: preflight.blocked_files,
      active_task_retained: true,
      inbox_untouched: true,
    };
  }
  const ts = await timestampInfo(root);
  const cancelledParent = resolveInside(root, cfg.task_paths.cancelled);
  await ensureDir(cancelledParent);
  const dest = path.join(cancelledParent, `${ts.folder}__${task.slug}`);
  if (fs.existsSync(dest)) throw new Error(`Cancellation destination already exists: ${dest}`);

  // Atomic move; no copy + recursive delete.
  try {
    await fsp.rename(taskDir, dest);
  } catch (err) {
    if (["EBUSY", "EPERM", "EACCES", "EINVAL"].includes(err?.code)) {
      return {
        task_id: taskId,
        status: "BLOCKED_FILE_IN_USE",
        warning: "BATALKAN TASK dihentikan karena file/folder masih digunakan aplikasi lain.",
        blocked_files: [{ path: rel(root, taskDir), reason: friendlyBusyReason(err), code: err?.code || "UNKNOWN" }],
        active_task_retained: true,
        inbox_untouched: true,
      };
    }
    throw err;
  }
  task.status = "CANCELLED";
  task.cancelled_at_local = ts.local;
  task.cancellation_reason = reason;
  await writeJson(path.join(dest, "task.json"), task);
  return {
    task_id: taskId,
    status: "CANCELLED",
    archive_path: rel(root, dest),
    inbox_cleanup: "NOT PERFORMED",
    move_mode: "atomic-rename",
  };
}

// Repair helper for partial-close residue produced by v1.3.2 copy-then-delete behavior.
export async function repairPartialClose(root, { taskId }) {
  const cfg = await readConfig(root);
  if (!/^TASK-[A-Za-z0-9-]+$/.test(taskId)) throw new Error("Invalid TASK-ID format");
  const activeDir = resolveInside(root, `${cfg.task_paths.active}/${taskId}`);
  if (!fs.existsSync(activeDir)) return { task_id: taskId, status: "NO_ACTIVE_RESIDUE" };

  // Find a task_done manifest with matching task_id.
  const doneRoot = resolveInside(root, cfg.task_paths.done);
  const matches = [];
  if (fs.existsSync(doneRoot)) {
    for (const entry of await fsp.readdir(doneRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(doneRoot, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
        if (m.task_id === taskId && m.status === "CLOSED") matches.push({ dir: path.join(doneRoot, entry.name), manifest: m });
      } catch (_) {}
    }
  }
  if (matches.length !== 1) {
    return {
      task_id: taskId,
      status: "REPAIR_BLOCKED",
      reason: matches.length === 0 ? "No matching CLOSED archive manifest found." : "Multiple matching CLOSED archives found; manual review required.",
      active_residue: rel(root, activeDir),
    };
  }

  const archiveDir = matches[0].dir;
  const residueFiles = await listFilesRecursive(activeDir);
  const mismatches = [];
  for (const f of residueFiles) {
    const relativeInsideTask = path.relative(activeDir, f);
    const archived = path.join(archiveDir, relativeInsideTask);
    if (!fs.existsSync(archived)) {
      mismatches.push({ path: rel(root, f), reason: "not present in archive" });
      continue;
    }
    if ((await sha256File(f)) !== (await sha256File(archived))) mismatches.push({ path: rel(root, f), reason: "checksum differs from archive" });
  }
  if (mismatches.length) return { task_id: taskId, status: "REPAIR_BLOCKED", reason: "Residue is not an exact duplicate of archive.", mismatches };

  const preflight = await preflightClosure(root, activeDir, { inputs: [] }, { cleanupInbox: false, includeInbox: false });
  if (!preflight.ok) return { task_id: taskId, ...preflight, repair_action: "Close the listed file(s), then run repair again." };
  await fsp.rm(activeDir, { recursive: true, force: false });
  return { task_id: taskId, status: "REPAIRED", removed_active_residue: rel(root, activeDir), archive_retained: rel(root, archiveDir) };
}

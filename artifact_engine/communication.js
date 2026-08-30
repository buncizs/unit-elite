import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureDir,
  getTask,
  readJson,
  resolveInside,
  saveTask,
  sha256File,
  slugify,
  timestampInfo,
  writeJson,
} from "./runtime.js";

function rel(root, p) {
  return path.relative(root, p).replaceAll(path.sep, "/");
}

function normalizeText(s) {
  return String(s ?? "").trim();
}

function packagePath(taskDir, packageId) {
  return path.join(taskDir, "communication", packageId, "package.json");
}

function validPackageId(id) {
  return /^DELIVERY-[A-Za-z0-9-]+$/.test(String(id || ""));
}

async function getPackage(root, taskId, packageId) {
  if (!validPackageId(packageId)) throw new Error("Invalid DELIVERY package id");
  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  const p = packagePath(taskDir, packageId);
  if (!fs.existsSync(p)) throw new Error(`Delivery package not found: ${packageId}`);
  return { taskDir, taskJsonPath, task, packagePath: p, pkg: await readJson(p) };
}

function normalizeRecipients(recipients = []) {
  return recipients.map((r, idx) => {
    const phone = normalizeText(r.phone_normalized || r.phone || "").replace(/[^0-9]/g, "");
    const hasPhone = Boolean(phone);
    return {
      index: Number.isInteger(r.index) ? r.index : idx + 1,
      target_id: normalizeText(r.target_id || r.npsn || r.recipient_id || `TARGET-${idx + 1}`),
      recipient_type: normalizeText(r.recipient_type || (r.npsn ? "SCHOOL" : "INTERNAL")) || "OTHER",
      npsn: normalizeText(r.npsn || ""),
      school_name: normalizeText(r.school_name || r.nama_sekolah || ""),
      region: normalizeText(r.region || r.kab_kota || ""),
      contact_name: normalizeText(r.contact_name || ""),
      role: normalizeText(r.role || r.jabatan || ""),
      phone_source: normalizeText(r.phone_source || r.phone || ""),
      phone_normalized: phone,
      whatsapp_status: normalizeText(r.whatsapp_status || (hasPhone ? "UNKNOWN" : "NO_NUMBER")),
      contact_status: normalizeText(r.contact_status || (hasPhone ? "CONTACT_AVAILABLE" : "NO_USABLE_CONTACT")),
      identity_status: normalizeText(r.identity_status || "UNVERIFIED"),
      message: normalizeText(r.message || ""),
      human_note: normalizeText(r.human_note || ""),
      machine_note: normalizeText(r.machine_note || ""),
      eligible_for_send: false,
      selected_for_send: false,
      dispatch_status: hasPhone ? "PENDING_APPROVAL" : "SKIPPED_NO_CONTACT",
      dispatch_attempts: [],
    };
  });
}

function summarizeRecipients(recipients) {
  const count = (fn) => recipients.filter(fn).length;
  return {
    total_targets: recipients.length,
    with_phone: count((r) => Boolean(r.phone_normalized)),
    without_phone: count((r) => !r.phone_normalized),
    whatsapp_registered: count((r) => r.whatsapp_status === "REGISTERED"),
    whatsapp_not_registered: count((r) => r.whatsapp_status === "NOT_REGISTERED"),
    whatsapp_unknown: count((r) => ["UNKNOWN", "UNVERIFIED_ACCOUNT"].includes(r.whatsapp_status)),
    identity_conflicts: count((r) => r.identity_status === "IDENTITY_CONFLICT"),
    eligible_for_send: count((r) => r.eligible_for_send),
  };
}

async function validateAttachments(root, taskDir, attachments = []) {
  const out = [];
  for (const item of attachments) {
    const relPath = normalizeText(typeof item === "string" ? item : item.path);
    if (!relPath) throw new Error("Attachment path is required");
    const absolute = resolveInside(root, relPath);
    if (!fs.existsSync(absolute)) throw new Error(`Attachment not found: ${relPath}`);
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) throw new Error(`Attachment is not a file: ${relPath}`);

    // Attachment must belong to this active task. This prevents accidental forwarding of arbitrary project files.
    const relativeToTask = path.relative(taskDir, absolute);
    if (relativeToTask === ".." || relativeToTask.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToTask)) {
      throw new Error(`Attachment must be registered inside the active task before delivery: ${relPath}`);
    }
    const top = relativeToTask.split(path.sep)[0];
    if (!["input", "output", "support"].includes(top)) {
      throw new Error(`Attachment must be inside task input/output/support: ${relPath}`);
    }
    out.push({
      path: rel(root, absolute),
      filename: path.basename(absolute),
      size: stat.size,
      sha256: await sha256File(absolute),
      source_area: top,
    });
  }
  return out;
}

export async function prepareDelivery(root, {
  taskId,
  title,
  channel = "WHATSAPP",
  targetSource = "",
  recipients = [],
  attachments = [],
  notes = "",
}) {
  const { taskDir, taskJsonPath, task } = await getTask(root, taskId);
  await ensureDir(path.join(taskDir, "communication"));
  const ts = await timestampInfo(root);
  const slug = slugify(title || "delivery", 40);
  let packageId = `DELIVERY-${ts.compact}-${slug}`;
  let n = 1;
  while (fs.existsSync(packagePath(taskDir, packageId))) packageId = `DELIVERY-${ts.compact}-${slug}-${n++}`;

  const normalized = normalizeRecipients(recipients);
  if (!normalized.length) throw new Error("Delivery package requires at least one target recipient");
  const targetIds = normalized.map((r) => r.target_id).filter(Boolean);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new Error("Target completeness check failed: duplicate target_id detected. Resolve duplicates before preparing delivery.");
  }

  const checkedAttachments = await validateAttachments(root, taskDir, attachments);
  for (const r of normalized) {
    r.eligible_for_send = Boolean(r.phone_normalized) && (Boolean(r.message) || checkedAttachments.length > 0);
    r.dispatch_status = r.eligible_for_send ? "PENDING_APPROVAL" : (r.phone_normalized ? "SKIPPED_NO_CONTENT" : "SKIPPED_NO_CONTACT");
  }
  if (!normalized.some((r) => r.message) && checkedAttachments.length === 0) {
    throw new Error("Delivery package requires at least a message or an attachment");
  }

  const pkg = {
    schema_version: "1.5",
    package_id: packageId,
    task_id: taskId,
    title: title || packageId,
    channel: String(channel || "WHATSAPP").toUpperCase(),
    state: "READY_FOR_APPROVAL",
    created_at_local: ts.local,
    created_at_iso: new Date().toISOString(),
    target_source: targetSource,
    target_completeness: {
      expected_count: normalized.length,
      output_count: normalized.length,
      invariant: "PASS",
    },
    attachments: checkedAttachments,
    recipients: normalized,
    summary: summarizeRecipients(normalized),
    notes,
    approval: null,
    dispatch: {
      started_at: null,
      completed_at: null,
      selected_count: 0,
      completed_count: 0,
      failed_count: 0,
      skipped_count: normalized.filter((r) => !r.eligible_for_send).length,
    },
  };

  const p = packagePath(taskDir, packageId);
  await writeJson(p, pkg);
  task.communications = task.communications || { packages: [] };
  task.communications.packages = task.communications.packages || [];
  task.communications.packages.push({
    package_id: packageId,
    title: pkg.title,
    channel: pkg.channel,
    state: pkg.state,
    path: rel(root, p),
    total_targets: pkg.summary.total_targets,
  });
  await saveTask(taskJsonPath, task);
  return {
    task_id: taskId,
    package_id: packageId,
    state: pkg.state,
    path: rel(root, p),
    summary: pkg.summary,
    attachment_count: checkedAttachments.length,
    human_approval_required: true,
    next_action: "Present delivery preview to user. Do not send until the user explicitly authorizes with KIRIM PESAN/KIRIM SEMUA or another explicit KIRIM selection command.",
  };
}

export async function deliveryStatus(root, { taskId, packageId }) {
  const { pkg } = await getPackage(root, taskId, packageId);
  return pkg;
}

function selectionFromIndexes(pkg, indexes) {
  const wanted = new Set((indexes || []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0));
  if (!wanted.size) return pkg.recipients.filter((r) => r.eligible_for_send).map((r) => r.index);
  const known = new Set(pkg.recipients.map((r) => r.index));
  for (const x of wanted) if (!known.has(x)) throw new Error(`Selected recipient index not found: ${x}`);
  return [...wanted].sort((a, b) => a - b);
}

export async function approveDelivery(root, { taskId, packageId, confirmationPhrase, selectedIndexes = [] }) {
  const phrase = normalizeText(confirmationPhrase);
  if (!/^KIRIM\b/i.test(phrase)) throw new Error("Approval blocked. User confirmation must explicitly begin with KIRIM.");
  const { taskJsonPath, task, packagePath: p, pkg } = await getPackage(root, taskId, packageId);
  if (pkg.state !== "READY_FOR_APPROVAL") throw new Error(`Approval blocked. Package state is ${pkg.state}.`);

  const selected = selectionFromIndexes(pkg, selectedIndexes);
  if (!selected.length) throw new Error("Approval blocked. No eligible recipient selected.");
  const selectedSet = new Set(selected);
  for (const r of pkg.recipients) {
    r.selected_for_send = selectedSet.has(r.index) && r.eligible_for_send;
    if (r.selected_for_send) r.dispatch_status = "APPROVED_PENDING_DISPATCH";
  }
  pkg.state = "APPROVED";
  pkg.approval = {
    phrase,
    approved_at_iso: new Date().toISOString(),
    selected_indexes: selected,
    selected_count: pkg.recipients.filter((r) => r.selected_for_send).length,
    note: "Approval phrase is recorded from orchestrator workflow. Dispatcher must still call communication_dispatch_guard before every external send.",
  };
  pkg.dispatch.selected_count = pkg.approval.selected_count;
  await writeJson(p, pkg);

  const ref = task.communications?.packages?.find((x) => x.package_id === packageId);
  if (ref) ref.state = pkg.state;
  await saveTask(taskJsonPath, task);
  return {
    task_id: taskId,
    package_id: packageId,
    state: pkg.state,
    selected_indexes: selected,
    selected_count: pkg.approval.selected_count,
    external_send_still_requires_dispatch_guard: true,
  };
}

export async function dispatchGuard(root, { taskId, packageId, recipientIndex }) {
  const { pkg } = await getPackage(root, taskId, packageId);
  if (pkg.state !== "APPROVED" && pkg.state !== "DISPATCHING") throw new Error(`Dispatch blocked. Package state is ${pkg.state}; APPROVED required.`);
  const r = pkg.recipients.find((x) => x.index === Number(recipientIndex));
  if (!r) throw new Error(`Recipient index not found: ${recipientIndex}`);
  if (!r.selected_for_send) throw new Error(`Recipient ${recipientIndex} is not in approved selection.`);
  if (!r.eligible_for_send || !r.phone_normalized) throw new Error(`Recipient ${recipientIndex} is not eligible for send.`);

  const verifiedAttachments = [];
  for (const a of pkg.attachments) {
    const absolute = resolveInside(root, a.path);
    if (!fs.existsSync(absolute)) throw new Error(`Attachment missing at dispatch time: ${a.path}`);
    const hash = await sha256File(absolute);
    if (hash !== a.sha256) throw new Error(`Attachment changed after approval: ${a.path}. Rebuild/reapprove package.`);
    verifiedAttachments.push({ ...a, absolute_path: absolute });
  }

  const token = crypto.createHash("sha256").update(`${packageId}|${r.index}|${pkg.approval?.approved_at_iso}|${r.phone_normalized}`).digest("hex").slice(0, 24);
  return {
    status: "DISPATCH_ALLOWED",
    package_id: packageId,
    recipient_index: r.index,
    recipient: r.phone_normalized,
    message: r.message,
    contact_name: r.contact_name,
    target_id: r.target_id,
    school_name: r.school_name,
    attachments: verifiedAttachments,
    approval_phrase: pkg.approval?.phrase,
    guard_token: token,
    instruction: "Use only the approved recipient/message/attachments returned here. Do not alter recipient or substitute another file during dispatch.",
  };
}

export async function recordDispatch(root, {
  taskId,
  packageId,
  recipientIndex,
  outcome,
  backend = "MANUAL_OR_EXTERNAL",
  backendMessage = "",
  messageSent = false,
  filesSent = [],
}) {
  const allowed = ["SENT", "FAILED", "SKIPPED", "DELIVERED", "READ"];
  const normalizedOutcome = String(outcome || "").toUpperCase();
  if (!allowed.includes(normalizedOutcome)) throw new Error(`Invalid dispatch outcome: ${outcome}`);
  const { taskJsonPath, task, packagePath: p, pkg } = await getPackage(root, taskId, packageId);
  const r = pkg.recipients.find((x) => x.index === Number(recipientIndex));
  if (!r) throw new Error(`Recipient index not found: ${recipientIndex}`);
  if (!["APPROVED", "DISPATCHING", "PARTIAL_SENT", "SENT_WITH_ERRORS", "DISPATCHED"].includes(pkg.state)) {
    throw new Error(`Dispatch record blocked. Package state is ${pkg.state}`);
  }
  if (!r.selected_for_send && !["SKIPPED"].includes(normalizedOutcome)) throw new Error(`Recipient ${recipientIndex} was not approved for dispatch.`);

  const now = new Date().toISOString();
  r.dispatch_attempts = r.dispatch_attempts || [];
  r.dispatch_attempts.push({
    timestamp_iso: now,
    outcome: normalizedOutcome,
    backend,
    backend_message: backendMessage,
    message_sent: Boolean(messageSent),
    files_sent: Array.isArray(filesSent) ? filesSent : [],
  });
  r.dispatch_status = normalizedOutcome;
  if (!pkg.dispatch.started_at) pkg.dispatch.started_at = now;
  pkg.state = "DISPATCHING";

  const selected = pkg.recipients.filter((x) => x.selected_for_send);
  const terminal = selected.filter((x) => ["SENT", "FAILED", "SKIPPED", "DELIVERED", "READ"].includes(x.dispatch_status));
  const failed = selected.filter((x) => x.dispatch_status === "FAILED");
  pkg.dispatch.completed_count = terminal.length;
  pkg.dispatch.failed_count = failed.length;
  if (terminal.length === selected.length) {
    pkg.dispatch.completed_at = now;
    pkg.state = failed.length ? "SENT_WITH_ERRORS" : "DISPATCHED";
  } else if (terminal.length > 0) {
    pkg.state = "PARTIAL_SENT";
  }
  await writeJson(p, pkg);

  const ref = task.communications?.packages?.find((x) => x.package_id === packageId);
  if (ref) ref.state = pkg.state;
  await saveTask(taskJsonPath, task);
  return {
    task_id: taskId,
    package_id: packageId,
    recipient_index: r.index,
    outcome: normalizedOutcome,
    package_state: pkg.state,
    completed_count: pkg.dispatch.completed_count,
    selected_count: pkg.dispatch.selected_count,
    failed_count: pkg.dispatch.failed_count,
  };
}

export async function cancelDelivery(root, { taskId, packageId, reason = "Cancelled by user" }) {
  const { taskJsonPath, task, packagePath: p, pkg } = await getPackage(root, taskId, packageId);
  if (["DISPATCHING", "PARTIAL_SENT", "DISPATCHED", "SENT_WITH_ERRORS"].includes(pkg.state)) {
    throw new Error(`Cannot cancel package after dispatch has begun. Current state: ${pkg.state}`);
  }
  pkg.state = "CANCELLED";
  pkg.cancelled_at_iso = new Date().toISOString();
  pkg.cancel_reason = reason;
  await writeJson(p, pkg);
  const ref = task.communications?.packages?.find((x) => x.package_id === packageId);
  if (ref) ref.state = pkg.state;
  await saveTask(taskJsonPath, task);
  return { task_id: taskId, package_id: packageId, state: pkg.state, reason };
}

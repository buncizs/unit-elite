import { tool } from "@opencode-ai/plugin";
import {
  MAX_RECIPIENTS, SEND_DELAY_MS,
  resolveRecipientToken, verifyNumbers, packageId, snapshotHash,
  savePackage, loadPackage, dispatchId, sendOne, sleep,
  logDispatch, logPackage, cleanText,
  bridgeOperationalStatus, exportFallbackExcel
} from "./lib/communication_v2_core.js";

function publicRecipient(r) {
  return {
    input:r.input,
    contact_id:r.contact_id || null,
    display_name:r.display_name || null,
    institution:r.institution || null,
    phone:r.phone || null,
    resolve_status:r.status,
    whatsapp_status:r.whatsapp_status || null,
    send_status:r.send_status || null
  };
}
function approvalNormalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const explicitApprovals = new Set([
  "KIRIM",
  "KIRIM SEMUA",
  "YA KIRIM",
  "KIRIMKAN",
  "LANJUT KIRIM",
  "SILAKAN KIRIM"
]);
function fallbackResponse(pkg, bridge, extra={}) {
  return {
    status:"BRIDGE_UNAVAILABLE",
    service_id:"SERVICE-COMM-WHATSAPP",
    package_id:pkg.package_id,
    package_state:pkg.status,
    bridge_status:bridge?.status || pkg.transport_status || "UNAVAILABLE",
    bridge_reason:bridge?.reason || pkg.transport_reason || "bridge_unavailable",
    message:pkg.message,
    recipients:(pkg.recipients || []).filter(r => r.status === "RESOLVED" && r.phone && r.send_status !== "SENT").map(publicRecipient),
    fallback_question:"Saat ini WhatsApp Bridge sedang dalam perbaikan/tidak tersedia. Apakah daftar pengiriman akan dikeluarkan sebagai Excel berisi link wa.me dan isi pesan?",
    if_yes:{action:"export_excel"},
    if_no:{question:"Apakah akan menunggu bridge atau membatalkan kirim pesan?",options:["wait","cancel"]},
    ...extra
  };
}
async function verifyIntoPackage(pkg) {
  const valid = (pkg.recipients || []).filter(r => r.status === "RESOLVED" && r.phone);
  const verify = await verifyNumbers(valid.map(r => r.phone));

  for (let i=0;i<pkg.recipients.length;i++) {
    const r = pkg.recipients[i];
    if (r.status !== "RESOLVED" || !r.phone) continue;
    const v = verify.get(r.phone) || {registered:false,status:"VERIFY_UNKNOWN"};
    r.whatsapp_status = v.status;
    r.registered = !!v.registered;
    r.send_status = r.registered ? (r.send_status === "SENT" ? "SENT" : "PENDING") : null;
    pkg.recipients[i] = r;
  }

  const approved = pkg.recipients.filter(r => r.registered && r.phone && r.send_status !== "SENT");
  pkg.approved_recipient_phones = approved.map(r => r.phone);
  pkg.snapshot_hash = snapshotHash(pkg.message, approved);
  return approved;
}

export default tool({
  description: "Unit Elite WhatsApp Communication Gateway V2 with transport-aware Excel wa.me fallback. No normal TASK-ID and no recipient index. When bridge is unavailable or suspended, preserve the package and offer export_excel, wait, or cancel instead of failing the communication task.",
  args: {
    action: tool.schema.string(),
    recipients: tool.schema.array(tool.schema.string()).optional(),
    message: tool.schema.string().optional(),
    package_id: tool.schema.string().optional(),
    approval_phrase: tool.schema.string().optional(),
    parent_task: tool.schema.string().optional()
  },

  async execute(args) {
    const action = String(args.action || "").toLowerCase();

    if (action === "bridge_status") {
      return JSON.stringify(await bridgeOperationalStatus(), null, 2);
    }

    if (action === "prepare") {
      const message = cleanText(args.message || "");
      const tokens = Array.isArray(args.recipients) ? args.recipients.map(cleanText).filter(Boolean) : [];

      if (!message) return JSON.stringify({status:"INVALID_REQUEST",reason:"message required"});
      if (!tokens.length) return JSON.stringify({status:"INVALID_REQUEST",reason:"at least one recipient required"});
      if (tokens.length > MAX_RECIPIENTS) {
        return JSON.stringify({status:"TOO_MANY_RECIPIENTS",max:MAX_RECIPIENTS,requested:tokens.length});
      }

      const resolvedRaw = tokens.map(resolveRecipientToken);
      const seen = new Set();
      const resolved = [];
      let duplicatesRemoved = 0;

      for (const r of resolvedRaw) {
        if (r.status === "RESOLVED" && r.phone) {
          if (seen.has(r.phone)) { duplicatesRemoved++; continue; }
          seen.add(r.phone);
        }
        resolved.push(r);
      }

      const valid = resolved.filter(r => r.status === "RESOLVED" && r.phone);
      const bridge = await bridgeOperationalStatus();
      const id = packageId();

      const pkg = {
        version:2,
        service_id:"SERVICE-COMM-WHATSAPP",
        package_id:id,
        parent_task:args.parent_task || null,
        status:"PREPARING",
        created_at:new Date().toISOString(),
        message,
        requested_count:tokens.length,
        duplicates_removed:duplicatesRemoved,
        recipients:resolved.map(r => ({
          ...r,
          registered:false,
          whatsapp_status:r.status === "RESOLVED" ? "NOT_VERIFIED" : null,
          send_status:r.status === "RESOLVED" ? "PENDING" : null
        })),
        approved_recipient_phones:[],
        snapshot_hash:snapshotHash(message, valid),
        human_approval_required:true,
        transport_status:bridge.status,
        transport_reason:bridge.reason || null
      };

      if (!bridge.ready) {
        pkg.status = "BRIDGE_UNAVAILABLE";
        for (let i=0;i<pkg.recipients.length;i++) {
          const r = pkg.recipients[i];
          if (r.status === "RESOLVED" && r.phone) {
            r.whatsapp_status = "NOT_VERIFIED_BRIDGE_UNAVAILABLE";
            r.send_status = "PENDING_FALLBACK";
            pkg.recipients[i] = r;
          }
        }
        savePackage(pkg);
        logPackage({
          package_id:pkg.package_id,
          timestamp:new Date().toISOString(),
          status:pkg.status,
          requested:pkg.requested_count,
          bridge_status:bridge.status,
          bridge_reason:bridge.reason || null,
          event:"PREPARED_WITH_FALLBACK"
        });
        return JSON.stringify(fallbackResponse(pkg, bridge, {
          requested:tokens.length,
          unique_after_dedup:tokens.length-duplicatesRemoved,
          duplicates_removed:duplicatesRemoved,
          unresolved:resolved.filter(r => r.status !== "RESOLVED").map(publicRecipient)
        }), null, 2);
      }

      let approvedRecipients = [];
      try {
        approvedRecipients = await verifyIntoPackage(pkg);
      } catch (e) {
        const degraded = {
          ready:false,
          status:"VERIFY_BACKEND_ERROR",
          reason:String(e?.message || e)
        };
        pkg.status = "BRIDGE_UNAVAILABLE";
        pkg.transport_status = degraded.status;
        pkg.transport_reason = degraded.reason;
        for (let i=0;i<pkg.recipients.length;i++) {
          const r = pkg.recipients[i];
          if (r.status === "RESOLVED" && r.phone && r.send_status !== "SENT") {
            r.whatsapp_status = "VERIFY_ERROR";
            r.send_status = "PENDING_FALLBACK";
            pkg.recipients[i] = r;
          }
        }
        savePackage(pkg);
        return JSON.stringify(fallbackResponse(pkg, degraded), null, 2);
      }

      pkg.status = approvedRecipients.length ? "READY_FOR_APPROVAL" : "NO_VALID_RECIPIENTS";
      pkg.transport_status = "READY";
      pkg.transport_reason = null;
      savePackage(pkg);

      const validRecipients = pkg.recipients.filter(r => r.status === "RESOLVED" && r.phone);

      return JSON.stringify({
        status:pkg.status,
        service_id:pkg.service_id,
        package_id:id,
        requested:tokens.length,
        unique_after_dedup:tokens.length-duplicatesRemoved,
        duplicates_removed:duplicatesRemoved,
        ready_to_send:approvedRecipients.length,
        unresolved:pkg.recipients.filter(r => r.status !== "RESOLVED").map(publicRecipient),
        not_registered:validRecipients.filter(r => !r.registered).map(publicRecipient),
        recipients:approvedRecipients.map(publicRecipient),
        message,
        approval_required:approvedRecipients.length ? "EXPLICIT_SEND_APPROVAL" : null,
        instruction:approvedRecipients.length
          ? "Show one consolidated preview. Wait for one explicit send approval, then call action=dispatch exactly once."
          : "No dispatchable recipients."
      }, null, 2);
    }

    if (action === "export_excel") {
      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND",package_id:args.package_id});
      if (pkg.status === "CANCELLED_BY_USER") {
        return JSON.stringify({status:"PACKAGE_CANCELLED",package_id:pkg.package_id});
      }

      const reason = pkg.transport_reason || pkg.transport_status || "bridge_unavailable";
      const out = exportFallbackExcel(pkg, reason);
      pkg.status_before_export = pkg.status;
      pkg.status = "EXPORTED_EXCEL";
      pkg.exported_at = new Date().toISOString();
      pkg.export_file = out.file_path;
      savePackage(pkg);

      logPackage({
        package_id:pkg.package_id,
        timestamp:pkg.exported_at,
        status:pkg.status,
        event:"FALLBACK_EXCEL_EXPORTED",
        file:out.file_path,
        recipients:out.recipient_count
      });

      return JSON.stringify({
        status:"EXPORTED_EXCEL",
        service_id:pkg.service_id,
        package_id:pkg.package_id,
        filename:out.filename,
        file_path:out.file_path,
        recipient_count:out.recipient_count,
        instruction:"Present the Excel file/path to the user. The file contains clickable wa.me links with the message prefilled. No WhatsApp message was sent automatically."
      }, null, 2);
    }

    if (action === "wait") {
      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND"});
      if (["SENT","CANCELLED_BY_USER"].includes(pkg.status)) {
        return JSON.stringify({status:"PACKAGE_NOT_WAITABLE",package_state:pkg.status});
      }

      pkg.status = "WAITING_FOR_BRIDGE";
      pkg.waiting_since = new Date().toISOString();
      savePackage(pkg);
      logPackage({
        package_id:pkg.package_id,
        timestamp:pkg.waiting_since,
        status:pkg.status,
        event:"WAIT_FOR_BRIDGE"
      });

      return JSON.stringify({
        status:"WAITING_FOR_BRIDGE",
        package_id:pkg.package_id,
        auto_send:false,
        instruction:"Do not auto-send when the bridge returns. On a later user request, call action=resume; show a fresh preview and require explicit human approval again."
      }, null, 2);
    }

    if (action === "cancel") {
      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND"});
      if (pkg.status === "SENT") return JSON.stringify({status:"PACKAGE_ALREADY_SENT",package_id:pkg.package_id});

      pkg.status = "CANCELLED_BY_USER";
      pkg.cancelled_at = new Date().toISOString();
      savePackage(pkg);
      logPackage({
        package_id:pkg.package_id,
        timestamp:pkg.cancelled_at,
        status:pkg.status,
        event:"CANCELLED_BY_USER"
      });

      return JSON.stringify({
        status:"CANCELLED_BY_USER",
        package_id:pkg.package_id,
        sent:0,
        instruction:"Package retained for audit history; no message was sent."
      }, null, 2);
    }

    if (action === "resume") {
      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND"});
      if (!["WAITING_FOR_BRIDGE","BRIDGE_UNAVAILABLE"].includes(pkg.status)) {
        return JSON.stringify({status:"PACKAGE_NOT_RESUMABLE",package_state:pkg.status});
      }

      const bridge = await bridgeOperationalStatus();
      if (!bridge.ready) {
        pkg.transport_status = bridge.status;
        pkg.transport_reason = bridge.reason || null;
        savePackage(pkg);
        return JSON.stringify({
          ...fallbackResponse(pkg, bridge),
          status:"WAITING_FOR_BRIDGE",
          auto_send:false
        }, null, 2);
      }

      let approvedRecipients = [];
      try {
        approvedRecipients = await verifyIntoPackage(pkg);
      } catch (e) {
        const degraded = {ready:false,status:"VERIFY_BACKEND_ERROR",reason:String(e?.message || e)};
        pkg.status = "WAITING_FOR_BRIDGE";
        pkg.transport_status = degraded.status;
        pkg.transport_reason = degraded.reason;
        savePackage(pkg);
        return JSON.stringify(fallbackResponse(pkg, degraded), null, 2);
      }

      pkg.transport_status = "READY";
      pkg.transport_reason = null;
      pkg.resumed_at = new Date().toISOString();
      pkg.status = approvedRecipients.length ? "READY_FOR_APPROVAL" : "NO_VALID_RECIPIENTS";
      savePackage(pkg);

      return JSON.stringify({
        status:pkg.status,
        package_id:pkg.package_id,
        resumed:true,
        auto_send:false,
        recipients:approvedRecipients.map(publicRecipient),
        not_registered:pkg.recipients.filter(r => r.status === "RESOLVED" && r.phone && !r.registered).map(publicRecipient),
        message:pkg.message,
        approval_required:approvedRecipients.length ? "EXPLICIT_SEND_APPROVAL" : null,
        instruction:approvedRecipients.length
          ? "Bridge is back. Show a fresh consolidated preview and require explicit human approval before dispatch."
          : "Bridge is back, but no recipients are dispatchable."
      }, null, 2);
    }

    if (action === "dispatch") {
      const approvalNorm = approvalNormalize(args.approval_phrase);
      if (!explicitApprovals.has(approvalNorm)) {
        return JSON.stringify({
          status:"WAITING_FOR_HUMAN_APPROVAL",
          required:"explicit send approval",
          accepted_examples:["KIRIM","KIRIM SEMUA","YA KIRIM","KIRIMKAN","LANJUT KIRIM","SILAKAN KIRIM"]
        });
      }

      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND",package_id:args.package_id});
      if (!["READY_FOR_APPROVAL","DISPATCHING"].includes(pkg.status)) {
        return JSON.stringify({status:"PACKAGE_NOT_DISPATCHABLE",package_state:pkg.status});
      }

      const bridge = await bridgeOperationalStatus();
      if (!bridge.ready) {
        pkg.status = "BRIDGE_UNAVAILABLE";
        pkg.transport_status = bridge.status;
        pkg.transport_reason = bridge.reason || null;
        savePackage(pkg);
        return JSON.stringify(fallbackResponse(pkg, bridge, {
          approval_received:approvalNorm,
          dispatch:false
        }), null, 2);
      }

      const sendable = pkg.recipients.filter(r => r.registered && r.phone && r.send_status !== "SENT");
      const currentHash = snapshotHash(pkg.message, sendable);
      if (currentHash !== pkg.snapshot_hash) {
        return JSON.stringify({status:"SNAPSHOT_CHANGED_AFTER_PREVIEW",dispatch:false});
      }

      pkg.status = "DISPATCHING";
      pkg.approved_at = pkg.approved_at || new Date().toISOString();
      pkg.transport_status = "READY";
      pkg.transport_reason = null;
      savePackage(pkg);

      for (let i=0; i<pkg.recipients.length; i++) {
        const r = pkg.recipients[i];
        if (!r.registered || !r.phone || r.send_status === "SENT") continue;

        const did = dispatchId();
        const started = new Date().toISOString();
        let result;
        try {
          result = await sendOne(r.phone, pkg.message);
        } catch (e) {
          result = {success:false,http_status:null,response:{error:String(e?.message || e)}};
        }

        r.dispatch_id = did;
        r.attempted_at = started;
        r.send_status = result.success ? "SENT" : "FAILED";
        r.http_status = result.http_status;
        r.backend_response = result.response;
        pkg.recipients[i] = r;
        savePackage(pkg);

        logDispatch({
          dispatch_id:did,
          package_id:pkg.package_id,
          timestamp:started,
          recipient:r.phone,
          recipient_name:r.display_name || null,
          institution:r.institution || null,
          message:pkg.message,
          status:r.send_status,
          parent_task:pkg.parent_task || null,
          approval:approvalNorm,
          backend:"WHATSAPP_GO_BRIDGE",
          http_status:result.http_status
        });

        await sleep(SEND_DELAY_MS);
      }

      const attempted = pkg.recipients.filter(r => r.registered && r.phone);
      const sent = attempted.filter(r => r.send_status === "SENT").length;
      const failed = attempted.filter(r => r.send_status === "FAILED").length;

      pkg.completed_at = new Date().toISOString();
      pkg.status = sent === attempted.length && attempted.length > 0
        ? "SENT"
        : sent > 0
          ? "SENT_WITH_ERRORS"
          : "FAILED";
      savePackage(pkg);

      logPackage({
        package_id:pkg.package_id,
        timestamp:pkg.completed_at,
        requested:pkg.requested_count,
        dispatchable:attempted.length,
        sent,
        failed,
        status:pkg.status,
        parent_task:pkg.parent_task || null
      });

      return JSON.stringify({
        status:pkg.status,
        service_id:"SERVICE-COMM-WHATSAPP",
        package_id:pkg.package_id,
        requested:pkg.requested_count,
        dispatchable:attempted.length,
        sent,
        failed,
        results:attempted.map(publicRecipient)
      }, null, 2);
    }

    if (action === "status") {
      if (!args.package_id) return JSON.stringify({status:"INVALID_REQUEST",reason:"package_id required"});
      const pkg = loadPackage(args.package_id);
      if (!pkg) return JSON.stringify({status:"PACKAGE_NOT_FOUND"});
      const bridge = await bridgeOperationalStatus();

      return JSON.stringify({
        status:pkg.status,
        service_id:pkg.service_id,
        package_id:pkg.package_id,
        created_at:pkg.created_at,
        completed_at:pkg.completed_at || null,
        bridge_status:bridge.status,
        bridge_ready:bridge.ready,
        export_file:pkg.export_file || null,
        auto_send:false,
        recipients:pkg.recipients.map(publicRecipient)
      }, null, 2);
    }

    return JSON.stringify({
      status:"INVALID_ACTION",
      allowed:["prepare","dispatch","status","bridge_status","export_excel","wait","cancel","resume"]
    });
  }
});

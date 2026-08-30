import { tool } from "@opencode-ai/plugin";
import { prepareDelivery } from "../../artifact_engine/communication.js";

export default tool({
  description: "Membuat Delivery Package dari target, pesan, dan attachment task. HANYA menyiapkan paket READY_FOR_APPROVAL; tool ini TIDAK mengirim apa pun.",
  args: {
    task_id: tool.schema.string(),
    title: tool.schema.string(),
    channel: tool.schema.string().describe("Default WHATSAPP"),
    target_source: tool.schema.string().describe("Sumber daftar target, mis. nama file/lampiran"),
    recipients_json: tool.schema.string().describe("JSON array target. Setiap target minimal target_id, phone_normalized bila ada, message; sekolah dapat menyertakan npsn/school_name/region/contact_name/role/status."),
    attachments_json: tool.schema.string().describe("JSON array path attachment yang sudah berada di task input/output/support"),
    notes: tool.schema.string(),
  },
  async execute(args, context) {
    let recipients, attachments;
    try { recipients = JSON.parse(args.recipients_json); } catch (e) { throw new Error(`recipients_json tidak valid: ${e.message}`); }
    try { attachments = JSON.parse(args.attachments_json); } catch (e) { throw new Error(`attachments_json tidak valid: ${e.message}`); }
    return JSON.stringify(await prepareDelivery((context.directory || context.worktree || process.cwd()), {
      taskId: args.task_id,
      title: args.title,
      channel: args.channel || "WHATSAPP",
      targetSource: args.target_source,
      recipients,
      attachments,
      notes: args.notes,
    }), null, 2);
  }
});

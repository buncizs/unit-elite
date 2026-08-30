import { tool } from "@opencode-ai/plugin";
import { recordDispatch } from "../../artifact_engine/communication.js";

export default tool({
  description: "Mencatat hasil dispatch eksternal ke audit log Delivery Package. Hanya pencatatan; tidak mengirim.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
    recipient_index: tool.schema.number(),
    outcome: tool.schema.string().describe("SENT|FAILED|SKIPPED|DELIVERED|READ"),
    backend: tool.schema.string(),
    backend_message: tool.schema.string(),
    message_sent: tool.schema.boolean(),
    files_sent_json: tool.schema.string().describe("JSON array nama/path file yang benar-benar dikirim"),
  },
  async execute(args, context) {
    let filesSent;
    try { filesSent = JSON.parse(args.files_sent_json || "[]"); } catch (e) { throw new Error(`files_sent_json tidak valid: ${e.message}`); }
    return JSON.stringify(await recordDispatch((context.directory || context.worktree || process.cwd()), {
      taskId: args.task_id,
      packageId: args.package_id,
      recipientIndex: args.recipient_index,
      outcome: args.outcome,
      backend: args.backend,
      backendMessage: args.backend_message,
      messageSent: args.message_sent,
      filesSent,
    }), null, 2);
  }
});

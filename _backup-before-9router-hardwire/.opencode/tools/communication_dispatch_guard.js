import { tool } from "@opencode-ai/plugin";
import { dispatchGuard } from "../../artifact_engine/communication.js";

export default tool({
  description: "Gate wajib sebelum setiap pengiriman eksternal. Memastikan package APPROVED, target termasuk selection manusia, dan attachment belum berubah. Tool ini TIDAK mengirim.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
    recipient_index: tool.schema.number(),
  },
  async execute(args, context) {
    return JSON.stringify(await dispatchGuard((context.directory || context.worktree || process.cwd()), {
      taskId: args.task_id,
      packageId: args.package_id,
      recipientIndex: args.recipient_index,
    }), null, 2);
  }
});

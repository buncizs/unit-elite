import { tool } from "@opencode-ai/plugin";
import { cancelDelivery } from "../../artifact_engine/communication.js";

export default tool({
  description: "Membatalkan Delivery Package sebelum dispatch dimulai. Tidak menghapus task atau artifact.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
    reason: tool.schema.string(),
  },
  async execute(args, context) {
    return JSON.stringify(await cancelDelivery((context.directory || context.worktree || process.cwd()), {
      taskId: args.task_id,
      packageId: args.package_id,
      reason: args.reason,
    }), null, 2);
  }
});

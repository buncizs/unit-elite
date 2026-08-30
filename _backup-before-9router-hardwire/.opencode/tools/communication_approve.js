import { tool } from "@opencode-ai/plugin";
import { approveDelivery } from "../../artifact_engine/communication.js";

export default tool({
  description: "Mencatat persetujuan eksplisit manusia untuk Delivery Package. HANYA boleh dipanggil setelah pesan USER saat ini memberi perintah kirim eksplisit. Tidak mengirim pesan.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
    confirmation_phrase: tool.schema.string().describe("Salin perintah eksplisit user yang diawali KIRIM, mis. KIRIM PESAN / KIRIM SEMUA / KIRIM NOMOR 1-10"),
    selected_indexes_json: tool.schema.string().describe("JSON array indeks target yang disetujui. [] berarti semua target eligible."),
  },
  async execute(args, context) {
    let selectedIndexes;
    try { selectedIndexes = JSON.parse(args.selected_indexes_json || "[]"); } catch (e) { throw new Error(`selected_indexes_json tidak valid: ${e.message}`); }
    return JSON.stringify(await approveDelivery((context.directory || context.worktree || process.cwd()), {
      taskId: args.task_id,
      packageId: args.package_id,
      confirmationPhrase: args.confirmation_phrase,
      selectedIndexes,
    }), null, 2);
  }
});

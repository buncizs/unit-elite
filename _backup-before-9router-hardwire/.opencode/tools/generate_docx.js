import { tool } from "@opencode-ai/plugin";
import { generateDocx } from "../../artifact_engine/docx.js";

export default tool({
  description: "Menghasilkan DOCX nyata dari master Tata Naskah Dinas Jatim v1.2. File disimpan di output task dan terdaftar pada task.json.",
  args: {
    task_id: tool.schema.string(),
    template_key: tool.schema.string().describe("nota-dinas | telaahan-staf | surat-dinas | surat-undangan | surat-tugas | surat-edaran | keputusan-gubernur | generic-draft"),
    filename: tool.schema.string().describe("Nama file output .docx"),
    fields_json: tool.schema.string().describe("JSON object field template. Field yang tidak diisi akan terlihat sebagai <<BELUM DIISI:FIELD>>.")
  },
  async execute(args, context) {
    let fields;
    try { fields = JSON.parse(args.fields_json); } catch (e) { throw new Error(`fields_json tidak valid: ${e.message}`); }
    return JSON.stringify(await generateDocx((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, templateKey: args.template_key, filename: args.filename, fields }), null, 2);
  }
});

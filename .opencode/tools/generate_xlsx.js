import { tool } from "@opencode-ai/plugin";
import { generateXlsx } from "../../artifact_engine/xlsx.js";

export default tool({
  description: "Menghasilkan workbook XLSX nyata untuk matriks/rekap data dari spesifikasi JSON.",
  args: {
    task_id: tool.schema.string(),
    filename: tool.schema.string(),
    workbook_json: tool.schema.string().describe("JSON: {sheets:[{name,headers,rows,note?,bold_rows?}]} ; bold_rows = nomor baris data (1-based, header tidak dihitung) yang harus tebal")
  },
  async execute(args, context) {
    let workbook;
    try { workbook = JSON.parse(args.workbook_json); } catch (e) { throw new Error(`workbook_json tidak valid: ${e.message}`); }
    return JSON.stringify(await generateXlsx((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, filename: args.filename, workbook }), null, 2);
  }
});

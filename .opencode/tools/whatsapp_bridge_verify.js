import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Memverifikasi nomor melalui OPTIONAL patched local bridge /api/verify. Jika upstream belum dipatch, kembalikan UNSUPPORTED; tidak menebak hasil.",
  args: {
    numbers_json: tool.schema.string().describe("JSON array nomor normalized 62..."),
    bridge_url: tool.schema.string().describe("Default http://127.0.0.1:8080/api"),
  },
  async execute(args) {
    let numbers;
    try { numbers=JSON.parse(args.numbers_json); } catch(e) { throw new Error(`numbers_json tidak valid: ${e.message}`); }
    if(!Array.isArray(numbers) || !numbers.length) throw new Error("numbers_json must be a non-empty array");
    numbers=numbers.map(x=>String(x).replace(/\D/g,"")).filter(Boolean);
    const base=(args.bridge_url || "http://127.0.0.1:8080/api").replace(/\/$/,"");
    try {
      const r=await fetch(`${base}/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({numbers}),signal:AbortSignal.timeout(5000)});
      if(r.status===404 || r.status===405) return JSON.stringify({status:"UNSUPPORTED",reason:"Local bridge does not expose /api/verify. Apply the Unit Elite verification patch/adaptor first.",results:numbers.map(number=>({number,registered:null,status:"UNKNOWN"}))},null,2);
      const text=await r.text();
      if(!r.ok) return JSON.stringify({status:"VERIFY_FAILED",http_status:r.status,error:text,results:numbers.map(number=>({number,registered:null,status:"UNKNOWN"}))},null,2);
      let data; try{data=JSON.parse(text)}catch{data={raw:text}}
      return JSON.stringify({status:"OK",backend:"whatsapp-go-bridge",data},null,2);
    } catch(e) {
      return JSON.stringify({status:"BACKEND_NOT_CONNECTED",error:String(e?.message||e),results:numbers.map(number=>({number,registered:null,status:"UNKNOWN"}))},null,2);
    }
  }
});

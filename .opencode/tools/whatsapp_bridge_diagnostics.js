import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Read-only diagnostic untuk local WhatsApp Go bridge Unit Elite pilot. Tidak mengirim pesan.",
  args: {
    bridge_url: tool.schema.string().describe("Base API URL, default http://127.0.0.1:8080/api"),
  },
  async execute(args) {
    const base=(args.bridge_url || "http://127.0.0.1:8080/api").replace(/\/$/,"");
    try {
      const h=await fetch(`${base}/health`,{method:"GET",signal:AbortSignal.timeout(2500)});
      if(h.ok){
        let data; try{data=await h.json()}catch{data={}}
        return JSON.stringify({status:data?.connected===false?"BRIDGE_ONLINE_NOT_CONNECTED":"BRIDGE_ONLINE",connected:data?.connected??null,http_status:h.status,base_url:base,send_attempted:false,health_endpoint:true},null,2);
      }
      if(h.status!==404){
        return JSON.stringify({status:"BRIDGE_RESPONDED",http_status:h.status,base_url:base,send_attempted:false,health_endpoint:true},null,2);
      }
      const r=await fetch(`${base}/send`,{method:"GET",signal:AbortSignal.timeout(2500)});
      return JSON.stringify({status:[405,400].includes(r.status)?"BRIDGE_ONLINE_LEGACY":"BRIDGE_RESPONDED",http_status:r.status,base_url:base,send_attempted:false,health_endpoint:false},null,2);
    } catch(e) {
      return JSON.stringify({status:"BRIDGE_OFFLINE",base_url:base,send_attempted:false,error:String(e?.message||e)},null,2);
    }
  }
});

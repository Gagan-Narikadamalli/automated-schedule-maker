async function main() {
/** One-time Vercel build smoke test. Do not leave this in the normal build pipeline. */
const key = process.env.OLLAMA_API_KEY?.trim();
const model = process.env.OLLAMA_SCHEDULER_MODEL?.trim() || "gpt-oss:20b";
if (!key || !model) throw new Error("Ollama API key or scheduling model is not configured in this deployment.");
const controller = new AbortController();
const t = Date.now();
const timeout = setTimeout(()=>controller.abort(),40000);
try {
  const response=await fetch("https://ollama.com/api/chat",{
    method:"POST",
    headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,stream:false,format:"json",
      messages:[{role:"system",content:"You are an assistant integrated into an automated scheduling website. Respond with short valid JSON only."},
        {role:"user",content:"Return JSON with one field: ready true."}],
      options:{temperature:0}}),
    signal:controller.signal,cache:"no-store",
  });
  if(!response.ok)throw new Error(`Ollama cloud returned HTTP ${response.status}; check model and token in Vercel.`);
  const data=await response.json() as {message?:{content?:string}};
  if(!data.message?.content?.trim())throw new Error("Ollama returned an empty completion.");
  const parsed=JSON.parse(data.message.content) as Record<string,unknown>;
  if(typeof parsed!=="object"||parsed===null)throw new Error("Ollama returned invalid JSON.");
  console.log(`Ollama scheduling model connection succeeded in ${Date.now()-t}ms (one minimal API request).`);
} finally {clearTimeout(timeout);}

}
void main().catch(error=>{ console.error(error instanceof Error?error.message:'Ollama test failed');process.exitCode=1; });

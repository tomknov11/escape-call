import { DurableObject } from "cloudflare:workers";

const SOURCES = {
  secom: { label: "SECOM監視センター", caseName: "アペゼビルの件" },
  alsok: { label: "ALSOK監視センター", caseName: "中央駐車場の件" },
  nishikei: { label: "にしけい監視センター", caseName: "セントラルビルの件" }
};

const ALLOWED_MINUTES = new Set([1, 3, 5, 10, 30, 60]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function isAuthorized(request, env) {
  const supplied = request.headers.get("x-app-pin") || "";
  const expected = env.APP_PIN || "";
  const encoder = new TextEncoder();
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  return crypto.subtle.timingSafeEqual(suppliedHash, expectedHash) && expected.length > 0;
}

export class CallJob extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async create(source, runAt) {
    await this.ctx.storage.put("source", source);
    await this.ctx.storage.put("runAt", runAt);
    await this.ctx.storage.put("cancelled", false);
    await this.ctx.storage.setAlarm(runAt);
  }

  async cancel() {
    await this.ctx.storage.put("cancelled", true);
    await this.ctx.storage.put("cancelledAt", Date.now());
    await this.ctx.storage.deleteAlarm();
  }

  async status() {
    const values = await this.ctx.storage.get([
      "source", "runAt", "cancelled", "cancelledAt", "dispatchedAt",
      "lastDispatchStatus", "lastDispatchError"
    ]);
    return Object.fromEntries(values);
  }

  async alarm() {
    const cancelled = await this.ctx.storage.get("cancelled");
    if (cancelled) return;

    const source = await this.ctx.storage.get("source");
    if (!source || !(source in SOURCES)) return;

    const owner = String(this.env.GITHUB_OWNER || "").trim();
    const repo = String(this.env.GITHUB_REPO || "").trim();
    const workflow = String(this.env.GITHUB_WORKFLOW || "call.yml").trim();
    const token = String(this.env.GITHUB_TOKEN || "").trim();
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
    console.log(JSON.stringify({ event: "dispatch_start", source, scheduledAt: await this.ctx.storage.get("runAt") }));
    await this.ctx.storage.put("dispatchedAt", Date.now());

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${token}`,
          "accept": "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "escape-call-worker",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { source }
        })
      });
    } catch (error) {
      await this.ctx.storage.put("lastDispatchError", String(error).slice(0, 2000));
      console.error(JSON.stringify({ event: "dispatch_failed", source, error: String(error) }));
      throw error;
    }

    await this.ctx.storage.put("lastDispatchStatus", response.status);

    if (!response.ok) {
      const body = await response.text();
      await this.ctx.storage.put("lastDispatchError", body.slice(0, 2000));
      console.error(JSON.stringify({ event: "dispatch_failed", source, status: response.status }));
      throw new Error(`GitHub dispatch failed: ${response.status} ${body}`);
    }
    console.log(JSON.stringify({ event: "dispatch_succeeded", source, status: response.status }));
  }
}

const APP_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#101114">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Escape Call</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:#101114;color:#fff}
main{max-width:520px;margin:auto;padding:calc(env(safe-area-inset-top) + 20px) 18px 40px}
h1{font-size:34px;margin:0 0 4px}.sub{color:#9ca3af;margin-bottom:26px}
h2{font-size:15px;color:#b9bec8;margin:22px 0 10px}
.card,.time{border:1px solid #2d3036;background:#191b1f;border-radius:18px;padding:15px;cursor:pointer}
.card{display:flex;align-items:center;gap:12px;margin:9px 0}
.card.active,.time.active{border-color:#fff;background:#282b31}
.dot{width:20px;height:20px;border:2px solid #777;border-radius:50%;display:grid;place-items:center}
.active .dot:after{content:"";width:10px;height:10px;background:white;border-radius:50%}
.name{font-weight:700}.case{font-size:13px;color:#9ca3af;margin-top:3px}
.times{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.time{text-align:center;font-weight:700}
button{width:100%;border:0;border-radius:18px;padding:17px;font-size:17px;font-weight:800;margin-top:24px}
#reserve{background:#fff;color:#101114}.danger{background:#5b2024;color:#fff;margin-top:10px}
.status{margin-top:20px;border:1px solid #2d3036;border-radius:18px;padding:16px;display:none}
.small{font-size:12px;color:#9ca3af}.big{font-size:21px;font-weight:800;margin:5px 0}
input{width:100%;border:1px solid #353941;border-radius:13px;background:#191b1f;color:#fff;padding:13px;font-size:16px}
.toast{min-height:22px;margin-top:12px;color:#ffb4b4;font-size:13px}
</style>
</head>
<body><main>
<h1>Escape Call</h1><div class="sub">指定した時間後にiPhoneへVoIP着信</div>

<h2>PIN</h2>
<input id="pin" type="password" inputmode="numeric" placeholder="設定したPIN">

<h2>着信元</h2>
<div id="sources"></div>

<h2>何分後？</h2>
<div class="times" id="times"></div>

<button id="reserve">着信を予約</button>
<div class="toast" id="toast"></div>

<section class="status" id="status">
  <div class="small">予約中</div>
  <div class="big" id="statusName"></div>
  <div id="statusCase"></div>
  <div class="small" style="margin-top:10px" id="statusTime"></div>
  <button class="danger" id="cancel">キャンセル</button>
</section>
</main>
<script>
const sources=${JSON.stringify(SOURCES)};
const minutes=[1,3,5,10,30,60];
let selectedSource="secom", selectedMinutes=5, jobId=localStorage.getItem("escapeJobId"), targetTime=null;

const $=id=>document.getElementById(id);
$("pin").value=localStorage.getItem("escapePin")||"";

function render(){
  $("sources").innerHTML=Object.entries(sources).map(([key,v])=>\`
    <div class="card \${key===selectedSource?"active":""}" data-source="\${key}">
      <div class="dot"></div><div><div class="name">\${v.label}</div><div class="case">\${v.caseName}</div></div>
    </div>\`).join("");
  [...document.querySelectorAll("[data-source]")].forEach(el=>el.onclick=()=>{selectedSource=el.dataset.source;render()});
  $("times").innerHTML=minutes.map(m=>\`<div class="time \${m===selectedMinutes?"active":""}" data-m="\${m}">\${m}分</div>\`).join("");
  [...document.querySelectorAll("[data-m]")].forEach(el=>el.onclick=()=>{selectedMinutes=Number(el.dataset.m);render()});
}
render();

function showStatus(source, runAt, state="scheduled"){
  selectedSource=source;
  targetTime=new Date(runAt);
  $("statusName").textContent=sources[source].label;
  $("statusCase").textContent=sources[source].caseName;
  const suffix=state==="dispatched"?"（発信処理を開始済み）":" に着信予定";
  $("statusTime").textContent=targetTime.toLocaleString("ja-JP")+suffix;
  $("status").style.display="block";
  $("reserve").disabled=true;
}

function clearStatus(){
  jobId=null;
  targetTime=null;
  localStorage.removeItem("escapeJobId");
  $("status").style.display="none";
  $("reserve").disabled=false;
}

async function api(path, opts={}){
  const pin=$("pin").value.trim();
  if(!pin) throw new Error("PINを入力してください");
  localStorage.setItem("escapePin",pin);
  const res=await fetch(path,{...opts,headers:{"content-type":"application/json","x-app-pin":pin,...(opts.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||"通信エラー");
  return data;
}

$("reserve").onclick=async()=>{
  $("toast").textContent="";
  $("reserve").disabled=true;
  try{
    const data=await api("/api/schedule",{method:"POST",body:JSON.stringify({source:selectedSource,minutes:selectedMinutes})});
    jobId=data.id;
    localStorage.setItem("escapeJobId",jobId);
    showStatus(selectedSource,data.runAt);
  }catch(e){$("toast").textContent=e.message}
  finally{$("reserve").disabled=false}
};

$("cancel").onclick=async()=>{
  if(!jobId)return;
  $("toast").textContent="";
  try{
    await api("/api/cancel/"+encodeURIComponent(jobId),{method:"POST"});
    clearStatus();
  }catch(e){$("toast").textContent=e.message}
};

async function restoreStatus(){
  if(!jobId || !$("pin").value.trim()) return;
  try{
    const data=await api("/api/status/"+encodeURIComponent(jobId));
    if(data.cancelled){clearStatus();return}
    showStatus(data.source,data.runAt,data.dispatchedAt?"dispatched":"scheduled");
  }catch(e){
    if(e.message==="予約IDが不正です") clearStatus();
  }
}
restoreStatus();
</script>
</body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname.startsWith("/api/") && !(await isAuthorized(request, env))) {
      return json({ error: "PINが違います" }, 401);
    }

    if (request.method === "POST" && url.pathname === "/api/schedule") {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "JSONが不正です" }, 400); }

      if (!body.source || !(body.source in SOURCES)) return json({ error: "着信元が不正です" }, 400);
      if (!body.minutes || !ALLOWED_MINUTES.has(body.minutes)) return json({ error: "時間が不正です" }, 400);

      const id = env.CALL_JOBS.newUniqueId();
      const stub = env.CALL_JOBS.get(id);
      const runAt = Date.now() + body.minutes * 60_000;
      await stub.create(body.source, runAt);

      return json({
        ok: true,
        id: id.toString(),
        runAt,
        source: SOURCES[body.source]
      }, 201);
    }

    const cancelMatch = url.pathname.match(/^\/api\/cancel\/([a-f0-9]+)$/);
    if (request.method === "POST" && cancelMatch) {
      try {
        const id = env.CALL_JOBS.idFromString(cancelMatch[1]);
        await env.CALL_JOBS.get(id).cancel();
        return json({ ok: true });
      } catch {
        return json({ error: "予約IDが不正です" }, 400);
      }
    }

    const statusMatch = url.pathname.match(/^\/api\/status\/([a-f0-9]+)$/);
    if (request.method === "GET" && statusMatch) {
      try {
        const id = env.CALL_JOBS.idFromString(statusMatch[1]);
        const status = await env.CALL_JOBS.get(id).status();
        if (!status.source) return json({ error: "予約IDが不正です" }, 404);
        return json(status);
      } catch {
        return json({ error: "予約IDが不正です" }, 400);
      }
    }

    return json({ error: "Not found" }, 404);
  }
};

import puppeteer from "puppeteer-core";
const b=await puppeteer.launch({executablePath:"/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader","--window-size=1680,945"]});
const p=await b.newPage(); await p.setViewport({width:1680,height:945});
await p.goto("http://localhost:8123/index.html?cb="+Date.now(),{waitUntil:"domcontentloaded"});
await new Promise(r=>setTimeout(r,600));
const rows=[];
for(const z of [-100,-60,-20,20,60,100]){
  const t=await p.evaluate((zz)=>new Promise(res=>{
    const s=window.__forest.state; s.running=false; s.z=zz;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const r=s.lastResult;
      res({z:zz,cov:+(r.coverage.total*100).toFixed(1),tris:r.tris,fades:r.ev.fadeCount,mesh:r.ev.meshCount,proxy:r.ev.proxyCount});
    }));
  }),z);
  rows.push(t);
  await p.screenshot({path:`artifacts/cruise-${z}.png`});
}
console.log(JSON.stringify(rows,null,2));
await b.close();

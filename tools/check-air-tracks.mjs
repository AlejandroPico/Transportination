import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),origin=process.env.TEST_ORIGIN||'http://localhost:4176';
const feed=JSON.parse(await readFile(new URL('../data/feed.json',import.meta.url))),history=JSON.parse(await readFile(new URL('../data/air-tracks.json',import.meta.url)));
const item=feed.air.items.find(i=>(history.tracks[i.id]||[]).filter(p=>p.name===i.name).length>1);assert.ok(item,'Real historical samples are needed');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/app.js*',async r=>r.fulfill({contentType:'text/javascript',body:await readFile(new URL('../src/app.js',import.meta.url),'utf8')+'\nwindow.__trackQA=()=>({viewer,routeView,selected});'}));
 await page.route('**/api/status',r=>r.fulfill({status:404,body:'{}'}));await page.goto(origin);await page.waitForFunction(()=>document.getElementById('loading').hidden);await page.waitForTimeout(3000);
 await page.locator('[data-panel="search"]').click();await page.locator('#query').fill(item.code);await page.locator('#query').press('Enter');await page.locator('[data-result-vehicle]').first().click();
 await page.waitForFunction(()=>window.__trackQA().routeView.lines.length>0);await page.waitForTimeout(2000);
 const count=await page.evaluate(()=>window.__trackQA().routeView.lines.length);await page.screenshot({path:'artifacts/v04-air-track-3d.png'});
 await page.locator('#dimension').click();await page.waitForFunction(()=>!document.getElementById('dimension').disabled);await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>window.__trackQA().routeView.lines.length),count);await page.screenshot({path:'artifacts/v04-air-track-2d.png'});
 assert.deepEqual(errors,[]);console.log('Observed flight samples and altitude-colored polylines retained in 3D and 2D:',item.name,count);
}finally{await browser.close();}

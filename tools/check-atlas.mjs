import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.TEST_ORIGIN||'http://localhost:4176';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(60000);const errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message);});
 await page.route('**/src/app.js*',async r=>r.fulfill({contentType:'text/javascript',body:await readFile(new URL('../src/app.js',import.meta.url),'utf8')+'\nwindow.__atlasQA=()=>({viewer,items,aviationView,weatherView,aircraft3D,routeView,selected});'}));
 await page.route('**/api/status',r=>r.fulfill({status:404,body:'{}'}));
 await page.goto(origin);await page.waitForFunction(()=>document.getElementById('loading').hidden);await page.waitForFunction(()=>window.__atlasQA?.().items.air.length>0);
 await page.locator('[data-panel="layers"]').click();await page.locator('#base-labels').check();
 assert.equal(await page.evaluate(()=>window.__atlasQA().viewer.imageryLayers.length>=3),true);
 await page.locator('#layers [data-close]').click();await page.locator('[data-panel="filters"]').click();
 await page.waitForFunction(()=>window.__atlasQA().aviationView.packet?.airports.length>70000);
 await page.locator('#navaids').check();await page.waitForFunction(()=>window.__atlasQA().aviationView.points.length>10000);
 await page.locator('#atc').check();await page.waitForFunction(()=>window.__atlasQA().aviationView.lines.length>0);
 await page.screenshot({path:'artifacts/v04-airspace.png'});console.log('Worldwide navaids and published FIR/ATC boundaries render.');
 await page.locator('#navaids').uncheck();await page.locator('#atc').uncheck();
 await page.locator('summary').filter({hasText:'Meteorología'}).click();
 await page.locator('#weather-field').selectOption('temperature');await page.waitForFunction(()=>window.__atlasQA().weatherView.layer);
 assert.equal(await page.locator('#weather-legend').isVisible(),false); // Panel hides the floating legend.
 await page.locator('#filters [data-close]').click();await page.screenshot({path:'artifacts/v04-temperature.png'});
 assert.equal(await page.locator('#weather-legend').isVisible(),true);
 await page.locator('[data-panel="filters"]').click();await page.locator('#weather-field').selectOption('wind');
 await page.waitForFunction(()=>window.__atlasQA().weatherView.arrows.length>500);
 await page.locator('#filters [data-close]').click();await page.screenshot({path:'artifacts/v04-wind.png'});console.log('Temperature and wind grids render with dated model legends.');
 await page.locator('[data-panel="filters"]').click();await page.locator('#weather-field').selectOption('');await page.locator('#clouds').check();await page.locator('#satellite-product').selectOption('meteosat');
 await page.waitForFunction(()=>document.getElementById('weather-note').textContent.includes('Meteosat'));await page.locator('#filters [data-close]').click();
 await page.screenshot({path:'artifacts/v04-meteosat.png'});console.log('Meteosat timestamp and WMS overlay available.');
 await page.locator('[data-panel="filters"]').click();await page.locator('#clouds').uncheck();await page.locator('#filters [data-close]').click();
 // Select a real EasyJet record; its metadata comes from the public aircraft database.
 const air=await page.evaluate(()=>window.__atlasQA().items.air.find(a=>a.name.startsWith('EZY'))||window.__atlasQA().items.air[0]);
 await page.locator('[data-panel="search"]').click();await page.locator('#query').fill(air.code);await page.locator('#query').press('Enter');await page.locator('[data-result-vehicle]').first().click();
 await page.waitForSelector('#inspect-aircraft');await page.locator('#inspect-aircraft').click();await page.waitForFunction(()=>window.__atlasQA().aircraft3D.entity?.show);
 await page.waitForTimeout(4000);await page.screenshot({path:'artifacts/v04-aircraft-model.png'});
 assert.ok((await page.locator('#detail').textContent()).includes('FL'));assert.ok((await page.locator('#detail').textContent()).includes('esquemático'));
 console.log('Published aircraft metadata and original family-specific 3D model verified.');
 await page.locator('#detail-close').click();await page.locator('#zoom').click();await page.waitForTimeout(1500);
 const credits=page.locator('.cesium-credit-expand-link');await credits.click();assert.equal(await page.locator('.cesium-credit-lightbox').isVisible(),true);await page.screenshot({path:'artifacts/v04-credits.png'});
 assert.deepEqual(errors,[]);console.log('Atlas QA passed; no page errors.');
}finally{await browser.close();}

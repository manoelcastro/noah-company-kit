import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.NOAH_PLAYWRIGHT_PATH || 'playwright'); }
catch (error) {
  throw new Error('Install Playwright for development, or set NOAH_PLAYWRIGHT_PATH to its installed module.', { cause: error });
}
const { chromium } = playwright;
// Default when this portable harness is placed at test/browser.mjs in the SDK.
const sdkPath = process.env.NOAH_SDK_PATH || fileURLToPath(new URL('../index.js', import.meta.url));
const executablePath = process.env.NOAH_CHROMIUM_PATH;
const sdkSource = await readFile(sdkPath, 'utf8');
const sdkExports = await import(pathToFileURL(sdkPath).href);
assert.equal(typeof sdkExports.mountNoahControls,'function','SDK is missing mountNoahControls');
assert.equal(typeof sdkExports.mountNoahProductActions,'function','SDK is not ready: missing mountNoahProductActions');
const productId = '11111111-1111-4111-8111-111111111111';
const origin = 'https://company.test';
const noahOrigin = 'https://noah.test';
const holdMs = Number(process.env.NOAH_HOLD_TEST_MS || 650);
const results = [];
const viewportSizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }];

const html = mode => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;min-height:2400px;font:16px system-ui;background:#f5f1ee}header{height:120px;padding:20px}#product{position:relative;margin:0 auto;width:calc(100% - 40px);max-width:300px;height:260px;touch-action:auto}#product img{display:block;width:100%;height:100%;object-fit:cover}#outside{margin:36px 20px}</style></head>
<body><header>Loja de cerâmica · fixture isolada</header>
<div id="product"><img id="product-image" alt="Vaso de cerâmica" draggable="true" src="/product.svg"></div>
<button id="outside">Continuar na loja</button>
<script type="module">
import { mountNoahControls, mountNoahProductActions } from '/noah-sdk.js';
window.calls=[];window.imageClicks=0;
document.querySelector('#product-image').addEventListener('click',()=>window.imageClicks++);
const record=(method,target)=>{window.calls.push({method,target:target??null});return {opened:true}};
window.client={
  connect:async()=>({mode:${JSON.stringify(mode)},companySlug:'ceramica',theme:'light',capabilities:[]}),
  openNoahMenu:async target=>record('menu',target),
  openSocialActions:async target=>record(target.intent.toLowerCase(),target),
  openOpinionComposer:async target=>record('opinion',target),
  setControlsMounted:async mounted=>{window.calls.push({method:'mounted',mounted});return {mounted}},
};
window.originalImageAttributes={draggable:document.querySelector('#product-image').getAttribute('draggable')};
try {
  window.globalControls=await mountNoahControls({client:window.client,noahOrigin:${JSON.stringify(noahOrigin)},bottomOffset:24});
  window.productControls=await mountNoahProductActions({client:window.client,noahOrigin:${JSON.stringify(noahOrigin)},element:document.querySelector('#product'),productId:${JSON.stringify(productId)}});
  window.ready=true;
} catch(error) {window.fixtureError=String(error.stack||error);}
</script></body></html>`;

const globalTrigger = page => page.locator('[data-noah-sdk-controls] [data-noah-trigger]');
const productTrigger = page => page.locator('#product [data-noah-trigger]');
const action = (page, name) => page.locator(`[data-noah-action="${name}"]:visible`);
const visibleMenu = page => page.locator('[data-noah-radial-menu]:visible');
const realActions = page => page.evaluate(() => window.calls.filter(item => item.method !== 'mounted'));

function centre(rect) { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
async function rect(locator) { const value = await locator.boundingBox(); assert(value, 'Expected a rendered element'); return value; }
async function assertMenuClosed(page) { assert.equal(await visibleMenu(page).count(), 0, 'Radial should be closed'); }
async function assertMenuOpen(page) {
  await visibleMenu(page).waitFor({ state: 'visible' });
  for (const name of ['menu', 'follow', 'like', 'opinion']) {
    const control = action(page, name);
    assert.equal(await control.count(), 1, `Expected exactly one visible ${name} action`);
    assert(await control.getAttribute('aria-label') || (await control.textContent()).trim(), `${name} needs an accessible name`);
  }
}
async function assertWithinViewport(page) {
  const viewport = page.viewportSize();
  const buttons = page.locator('[data-noah-action]:visible');
  assert.equal(await buttons.count(), 4);
  const boxes = await buttons.evaluateAll(elements => elements.map(element => {
    const b=element.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};
  }));
  for (const b of boxes) {
    assert(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= viewport.width + 0.5 && b.y + b.height <= viewport.height + 0.5, `Clipped action: ${JSON.stringify(b)} in ${JSON.stringify(viewport)}`);
    assert(b.width >= 40 && b.height >= 40, `Touch action too small: ${JSON.stringify(b)}`);
  }
  for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
    const a=centre(boxes[i]),b=centre(boxes[j]);
    assert(Math.hypot(a.x-b.x,a.y-b.y)>=40,'Action centres need distinct touch targets');
  }
}

async function fixture(browser, size, run, mode = 'embedded') {
  const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html(mode) });
    if (url.origin === origin && url.pathname === '/noah-sdk.js') return route.fulfill({ contentType: 'text/javascript', body: sdkSource });
    if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="260"><rect width="300" height="260" fill="#dac7b1"/><circle cx="150" cy="130" r="65" fill="#866653"/></svg>' });
    return route.abort('blockedbyclient');
  });
  try {
    await page.goto(origin);
    await page.waitForFunction(() => window.ready || window.fixtureError, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.fixtureError || null), null);
    const cdp = await context.newCDPSession(page);
    const touches = points => points.map((point,index) => ({ x:point.x,y:point.y,id:index+1,radiusX:2,radiusY:2,force:1 }));
    const touch = {
      start: point => cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches([point])}),
      move: point => cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches([point])}),
      end: () => cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}),
      cancel: () => cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}),
      addFinger: (first,second) => cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches([first,second])}),
    };
    await run({page,touch,size});
    assert.deepEqual(errors, [], 'Uncaught browser errors');
  } finally { await context.close(); }
}

const tests = {
  async 'mouse hold on image and release selects once'({page}) {
    const point=centre(await rect(page.locator('#product-image')));
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(holdMs);
    await assertMenuOpen(page);
    const selected=centre(await rect(action(page,'like')));
    await page.mouse.move(selected.x,selected.y,{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>window.calls.some(call=>call.method==='like'));
    await page.waitForTimeout(80);
    const calls=await realActions(page);
    assert.equal(calls.length,1);assert.equal(calls[0].target.productId,productId);
    assert.equal(await page.evaluate(()=>window.imageClicks),0);
    await assertMenuClosed(page);
  },
  async 'trigger arrow keys open on the intended first or last item'({page}) {
    const trigger=globalTrigger(page);
    await trigger.focus();await page.keyboard.press('ArrowDown');await assertMenuOpen(page);
    assert.equal(await action(page,'menu').evaluate(el=>el.getRootNode().activeElement===el),true);
    await page.keyboard.press('Escape');await trigger.focus();await page.keyboard.press('ArrowUp');
    assert.equal(await action(page,'opinion').evaluate(el=>el.getRootNode().activeElement===el),true);
    await page.keyboard.press('Escape');await assertMenuClosed(page);
    assert.deepEqual(await realActions(page),[]);
  },
  async 'global click, semantics, one company action'({page}) {
    const trigger=globalTrigger(page);
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    assert(['true','menu'].includes(await trigger.getAttribute('aria-haspopup')));
    await trigger.click();await assertMenuOpen(page);await assertWithinViewport(page);
    assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    assert.equal(await page.getByRole('menu').count(),1);
    await action(page,'like').click();
    await page.waitForFunction(()=>window.calls.some(call=>call.method==='like'));
    const calls=await realActions(page);
    assert.equal(calls.length,1);assert.equal(calls[0].method,'like');
    assert.equal(calls[0].target.targetType,'COMPANY');assert(!calls[0].target.productId);
    await assertMenuClosed(page);
  },
  async 'keyboard opens, navigates, escapes and restores focus'({page}) {
    const trigger=globalTrigger(page);
    await trigger.focus();await page.keyboard.press('Enter');await assertMenuOpen(page);
    const first=action(page,'menu');assert(await first.evaluate(element=>element.matches(':focus')),'Enter should focus first menu item');
    await page.keyboard.press('ArrowDown');
    assert(await action(page,'follow').evaluate(element=>element.matches(':focus')),'ArrowDown should advance to Follow');
    await page.keyboard.press('Escape');await assertMenuClosed(page);
    assert(await trigger.evaluate(element=>element.matches(':focus')),'Escape should return focus to trigger');
    assert.deepEqual(await realActions(page),[]);
    await page.keyboard.press('Space');await assertMenuOpen(page);
    await page.keyboard.press('Escape');await assertMenuClosed(page);
  },
  async 'short product image tap preserves ordinary click'({page,touch}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(40);await touch.end();await page.waitForTimeout(100);
    await assertMenuClosed(page);assert.equal(await page.evaluate(()=>window.imageClicks),1);
    assert.deepEqual(await realActions(page),[]);
  },
  async 'swipe before hold scrolls without opening or acting'({page,touch}) {
    const image=await rect(page.locator('#product-image'));
    const p={x:image.x+image.width/2,y:image.y+image.height-30};
    await touch.start(p);await page.waitForTimeout(30);
    for(let step=1;step<=5;step++){await touch.move({x:p.x,y:p.y-step*35});await page.waitForTimeout(20);}
    await touch.end();await page.waitForTimeout(holdMs+80);
    assert(await page.evaluate(()=>scrollY)>30,'Ordinary product image swipe must scroll page');
    await assertMenuClosed(page);assert.deepEqual(await realActions(page),[]);
  },
  async 'hold image and drag selects exactly one product action, no scroll or click'({page,touch}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);await assertWithinViewport(page);
    assert.deepEqual(await realActions(page),[],'Holding alone must not execute');
    const target=centre(await rect(action(page,'follow')));
    await touch.move({x:p.x+(target.x-p.x)/2,y:p.y+(target.y-p.y)/2});await touch.move(target);
    assert.deepEqual(await realActions(page),[],'Dragging alone must not execute');
    await touch.end();await page.waitForTimeout(120);
    const calls=await realActions(page);assert.equal(calls.length,1);assert.equal(calls[0].method,'follow');
    assert.equal(calls[0].target.targetType,'PRODUCT');assert.equal(calls[0].target.productId,productId);
    assert.equal(await page.evaluate(()=>scrollY),0);assert.equal(await page.evaluate(()=>window.imageClicks),0);
    await assertMenuClosed(page);
  },
  async 'hold global oa and drag opens one company action without duplicate click'({page,touch}) {
    const p=centre(await rect(globalTrigger(page)));
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);await assertWithinViewport(page);
    const target=centre(await rect(action(page,'like')));
    await touch.move(target);assert.deepEqual(await realActions(page),[]);
    await touch.end();await page.waitForTimeout(120);
    const calls=await realActions(page);assert.equal(calls.length,1);assert.equal(calls[0].method,'like');
    assert.equal(calls[0].target.targetType,'COMPANY');assert(!calls[0].target.productId);
    assert.equal(await page.evaluate(()=>scrollY),0);await assertMenuClosed(page);
    assert.equal(await globalTrigger(page).getAttribute('aria-expanded'),'false');
  },
  async 'async failure keeps menu usable and retry executes once'({page}) {
    await page.evaluate(()=>{
      const original=window.client.openSocialActions;let fail=true;
      window.client.openSocialActions=async target=>{
        const result=await original(target);
        if(fail){fail=false;throw new Error('Synthetic test failure')}
        return result;
      };
    });
    await globalTrigger(page).click();await assertMenuOpen(page);await action(page,'like').click();
    await page.getByText('Não foi possível abrir o Noah. Tente novamente.',{exact:true}).waitFor({state:'visible'});
    await assertMenuOpen(page);assert.equal(await action(page,'like').isEnabled(),true);
    assert.equal((await realActions(page)).length,1,'Failed first attempt must be recorded once');
    await action(page,'like').click();
    await page.waitForFunction(()=>window.calls.filter(call=>call.method==='like').length===2);
    await page.waitForTimeout(60);await assertMenuClosed(page);
    const calls=await realActions(page);assert.equal(calls.length,2);
    assert(calls.every(call=>call.method==='like'&&call.target.targetType==='COMPANY'));
  },
  async 'hold and release in centre cancels'({page,touch}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);await touch.end();await page.waitForTimeout(100);
    await assertMenuClosed(page);assert.deepEqual(await realActions(page),[]);assert.equal(await page.evaluate(()=>window.imageClicks),0);
  },
  async 'release outside targets cancels'({page,touch,size}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);
    const boxes=await page.locator('[data-noah-action]:visible').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
    const candidates=[{x:8,y:8},{x:size.width-8,y:8},{x:8,y:size.height-8},{x:size.width-8,y:size.height-8}];
    const outside=candidates.filter(candidate=>!boxes.some(b=>candidate.x>=b.x-12&&candidate.x<=b.x+b.width+12&&candidate.y>=b.y-12&&candidate.y<=b.y+b.height+12)).sort((a,b)=>Math.hypot(b.x-p.x,b.y-p.y)-Math.hypot(a.x-p.x,a.y-p.y))[0];
    assert(outside,'Fixture needs a point outside the radial');await touch.move(outside);await touch.end();await page.waitForTimeout(80);
    await assertMenuClosed(page);assert.deepEqual(await realActions(page),[]);
  },
  async 'touchcancel and second finger cancel without action'({page,touch}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);await touch.cancel();await page.waitForTimeout(50);
    await assertMenuClosed(page);assert.deepEqual(await realActions(page),[]);
    await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);
    await touch.addFinger(p,{x:p.x+55,y:p.y});await touch.end();await page.waitForTimeout(60);
    await assertMenuClosed(page);assert.deepEqual(await realActions(page),[]);
  },
  async 'product badge keyboard and opinion preserve product scope'({page}) {
    const trigger=productTrigger(page);assert.equal(await trigger.count(),1);
    await trigger.focus();await page.keyboard.press('Enter');await assertMenuOpen(page);
    await action(page,'opinion').click();await page.waitForFunction(()=>window.calls.some(call=>call.method==='opinion'));
    const calls=await realActions(page);assert.equal(calls.length,1);assert.equal(calls[0].method,'opinion');
    assert.equal(calls[0].target.targetType,'PRODUCT');assert.equal(calls[0].target.productId,productId);
    await assertMenuClosed(page);
  },
  async 'corner image holds keep every action in viewport'({page,touch,size}) {
    for(const corner of ['top-left','top-right','bottom-left','bottom-right']){
      await page.evaluate(corner=>{const el=document.querySelector('#product');el.style.cssText='position:fixed;margin:0;width:120px;height:120px;z-index:1;'+(corner.includes('right')?'right:0;':'left:0;')+(corner.includes('bottom')?'bottom:0;':'top:0;')},corner);
      const p={x:corner.includes('right')?size.width-8:8,y:corner.includes('bottom')?size.height-8:8};
      await touch.start(p);await page.waitForTimeout(holdMs);await assertMenuOpen(page);await assertWithinViewport(page);
      await touch.cancel();await assertMenuClosed(page);
    }
    assert.deepEqual(await realActions(page),[]);
  },
  async 'close removes controls, pending gesture and mounted flag'({page,touch}) {
    const p=centre(await rect(page.locator('#product-image')));
    await touch.start(p);await page.waitForTimeout(80);
    await page.evaluate(()=>{window.productControls.close();window.globalControls.close()});
    await page.waitForTimeout(holdMs);await touch.end();await page.waitForTimeout(80);
    assert.equal(await page.locator('[data-noah-trigger]').count(),0);
    assert.equal(await page.locator('[data-noah-radial-menu]').count(),0);
    assert.deepEqual(await realActions(page),[]);
    const mounted=await page.evaluate(()=>window.calls.filter(call=>call.method==='mounted').map(call=>call.mounted));
    assert.deepEqual(mounted,[true,false]);
    assert.equal(await page.locator('#product-image').getAttribute('draggable'),'true','Original image draggable attribute must be restored');
    // The original short touch is allowed to finish normally after teardown.
    // Measure the next click relative to that legitimate native click, if any.
    const before=await page.evaluate(()=>window.imageClicks);
    await page.locator('#product-image').click();assert.equal(await page.evaluate(()=>window.imageClicks),before+1);
  },
};

const browser=await chromium.launch({...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
try {
  for(const size of viewportSizes) for(const [name,run] of Object.entries(tests)){
    const label=`${size.width}x${size.height} ${name}`;const start=Date.now();
    try {await fixture(browser,size,run);results.push({test:label,status:'passed',ms:Date.now()-start});console.log('PASS',label);}
    catch(error){results.push({test:label,status:'failed',error:String(error.stack||error),ms:Date.now()-start});console.error('FAIL',label,String(error));}
  }
} finally {await browser.close();}
const report={sdkPath,tests:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,limits:['Local HTTPS fixtures with stub client; no QA or real data/mutations.','Chromium CDP injects real browser touch input, not a physical iPhone/Safari acceptance.','Tests exercise the provided hooks and existing actions; no backend integration acceptance.'],results};
await writeFile(process.env.NOAH_RADIAL_REPORT || join(tmpdir(),'noah-radial-browser-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({tests:report.tests,passed:report.passed,failed:report.failed}));
if(report.failed)process.exitCode=1;

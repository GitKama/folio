const { chromium }=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
async function main(){
  const root=path.resolve('test-results/production');await fs.mkdir(root,{recursive:true});
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const exe=process.env.FOLIO_TEST_EXECUTABLE||path.resolve('src-tauri/target/release/folio.exe');
  const proc=spawn(exe,[],{windowsHide:true,env:{...process.env,FOLIO_DATA_DIR:path.join(root,'profile-'+Date.now()),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`},stdio:'ignore'});
  let browser;
  try{
    for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(r=>setTimeout(r,200));}}
    assert.ok(browser,'Production WebView2 started');
    const context=browser.contexts()[0];const page=context.pages()[0]||await context.waitForEvent('page');
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.waitForSelector('#document-content h1',{timeout:45000});
    await page.waitForFunction(()=>document.getElementById('status-message').textContent==='Ready to read');
    await page.waitForSelector('.diagram svg',{timeout:45000});
    assert.equal(await page.locator('.brand-caption').textContent(),'2.0');
    const denied=await page.evaluate(async()=>{try{await window.__TAURI__.core.invoke('request',{action:'test-config',payload:{}});return false;}catch{return true;}});
    assert.equal(denied,true,'Test harness absent from production');
    await page.screenshot({path:path.join(root,'welcome.png')});
    await page.locator('button[data-view=split]').click();
    const editor=page.locator('#source-content');await editor.fill('# Production check\n\nNative Rust with **formatted text**.');
    await page.waitForFunction(()=>document.querySelector('#document-content h1')?.textContent.includes('Production check'));
    await page.locator('#export-toggle').click();await page.locator('#export-teams').click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Copied for Teams'));
    await page.screenshot({path:path.join(root,'production.png')});
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(root,'report.json'),JSON.stringify({version:'2.0.0',passed:true,sha256:crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex'),checks:['Embedded production frontend starts','Welcome math and diagrams render','Compile-time test commands are absent','Live source editing renders','Native Teams clipboard write succeeds','No uncaught renderer errors']},null,2));
    console.log('Production smoke: 6 checks passed.');
  }finally{await browser?.close();proc.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

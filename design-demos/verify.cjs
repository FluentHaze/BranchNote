const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"); const path = require("node:path"); const assert = require("node:assert/strict");
app.disableHardwareAcceleration(); app.setPath("userData",path.join(__dirname,"../.tmp/design-prototype-profile"));
app.whenReady().then(async()=>{
  let win;
  try {
    win=new BrowserWindow({width:1440,height:900,show:false,useContentSize:true,webPreferences:{offscreen:true}});
    const errors=[];win.webContents.on("console-message",event=>{if(String(event.message).includes("Uncaught"))errors.push(event.message);});
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const evaluate=code=>win.webContents.executeJavaScript(code);
    const capture=async name=>{await wait(240);fs.writeFileSync(path.join(__dirname,name),(await win.webContents.capturePage()).toPNG());};
    for(let i=1;i<=3;i++){
      await win.setContentSize(1440,900);
      await win.loadFile(path.join(__dirname,"dir-"+i+".html"));
      await capture("dir-"+i+"-desktop.png");
      const height=await evaluate("document.documentElement.scrollHeight");
      await win.setContentSize(1440,Math.max(900,height));
      await capture("dir-"+i+"-full.png");
      assert.equal(await evaluate("document.querySelectorAll('.row').length"),5);
      await evaluate("document.querySelector('[data-filter=mr]').click()");
      assert.equal(await evaluate("document.querySelectorAll('.row').length"),1);
      await evaluate("document.querySelector('[data-filter=all]').click()");
      await evaluate("document.querySelector('[data-submit=test]').click()");
      assert.equal(await evaluate("document.querySelector('#submit-dialog').open"),true);
      await evaluate("document.querySelector('[data-confirm]').click()");
      assert.equal(await evaluate("document.querySelector('[data-count]').textContent"),"0");
      assert.equal(await evaluate("document.querySelectorAll('.row>.state.pending').length"),4);
      await win.loadFile(path.join(__dirname,"dir-"+i+".html"));
      await win.setContentSize(375,812);
      await capture("dir-"+i+"-mobile.png");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=375"),true,"mobile overflow direction "+i);
      await evaluate("document.querySelector('[data-submit=release]').click()");
      await capture("dir-"+i+"-mobile-submit.png");
      assert.equal(await evaluate("document.querySelector('#submit-dialog').open"),true);
      const mobileHeight=await evaluate("document.documentElement.scrollHeight");
      await evaluate("document.querySelector('#submit-dialog').close()");
      await win.setContentSize(375,mobileHeight);
      await capture("dir-"+i+"-mobile-full.png");
    }
    await win.setContentSize(1440,840);
    await win.loadFile(path.join(__dirname,"thumbs.html"));
    await capture("thumbs.png");
    assert.deepEqual(errors,[]);
    console.log("PASS: three directions, desktop/mobile, no overflow, filtering, selection, submit dialog, simulated MR");
    app.exit(0);
  }catch(e){console.error(e);app.exit(1)}
});
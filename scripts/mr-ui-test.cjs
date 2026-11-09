// Isolated renderer regression: no real repository, credentials, or platform writes.
const { app, BrowserWindow, contextBridge } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
if (process.type === "renderer") {
  const stamp = new Date().toISOString();
  let data = {
    version: 3,
    projects: [{id:"p", name:"BranchNote", note:"功能分支的测试与发布，在一个项目中有序推进", color:"#0b756c", archived:false, repositoryPath:"/fixture", testTarget:"origin/test", releaseTarget:"origin/release"}],
    branches: ["feature/project-workspace", "feature/batch-submit", "fix/conflict-recovery"].map((name, i) => ({
      id:String(i), projectId:"p", name, description:["按项目管理功能分支", "批量汇总并提交 MR", "临时分支解决冲突"][i],
      note:"新增仓库选择与分支备注，方便核对本次改动", testMergedAt:null, releaseMergedAt:null, createdAt:stamp, updatedAt:stamp,
    })),
  };
  const calls = [];
  let pushFailed = false;
  let credentials = [];
  let forceConflict = false;
  let mrState = "opened";
  const repo = {path:"/fixture", current:"main", defaultBranch:"main", remotes:["origin"],
    branches:["main","test","release", ...data.branches.map(b => b.name)].map(name => ({name, local:true, remoteRef:"origin/"+name, remoteRefs:["origin/"+name], subject:"feat: "+name, ahead:0, behind:0}))};
  contextBridge.exposeInMainWorld("branchNote", {
    read:async()=>JSON.stringify(data), write:async raw=>{data=JSON.parse(raw);},
    readRepository:async()=>repo, mergeState:async()=>({session:null, unmerged:[]}),
    prepareMerge:async(...args)=>{calls.push(["prepare", ...args]); return {id:"plan"};},
    checkMerge:async()=>{calls.push(["check"]);return {status:forceConflict?"conflict":"clean",branch:"feature/batch-submit",files:forceConflict?["src/conflict.ts"]:[],merged:[],pending:[],resolveBranch:calls.filter(c=>c[0]==="prepare").at(-1)[4]==="resolve"?"resolve/test":calls.filter(c=>c[0]==="prepare").at(-1)[4]};},
    forceConflict:async value=>{forceConflict=value;},
    executeMerge:async(id,confirmed)=>{calls.push(["execute",id,confirmed]);const last=calls.filter(c=>c[0]==="prepare").at(-1);const resolve=last[4]==="resolve"?"resolve/test":last[4];const direct=!forceConflict&&last[3].length===1;const source=forceConflict?resolve:direct?last[3][0].replace(/^origin\//,""):last[2];return {status:"success",workingBranch:source,targetLocal:source,sourceRef:direct?"refs/heads/"+source:undefined,sourceHead:direct?"fixture-head":undefined,merged:last[3],pending:[],conflicts:[],logs:[]};},
    pushBranch:async(...args)=>{calls.push(["push", ...args]); if(!pushFailed){pushFailed=true;throw new Error("模拟推送失败");}},
    mergeRequestUrl:async()=>"https://example.invalid/new",
    createMergeRequest:async(...args)=>{calls.push(["mr", ...args]);return {status:"created",url:"https://example.invalid/mr/42",number:"42"};},
    openUrl:async()=>{}, listHosts:async()=>credentials,
    saveHost:async ({host,provider})=>{const entry={host,provider,scheme:"https",hint:"••••test",encrypted:true,updatedAt:stamp};credentials=[entry];return {hosts:credentials,entry};},
    testHost:async()=>({ok:true,account:"fixture",message:"连接成功"}),
    removeHost:async()=>{credentials=[];return [];},
    syncMergeRequests:async urls=>{calls.push(["sync",urls]);return [...new Set(urls)].map(url=>({url,state:mrState,mergedAt:mrState==="merged"?stamp:null}));},
    setMRState:async value=>{mrState=value;},
    inspect:async()=>({data,calls}),
  });
} else {
  app.disableHardwareAcceleration();
  app.setPath("userData", path.join(root, ".tmp/mr-ui-profile"));
  app.whenReady().then(async()=>{
    let win;
    try {
      win = new BrowserWindow({width:1440,height:980,show:false,webPreferences:{offscreen:true,preload:__filename,sandbox:false,contextIsolation:true}});
      await win.loadFile(path.join(root,"dist/index.html"));
      const evaluate = code=>win.webContents.executeJavaScript(code).catch(error=>{throw new Error(code+"\n"+error.message);});
      const waitFor = async code=>{
        for(let i=0;i<100;i++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,50));}
        throw new Error("Timed out: "+code);
      };
      const clickText = text=>evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSON.stringify(text)+").click()");
      await waitFor("!!document.querySelector('table')");
      await clickText("设置与令牌v0.2.0");
      await waitFor("!!document.querySelector('[aria-label=\"MR 自动刷新周期\"]')");
      await evaluate("document.querySelector('[aria-label=\"MR 自动刷新周期\"]').click()");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.select-menu:popover-open')).borderRadius"),"14px");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.select-menu:popover-open [role=option]')).borderRadius"),"8px");
      assert.equal(await evaluate("document.querySelectorAll('.select-menu:popover-open [role=option]').length"),6);
      await new Promise(resolve=>setTimeout(resolve,200));
      fs.writeFileSync(path.join(root,"docs/e2e/refresh-settings.png"),(await win.webContents.capturePage()).toPNG());

      await evaluate("Array.from(document.querySelectorAll('.select-menu:popover-open [role=option]')).find(option=>option.textContent.includes('5 分钟')).click()");
      await waitFor("(document.querySelector('[aria-label=\"MR 自动刷新周期\"]').textContent.includes('5 分钟'))");
      assert.equal((await evaluate("window.branchNote.inspect()")).data.mrRefreshSeconds,300);
      await evaluate("window.originalInterval=window.setInterval;window.intervalValues=[];window.setInterval=(handler,delay,...args)=>{window.intervalValues.push(delay);return window.originalInterval(handler,delay,...args);};document.querySelector('.sidebar nav .nav-item').click()");
      await waitFor("!!document.querySelector('table')");
      assert.ok(await evaluate("window.intervalValues.includes(300000)"),"polling uses configured interval");
      await evaluate("window.setInterval=window.originalInterval;void 0");

      fs.mkdirSync(path.join(root,"docs/e2e"),{recursive:true});
      assert.equal(await evaluate("document.fonts.load('400 14px \"BranchNote Sans\"', '测试项目').then(fonts=>fonts.length)"),1);
      assert.equal(await evaluate("document.fonts.load('400 12px \"BranchNote Mono\"', 'feature/test').then(fonts=>fonts.length)"),1);
      assert.equal(await evaluate("document.fonts.check('400 14px \"BranchNote Sans\"', '测试项目')"),true);
      assert.equal(await evaluate("document.fonts.check('400 12px \"BranchNote Mono\"', 'feature/test')"),true);
      assert.equal(await evaluate("document.querySelectorAll('.branch-change-note').length"),3);
      await evaluate("document.querySelector('tbody .feature-title').click()");
      assert.equal(await evaluate("document.querySelector('tbody input').checked"),true);
      await evaluate("document.querySelector('tbody .feature-title').click()");
      assert.equal(await evaluate("document.querySelector('tbody input').checked"),false);
      await evaluate("document.fonts.ready");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-workspace.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('.target-chip').click()");
      await waitFor("!!document.querySelector('.target-form .select-trigger')");
      assert.equal(await evaluate("document.querySelector('dialog').getBoundingClientRect().height < innerHeight"),true,"target form must fit its content without giant empty fields");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.target-form .host-field')).every(e=>e.getBoundingClientRect().height < 100)"),true,"fields must not inherit horizontal form flex-basis");

      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-targets.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('.target-form .select-trigger').click()");
      await waitFor("!!document.querySelector('.select-menu:popover-open .select-search input')");
      const setInput=async(selector,value)=>evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await setInput(".select-menu:popover-open .select-search input","release");
      await waitFor("document.querySelectorAll('.select-menu:popover-open [role=option]').length===1");
      assert.equal(await evaluate("document.querySelector('.select-menu:popover-open [role=option]').textContent"),"origin/release");
      await new Promise(r=>setTimeout(r,150));
      fs.writeFileSync(path.join(root,"docs/e2e/branch-search.png"),(await win.webContents.capturePage()).toPNG());
      await setInput(".select-menu:popover-open .select-search input","does-not-exist");
      await waitFor("!!document.querySelector('.select-menu:popover-open .select-empty')");
      win.webContents.sendInputEvent({type:"keyDown",keyCode:"ESC"});
      win.webContents.sendInputEvent({type:"keyUp",keyCode:"ESC"});
      await waitFor("!document.querySelector('.select-menu:popover-open')");
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),true);
      await evaluate("document.querySelector('.target-form .select-trigger').click()");
      await waitFor("!!document.querySelector('.select-menu:popover-open')");
      assert.equal(await evaluate("document.querySelector('.select-menu:popover-open input').value"),"");
      await setInput(".select-menu:popover-open input","RELEASE");
      await waitFor("document.querySelectorAll('.select-menu:popover-open [role=option]').length===1");
      win.webContents.sendInputEvent({type:"keyDown",keyCode:"ENTER"});
      win.webContents.sendInputEvent({type:"keyUp",keyCode:"ENTER"});
      await waitFor("!document.querySelector('.select-menu:popover-open')");
      assert.equal(await evaluate("document.querySelector('.target-form .select-trigger').textContent"),"origin/release");


      await evaluate("document.querySelector('dialog .modal-head button').click()");
      await clickText("编辑项目");
      await waitFor("!!document.querySelector('dialog input[name=name]')");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/project-editor.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('dialog .modal-head button').click()");
      await evaluate("document.querySelector('.sidebar-bottom .nav-item').click()");
      await waitFor("!!document.querySelector('.settings-panel')");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/settings.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('.sidebar nav .nav-item').click()");
      await waitFor("!!document.querySelector('table')");
      await evaluate("document.querySelector('thead input').click()");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-selection.png"),(await win.webContents.capturePage()).toPNG());
      await clickText("提交测试");
      await waitFor("!!document.querySelector('dialog[open]')");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-submit.png"),(await win.webContents.capturePage()).toPNG());

      await evaluate("document.querySelector('.submit-credentials summary').click()");
      await waitFor("!!document.querySelector('.submit-credentials input[aria-label=访问令牌]')");
      await setInput(".submit-credentials input[aria-label=平台地址]","git.example.invalid");
      await setInput(".submit-credentials input[aria-label=访问令牌]","fixture-token-test");
      const headerTop=await evaluate("document.querySelector('dialog .modal-head').getBoundingClientRect().top");
      await evaluate("document.querySelector('.modal-scroll').scrollTop=10000");
      assert.equal(await evaluate("document.querySelector('dialog .modal-head').getBoundingClientRect().top"),headerTop,"close header must remain fixed");
      await clickText("保存令牌");
      await waitFor("document.querySelector('.submit-credentials').textContent.includes('••••test')");
      await clickText("测试连接");
      await waitFor("document.querySelector('.submit-credentials').textContent.includes('连接成功')");
      await evaluate("document.querySelector('main').style.minHeight='2400px'");
      const pageY=await evaluate("scrollY");
      win.webContents.sendInputEvent({type:"mouseWheel",x:10,y:100,deltaY:600,deltaX:0});
      await new Promise(r=>setTimeout(r,200));
      assert.equal(await evaluate("scrollY"),pageY,"modal wheel must not scroll background");
      await new Promise(r=>setTimeout(r,150));
      await evaluate("document.querySelector('.modal-scroll').scrollTop=0");
      await new Promise(r=>setTimeout(r,150));
      fs.writeFileSync(path.join(root,"docs/e2e/credentials.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('main').style.minHeight='';document.querySelector('.submit-credentials').open=false");
      await clickText("提交 MR");
      await waitFor("document.body.textContent.includes('模拟推送失败')");
      let state=await evaluate("window.branchNote.inspect()");
      assert.equal(state.calls.filter(c=>c[0]==="mr").length,0,"push failure must stop MR creation");
      assert.equal(state.data.branches[0].testMR,undefined);
      await clickText("重试提交 MR");
      await waitFor("document.body.textContent.includes('等待在平台审核、合并')");
      state=await evaluate("window.branchNote.inspect()");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('dialog button')).some(b=>b.textContent.includes('重新关联记录'))"),false);
      const prepare=state.calls.find(c=>c[0]==="prepare");
      assert.match(prepare[2],/^mr\/test-/);
      assert.equal(prepare[5].base,"origin/test");
      assert.equal(prepare[5].mrTarget,"origin/test");
      assert.equal(prepare[3].length,3);
      const mr=state.calls.find(c=>c[0]==="mr");
      assert.equal(mr[3],"test","platform target must not include remote prefix");
      assert.equal(mr[6],"origin");
      assert.equal(state.data.branches[0].testMergedAt,null);
      assert.equal(state.data.branches[0].testMR.number,"42");
      await clickText("关闭");
      await waitFor("document.body.textContent.includes('MR 待合并')");
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-submitted.png"),(await win.webContents.capturePage()).toPNG());
      await win.setSize(900,760);
      await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,"docs/e2e/mr-compact.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('.selection-bar .icon-button').click()");
      await evaluate("document.querySelector('tbody .row-more button').click()");
      await clickText("提交发布");
      await waitFor("!!document.querySelector('dialog[open]')");
      await clickText("提交 MR");
      await waitFor("document.body.textContent.includes('等待在平台审核、合并')");
      state=await evaluate("window.branchNote.inspect()");
      const release=state.calls.filter(c=>c[0]==="mr").at(-1);
      assert.equal(release[3],"release");
      assert.equal(state.data.branches[0].releaseMR.number,"42");
      assert.equal(state.data.branches[0].releaseMergedAt,null);
      await clickText("关闭");
      await evaluate("window.branchNote.forceConflict(true)");
      await evaluate("document.querySelector('tbody .row-more button').click()");
      await clickText("提交测试");
      await waitFor("!!document.querySelector('dialog[open]')");
      const before=await evaluate("window.branchNote.inspect()");
      await clickText("检查冲突");
      await waitFor("document.body.textContent.includes('发现冲突，尚未修改当前仓库')");
      let checked=await evaluate("window.branchNote.inspect()");
      assert.equal(checked.calls.filter(c=>c[0]==="execute").length,before.calls.filter(c=>c[0]==="execute").length);
      assert.equal(checked.calls.filter(c=>c[0]==="push").length,before.calls.filter(c=>c[0]==="push").length);
      await new Promise(r=>setTimeout(r,150));
      fs.writeFileSync(path.join(root,"docs/e2e/conflict-preflight.png"),(await win.webContents.capturePage()).toPNG());
      await clickText("取消此次提交");
      checked=await evaluate("window.branchNote.inspect()");
      assert.equal(checked.calls.filter(c=>c[0]==="execute").length,before.calls.filter(c=>c[0]==="execute").length);
      await clickText("提交 MR");
      await waitFor("document.body.textContent.includes('发现冲突，尚未修改当前仓库')");
      await clickText("确认，创建 resolve 分支继续");
      await waitFor("document.body.textContent.includes('等待在平台审核、合并')");
      checked=await evaluate("window.branchNote.inspect()");
      assert.equal(checked.calls.filter(c=>c[0]==="execute").at(-1)[2],true);
      assert.equal(checked.calls.filter(c=>c[0]==="mr").at(-1)[2],"resolve/test");
      await clickText("关闭");
      await evaluate("window.branchNote.forceConflict(false)");
      await win.setSize(1440,980);
      await evaluate("document.querySelector('.target-chip').click()");
      await waitFor("document.querySelectorAll('.target-config-row').length===2");
      await setInput('input[aria-label="目标名称 1"]',"测试1");
      await clickText("添加目标");
      await waitFor("document.querySelectorAll('.target-config-row').length===3");
      await setInput('input[aria-label="目标名称 3"]',"测试2");
      await evaluate("document.querySelectorAll('.target-config-row .select-trigger')[2].click()");
      await waitFor("!!document.querySelector('.select-menu:popover-open')");
      await setInput(".select-menu:popover-open input","origin/main");
      await waitFor("document.querySelectorAll('.select-menu:popover-open [role=option]').length===1");
      await evaluate("document.querySelector('.select-menu:popover-open [role=option]').click()");
      await new Promise(r=>setTimeout(r,200));
      fs.writeFileSync(path.join(root,"docs/e2e/custom-target-editor.png"),(await win.webContents.capturePage()).toPNG());
      await clickText("保存目标");
      await waitFor("!document.querySelector('dialog[open]')");
      let custom=await evaluate("window.branchNote.inspect()");
      const target2=custom.data.projects[0].targets.find(t=>t.name==="测试2");
      assert.equal(custom.data.projects[0].targets.length,3);
      assert.equal(custom.data.projects[0].targets[0].id,"test");
      assert.equal(custom.data.branches[0].testMR.number,"42","rename must preserve old MR");
      await evaluate("document.querySelector('tbody .row-more button').click()");
      await clickText("提交测试2");
      await waitFor("document.querySelector('dialog').textContent.includes('提交测试2 MR')");
      await clickText("提交 MR");
      await waitFor("document.body.textContent.includes('等待在平台审核、合并')");
      custom=await evaluate("window.branchNote.inspect()");
      assert.equal(custom.calls.filter(c=>c[0]==="prepare").at(-1)[5].stage,target2.id);
      assert.equal(custom.calls.filter(c=>c[0]==="mr").at(-1)[3],"main");
      assert.equal(custom.calls.filter(c=>c[0]==="mr").at(-1)[4],"feat: feature/project-workspace");
      assert.equal(custom.calls.filter(c=>c[0]==="mr").at(-1)[5],"");
      assert.equal(custom.calls.filter(c=>c[0]==="mr").at(-1)[2],"feature/project-workspace");
      assert.equal(custom.data.branches[0].stages[target2.id].mr.number,"42");
      assert.equal(custom.data.branches[0].testMR.number,"42");
      await clickText("关闭");
      await new Promise(r=>setTimeout(r,200));
      fs.writeFileSync(path.join(root,"docs/e2e/custom-targets.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('.target-chip').click()");
      await waitFor("document.querySelectorAll('.target-config-row').length===3");
      await evaluate("document.querySelector('[aria-label=\"删除目标 测试2\"]').click()");
      await clickText("保存目标");
      await waitFor("!document.querySelector('dialog[open]')");
      custom=await evaluate("window.branchNote.inspect()");
      assert.equal(custom.data.projects[0].targets.length,2);
      assert.equal(custom.data.branches[0].stages[target2.id].mr.number,"42","deleting target must retain historical records");
      await clickText("从仓库添加分支");
      await waitFor("!!document.querySelector('.repository-project')");
      assert.equal(await evaluate("!!document.querySelector('[role=combobox][aria-label=所属项目]')"),false);
      assert.equal(await evaluate("document.querySelector('.repository-project strong').textContent"),"BranchNote");
      await evaluate("document.querySelector('dialog .modal-head button').click()");
      await clickText("编辑项目");
      await waitFor("!!document.querySelector('.form-label-inline')");
      assert.equal(await evaluate("document.querySelector('textarea[name=note]').parentElement.querySelector('.form-label-inline').textContent.includes('备注')"),true);
      await evaluate("document.querySelector('dialog .modal-head button').click()");
      await evaluate("(()=>{const extra=document.createElement('div');extra.id='scroll-fixture';extra.style.height='1800px';document.querySelector('main').appendChild(extra);document.querySelector('main').scrollTop=250;})()");
      const fixed=await evaluate("({toolbar:document.querySelector('.toolbar').getBoundingClientRect().top,sidebar:document.querySelector('.sidebar').getBoundingClientRect().top,scroll:document.querySelector('main').scrollTop})");
      assert.equal(fixed.toolbar,0);
      assert.equal(fixed.sidebar,0);
      assert.ok(fixed.scroll>0);
      assert.equal(await evaluate("scrollY"),0);
      await evaluate("document.querySelector('#scroll-fixture').remove();document.querySelector('main').scrollTop=0");
      await evaluate("document.querySelector('.target-chip').click()");
      for (let index=3;index<=8;index++) {
        await clickText("添加目标");
        await evaluate("(()=>{const input=document.querySelector('[aria-label=\"目标名称 "+index+"\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'环境"+index+"');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await evaluate("Array.from(document.querySelectorAll('.target-config-row [role=combobox]')).at(-1).click()");
        await evaluate("document.querySelector('.select-menu:popover-open [role=option]').click()");
      }
      await clickText("保存目标");
      await waitFor("!!document.querySelector('table.many-targets')");
      const layout=await evaluate("(()=>{const box=document.querySelector('.table-scroll');return {width:box.clientWidth,scroll:box.scrollWidth,count:document.querySelectorAll('tbody tr:first-child .target-status-cell').length};})()");
      assert.equal(layout.count,8);
      assert.ok(layout.scroll<=layout.width+1,"six targets must not cause horizontal scrolling");
      assert.ok(await evaluate("Array.from(document.querySelectorAll('.many-targets tbody tr')).every(row=>Array.from(row.querySelectorAll('.target-status-cell')).every(cell=>cell.getBoundingClientRect().bottom<=row.getBoundingClientRect().bottom))"),"wrapped targets remain inside branch card");
      assert.ok(await evaluate("(()=>{const rows=Array.from(document.querySelectorAll('.many-targets tbody tr'));return rows.every((row,index)=>index===0||row.getBoundingClientRect().top>=rows[index-1].getBoundingClientRect().bottom);})()"),"branch cards do not overlap");
      await new Promise(resolve=>setTimeout(resolve,250));
      fs.writeFileSync(path.join(root,"docs/e2e/six-targets.png"),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('tbody .row-more button').click()");
      assert.ok(await evaluate("document.querySelector('.row-menu').getBoundingClientRect().width<=140"),"compact operation menu");
      assert.ok(await evaluate("(()=>{const menu=Array.from(document.querySelectorAll('.target-menu-item'));const chips=Array.from(document.querySelectorAll('.target-chip'));return menu.every((item,index)=>getComputedStyle(item).color===getComputedStyle(chips[index].querySelector('.target-chip-name')).color);})()"),"menu colors match configured targets");
      assert.ok(await evaluate("Math.abs(document.querySelector('thead input[type=checkbox]').getBoundingClientRect().left-document.querySelector('tbody input[type=checkbox]').getBoundingClientRect().left)<1"),"select-all aligns with row checkboxes");

      await evaluate("document.querySelector('.menu-backdrop').click()");
      await evaluate("window.branchNote.setMRState('closed')");
      await clickText("刷新 MR");
      await waitFor("document.querySelector('tbody').textContent.includes('MR 已关闭')");
      assert.equal((await evaluate("window.branchNote.inspect()")).data.branches[0].testMR.state,"closed");
      await evaluate("window.branchNote.setMRState('opened');window.dispatchEvent(new Event('focus'))");
      await waitFor("document.querySelector('tbody').textContent.includes('MR 待合并')");
      await evaluate("window.branchNote.setMRState('merged')");
      await clickText("刷新 MR");
      await waitFor("!!document.querySelector('tbody .status.done')");
      assert.ok((await evaluate("window.branchNote.inspect()")).data.branches[0].testMergedAt);
      await clickText("删除项目");
      await waitFor("document.body.textContent.includes('确认删除项目')");
      await clickText("保留项目");
      assert.equal((await evaluate("window.branchNote.inspect()")).data.projects.length,1);
      await clickText("删除项目");
      await clickText("确认删除项目");
      await waitFor("document.querySelectorAll('.sidebar nav .nav-item').length===0");
      const deleted=await evaluate("window.branchNote.inspect()");
      assert.equal(deleted.data.projects.length,0);
      assert.equal(deleted.data.branches.length,0);
      console.log("PASS: batch MR, push failure stops creation, retry, target normalization, persisted pending MR, single release MR, desktop screenshots");
      app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
  });
}

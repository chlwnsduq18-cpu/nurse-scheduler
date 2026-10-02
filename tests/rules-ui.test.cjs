const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function page(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),dom=new JSDOM(html,{url:'https://scheduler.test/',runScripts:'outside-only'}),window=dom.window,context=dom.getInternalVMContext(),alerts=[];
 window.alert=message=>alerts.push(message);window.confirm=()=>true;
 for(const file of ['nurse-scheduler-model.js','nurse-scheduler-rules.js','nurse-scheduler-engine.js','nurse-scheduler.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 return {window,context,alerts,dom,doc:window.document,value:code=>vm.runInContext(code,context)};
}
function input(p,el,value){el.value=value;el.dispatchEvent(new p.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))}
function rowFor(p,type){return [...p.doc.querySelectorAll('.rule-item')].find(row=>row.querySelector('.rule-type').value===type)}
test('full page boots with saved migration, default additional rules, correct OFF count and fixed HN controls',()=>{
 const p=page();assert.equal(p.value('state.schemaVersion'),14);p.doc.getElementById('ruleSettings').click();
 assert.equal(p.doc.querySelectorAll('.rule-item').length,8);assert.equal(p.doc.getElementById('monthlyOffLimit').value,'10');
 assert.equal(p.doc.getElementById('monthlyOffLimit').disabled,true);assert.equal(p.doc.querySelector('#weekendSettings input[data-role="HN"]').disabled,true);
 assert.equal(p.doc.querySelector('#coverageSettings input[data-kind="saturday"][data-field="D"]').value,'1');p.dom.window.close();
});
test('editing and saving additional quota values passes through storage into actual scheduler configuration',()=>{
 const p=page();p.doc.getElementById('ruleSettings').click();input(p,rowFor(p,'nkMonthly').querySelector('.rule-number'),'10');p.doc.getElementById('saveRules').click();
 assert.equal(p.value('schedulerConfig().nkMonthly'),10);assert.equal(JSON.parse(p.window.localStorage.getItem('small-hospital-nurse-scheduler-v1')).rules.find(r=>r.type==='nkMonthly').value,'10');
 assert.equal(p.alerts.length,0);p.dom.window.close();
});
test('scope selectors, rule-type change and maximum zero survive round trip, then affect placement',()=>{
 const p=page();p.doc.getElementById('ruleSettings').click();p.doc.getElementById('addRule').click();const row=[...p.doc.querySelectorAll('.rule-item')].at(-1);
 input(p,row.querySelector('.rule-type'),'maximum');input(p,row.querySelector('.rule-shift'),'N');input(p,row.querySelector('.rule-group'),'nurse');input(p,row.querySelector('.rule-day'),'rest');input(p,row.querySelector('.rule-number'),'0');p.doc.getElementById('saveRules').click();
 assert.equal(p.value("coverageLimits(dayNumber('2026-09-05'),'N','nurse',schedulerConfig()).max"),0);assert.equal(p.value("coverageLimits(dayNumber('2026-09-07'),'N','nurse',schedulerConfig()).max"),Infinity);
 p.doc.getElementById('ruleSettings').click();assert.equal(rowFor(p,'maximum').querySelector('.rule-group').value,'nurse');p.dom.window.close();
});
test('invalid rule save and failed storage both preserve saved configuration',()=>{
 const p=page();p.doc.getElementById('ruleSettings').click();const before=p.value('JSON.stringify(state)');
 input(p,rowFor(p,'rnNightMin').querySelector('.rule-number'),'7');p.doc.getElementById('saveRules').click();assert.equal(p.value('JSON.stringify(state)'),before);assert.ok(p.alerts.at(-1).includes('최소'));
 input(p,rowFor(p,'rnNightMin').querySelector('.rule-number'),'4');input(p,rowFor(p,'nkMonthly').querySelector('.rule-number'),'9');p.window.Storage.prototype.setItem=()=>{throw Error('quota exceeded')};p.doc.getElementById('saveRules').click();assert.equal(p.value('JSON.stringify(state)'),before);p.dom.window.close();
});
test('Worker path copies state, terminates cleanly, and discards result after an intervening edit',async()=>{
 const p=page(),workers=[];
 class Worker{constructor(url){this.url=String(url);workers.push(this)}postMessage(message){this.input=structuredClone(message)}terminate(){this.terminated=true}}
 p.window.Worker=Worker;p.doc.getElementById('autoGenerate').click();assert.equal(workers.length,1);assert.match(workers[0].url,/nurse-scheduler-worker/);
 p.value("state.wanted['2026-09-01:1']='D';state.assignments['2026-09-01:1']=1;state.assignments['2026-09-01:1_type']='D'");
 workers[0].onmessage({data:{result:{plan:{},month:'2026-09'}}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(workers[0].terminated,true);assert.equal(p.doc.getElementById('autoGenerate').disabled,false);assert.equal(p.value("state.wanted['2026-09-01:1']"),'D');assert.ok(p.alerts.at(-1).includes('바뀌어'));assert.equal(p.value('state.generationSnapshot'),null);p.dom.window.close();
});
test('Worker errors restore button and preserve data',async()=>{
 const p=page();let worker;p.window.Worker=class{constructor(){worker=this}postMessage(){}terminate(){}};const before=p.value('JSON.stringify(state)');
 p.doc.getElementById('autoGenerate').click();worker.onerror();await new Promise(resolve=>setImmediate(resolve));assert.equal(p.value('JSON.stringify(state)'),before);assert.equal(p.doc.getElementById('autoGenerate').disabled,false);assert.ok(p.alerts.at(-1).includes('계산 파일'));p.dom.window.close();
});
test('background Worker executes the same engine and returns without any persistence access',()=>{
 const messages=[],context={self:{postMessage:message=>messages.push(message)},Date,console};vm.createContext(context);
 context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file.split('?')[0]),'utf8'),context));
 vm.runInContext(fs.readFileSync(path.join(root,'nurse-scheduler-worker.js'),'utf8'),context);
 const state={staff:[{id:1,name:'NK',category:'NK'}],monthStaff:{},wanted:{},manual:{},assignments:{},leave:{},rules:[{type:'nkMonthly',value:0}],holidayYears:{},monthOffLimits:{}};
 context.self.onmessage({data:{state,year:2026,month:8}});assert.equal(messages.length,1);assert.equal(messages[0].error,undefined);assert.equal(messages[0].result.month,'2026-09');assert.equal(Object.values(messages[0].result.plan).filter(sh=>sh==='N').length,0);
});

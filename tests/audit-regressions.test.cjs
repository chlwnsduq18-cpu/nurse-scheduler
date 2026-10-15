const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..'),KEY='small-hospital-nurse-scheduler-v1';
function page(raw,{denyRead=false,clock=[2026,8,1]}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://scheduler.test/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext(),alerts=[];
 w.alert=m=>alerts.push(m);w.confirm=()=>true;w.Date=class extends w.Date{constructor(...args){super(...(args.length?args:clock))}};if(raw!==undefined)w.localStorage.setItem(KEY,typeof raw==='string'?raw:JSON.stringify(raw));
 if(denyRead)w.Storage.prototype.getItem=()=>{throw Error('blocked')};
 for(const file of ['nurse-scheduler-model.js','nurse-scheduler-rules.js','nurse-scheduler-engine.js','nurse-scheduler.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
 return {dom,w,doc:w.document,alerts,value:s=>vm.runInContext(s,ctx),close:()=>dom.window.close()};
}
const drop=(p,from,date)=>p.value(`moveAssignmentToDate({dataTransfer:{getData:key=>key==='assignmentKey'?${JSON.stringify(from)}:''}},${JSON.stringify(date)})`);
test('dragging into generated OFF works and preserves source and destination provenance',()=>{
 const p=page();try{
 p.value("saveUserShift('2026-09-01:1','D',true);putAssignment('2026-09-02:1','O');");drop(p,'2026-09-01:1','2026-09-02');
 assert.equal(p.value("state.wanted['2026-09-02:1']"),'D');assert.equal(p.value("state.manual['2026-09-01:1']"),'O');assert.equal(p.value("hasWanted('2026-09-01:1')"),false);
 }finally{p.close()}
});
test('dragging never silently overwrites protected OFF or vacation; staff drop opens the existing cell',()=>{
 const p=page();try{
 p.value("saveUserShift('2026-09-01:1','D',true);saveUserShift('2026-09-02:1','V',true);");let before=p.value('JSON.stringify(state)');drop(p,'2026-09-01:1','2026-09-02');assert.equal(p.value('JSON.stringify(state)'),before);
 p.value("moveAssignmentToDate({dataTransfer:{getData:key=>key==='staffId'?'1':''}},'2026-09-02')");
 assert.equal(p.doc.getElementById('assignmentModal').classList.contains('open'),true);assert.equal(p.value('assignmentShiftType'),'V');
 }finally{p.close()}
});
test('staff edit, add, delete, release and drag roll back when persistence fails',()=>{
 const p=page();try{
 p.value("saveUserShift('2026-09-01:1','D',true);putAssignment('2026-09-02:1','O');render();Storage.prototype.setItem=()=>{throw Error('quota')}");const before=p.value('JSON.stringify(state)');
 p.value("openStaffModal(1);staffNameInput.value='바뀐이름';saveStaff.onclick()");assert.equal(p.value('JSON.stringify(state)'),before);assert.equal(p.doc.getElementById('staffModal').classList.contains('open'),true);
 p.value("openStaffModal();staffNameInput.value='추가직원';saveStaff.onclick()");assert.equal(p.value('JSON.stringify(state)'),before);
 p.doc.querySelector('.staff[data-id="1"] .del:not(.edit)').click();assert.equal(p.value('JSON.stringify(state)'),before);
 p.value("openShiftModal('2026-09-01:1');deleteAssignment.onclick()");assert.equal(p.value('JSON.stringify(state)'),before);
 drop(p,'2026-09-01:1','2026-09-02');assert.equal(p.value('JSON.stringify(state)'),before);
 }finally{p.close()}
});
test('broken stored JSON and invalid structures never overwrite the original saved data',async()=>{
 for(const raw of ['{broken','[]','null','{"staff":[],"rules":[null]}']){
 const p=page(raw);try{
 assert.equal(p.w.localStorage.getItem(KEY),raw);assert.ok(p.doc.getElementById('generationStatus').textContent.includes('原本')||p.doc.getElementById('generationStatus').textContent.includes('원본'));
 assert.equal(p.value("saveUserShift('2026-09-01:1','D',true)"),false);assert.equal(p.value('generateMonth()'),false);await p.value('exportExcel.onclick()');assert.ok(p.alerts.at(-1).includes('원본을 보호'));assert.equal(p.w.localStorage.getItem(KEY),raw);
 }finally{p.close()}}
});
test('denied storage access shows a warning while still rendering the page',()=>{
 const p=page(undefined,{denyRead:true});try{assert.ok(p.doc.getElementById('monthTitle').textContent);assert.ok(p.alerts[0].includes('저장 데이터'));assert.equal(p.value('save()'),false)}finally{p.close()}
});
test('unsupported saved rule can be removed without breaking the settings dialog',()=>{
 const p=page({staff:[{id:1,name:'직원',category:'RN'}],assignments:{},rules:[{type:'legacy-rule',value:3}],schemaVersion:14});try{
 p.doc.getElementById('ruleSettings').click();const bad=p.doc.querySelector('#ruleList .rule-item');assert.ok(bad.textContent.includes('지원하지 않는 규칙'));bad.querySelector('.rule-remove').click();p.doc.getElementById('saveRules').click();assert.equal(p.value('state.rules.length'),0);
 }finally{p.close()}
});
test('invalid actual work hours cannot be saved as confirmed settings',()=>{
 const p=page();try{
 p.doc.getElementById('ruleSettings').click();const before=p.value('JSON.stringify(state)');p.doc.querySelector('#shiftTimeSettings input[data-code="D"][data-field="end"]').value='22:00';p.doc.getElementById('confirmShiftTimes').checked=true;p.doc.getElementById('saveRules').click();assert.equal(p.value('JSON.stringify(state)'),before);assert.ok(p.alerts.at(-1).includes('8시간'));
 assert.equal(p.value("validShiftTime({start:'25:00',end:'07:00',breakMinutes:30})"),false);
 }finally{p.close()}
});
test('draft holiday change updates automatic OFF preview before saving',()=>{
 const p=page();try{
 p.doc.getElementById('ruleSettings').click();const textarea=p.doc.getElementById('holidayDates');textarea.value+='\n2026-09-07 추가휴일';textarea.dispatchEvent(new p.w.Event('input',{bubbles:true}));assert.equal(p.doc.getElementById('monthlyOffLimit').value,'11');assert.ok(p.doc.getElementById('offCalendarCount').textContent.startsWith('11일'));p.doc.getElementById('saveRules').click();assert.equal(p.value('monthlyOffLimit()'),11);
 }finally{p.close()}
});
test('partial historical roster and time settings open without deleting custom values',()=>{
 const p=page({staff:[{id:1,name:'직원',category:'RN'}],assignments:{},rules:[],schemaVersion:14,rosterSettings:{coverage:{weekday:{D:3}}},shiftTimes:{D:{start:'07:00',end:'15:00',breakMinutes:30}}});try{
 p.doc.getElementById('ruleSettings').click();assert.equal(p.value('rosterSettings().coverage.weekday.D'),3);assert.equal(p.value('rosterSettings().coverage.saturday.E'),1);assert.equal(p.value("shiftTiming('E').hours"),7.5);
 }finally{p.close()}
});

test('automatic shifts obey rest and weekly limits across months under strengthened settings',()=>{
 for(const [year,month]of [[2026,2],[2026,3],[2026,12],[2027,1]]){
 const p=page();try{
 p.value(`cursor=new Date(${year},${month-1},1);state.staff=[{id:1,name:'가',category:'NK'},{id:2,name:'나',category:'NK'}];state.monthStaff={};state.assignments={};state.wanted={};state.manual={};state.leave={};state.generationSnapshot=null;state.holidayYears[${year}]={dates:{},confirmed:true};state.rules=[{type:'nkMonthly',value:12},{type:'nightRest',value:3},{type:'weeklyOff',value:3}];`);
 const ok=p.value(`(()=>{const r=solveMonth(),cfg=schedulerConfig();for(const date of getMonthDates())for(const st of activeStaff()){const k=keyFor(date,st.id),sh=r.plan[k];if(sh!=='O'&&staffProblems(r.plan,dayNumber(k.split(':')[0]),st,sh,cfg).length)return false}return true})()`);assert.equal(ok,true,year+'-'+month);
 }finally{p.close()}}
});

test('the opening month follows today rather than the old September 2026 release date',()=>{
 const p=page(undefined,{clock:[2027,6,13]});try{assert.equal(p.value('rosterMonth()'),'2027-07');assert.equal(p.value('cursor.getDate()'),1)}finally{p.close()}
});
test('blank manual OFF never silently saves as zero; switching back uses draft holidays',()=>{
 const p=page();try{
 p.doc.getElementById('ruleSettings').click();const manual=p.doc.getElementById('offModeManual'),off=p.doc.getElementById('monthlyOffLimit'),dates=p.doc.getElementById('holidayDates');
 manual.checked=true;manual.dispatchEvent(new p.w.Event('change'));off.value='';const before=p.value('JSON.stringify(state)');p.doc.getElementById('saveRules').click();assert.equal(p.value('JSON.stringify(state)'),before);assert.ok(p.alerts.at(-1).includes('일수를 입력'));
 off.value='9';dates.value+='\n2026-09-07 추가휴일';dates.dispatchEvent(new p.w.Event('input'));assert.equal(off.value,'9');manual.checked=false;manual.dispatchEvent(new p.w.Event('change'));assert.equal(off.value,'11');
 }finally{p.close()}
});

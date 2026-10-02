const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../nurse-scheduler.js'),'utf8');
function setup({year=2026,month=9,roles=['RN','RN','RN','RN','NK','NK'],rules=[],coverage}={}){
 const c={state:{staff:roles.map((category,i)=>({id:i+1,name:category+(i+1),category})),rules,assignments:{},wanted:{},manual:{},leave:{},monthStaff:{},holidayYears:{},monthOffLimits:{},monthOffModes:{}},cursor:new Date(year,month-1,1),pad:n=>String(n).padStart(2,'0'),save:()=>true,alert:()=>{},render:()=>{},KEY:'test',localStorage:{setItem(){}}};
 c.keyFor=(d,id)=>`${d.getFullYear()}-${c.pad(d.getMonth()+1)}-${c.pad(d.getDate())}:${id}`;
 c.getMonthDates=()=>Array.from({length:new Date(c.cursor.getFullYear(),c.cursor.getMonth()+1,0).getDate()},(_,i)=>new Date(c.cursor.getFullYear(),c.cursor.getMonth(),i+1));c.hasWanted=k=>Object.hasOwn(c.state.wanted,k);
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function putAssignment'),src.indexOf('function removeRelated')),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../nurse-scheduler-model.js'),'utf8'),c);
 vm.runInContext(src.slice(src.indexOf('function ensureMonthStaff'),src.indexOf('function openMonthStaff')),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../nurse-scheduler-rules.js'),'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../nurse-scheduler-engine.js'),'utf8'),c);
 vm.runInContext(src.slice(src.indexOf('function generateMonth'),src.indexOf('autoGenerate.onclick')),c);
 c.isoDay=vm.runInContext('isoDay',c);
 if(coverage)c.state.rosterSettings={weekend:{RN:true,NK:true,AN:true,HN:false,MD:false},coverage};
 return c;
}
module.exports={setup};
const n=date=>Date.parse(date+'T00:00:00Z')/86400000;
const quietCoverage=()=>Object.fromEntries(['weekday','saturday','holiday'].map(kind=>[kind,{D:0,E:0,N:0,AD:0,AE:0,AN:0}]));
test('v14 migration preserves protected rosters, custom AN settings, existing rules, then runs once',()=>{
 const c=setup();c.state.schemaVersion=13;c.state.rules=[{type:'nkMonthly',value:12},{type:'preferred',shift:'E'},{type:'nightRest',value:0}];
 c.state.rosterSettings={weekend:{HN:true,MD:true,RN:true},coverage:{weekday:{D:7,E:5,N:3,AD:2,AE:1,AN:0},saturday:{D:2,E:1,N:1,AD:3,AE:0,AN:1},holiday:{D:1,E:1,N:1,AD:1,AE:1,AN:2}}};
 c.setWanted('2026-09-05:1','D');c.setManual('2026-09-06:1','E');const saved=JSON.stringify([c.state.wanted,c.state.manual,c.state.assignments]);
 c.migrateRosterRules(c.state);assert.equal(c.state.schemaVersion,14);assert.equal(c.state.rosterSettings.weekend.HN,false);
 assert.equal(c.state.rosterSettings.coverage.saturday.D,1);assert.equal(c.state.rosterSettings.coverage.saturday.AD,3);
 assert.equal(c.schedulerConfig().nkMonthly,12);assert.equal(c.schedulerConfig().nightRest,2);assert.equal(c.schedulerConfig().rnNightMin,4);
 assert.equal(JSON.stringify([c.state.wanted,c.state.manual,c.state.assignments]),saved);
 c.state.rosterSettings.coverage.saturday.D=3;c.migrateRosterRules(c.state);assert.equal(c.state.rosterSettings.coverage.saturday.D,3);
});
test('calendar OFF counts dates once; holiday edits and manual override are month-specific',()=>{
 const c=setup();assert.equal(c.calendarOffCount(),10);assert.equal(c.monthlyOffLimit(),10);
 c.state.monthOffLimits['2026-09']=9;assert.equal(c.monthlyOffLimit(),10,'old manual values do not override new calendar defaults');
 c.state.holidayYears[2026]={dates:{'2026-09-05':'overlap','2026-09-07':'weekday'},confirmed:true};assert.equal(c.calendarOffCount(),9);
 c.state.monthOffModes['2026-09']='manual';assert.equal(c.monthlyOffLimit(),9);c.state.monthOffLimits['2026-09']=7;assert.equal(c.monthlyOffLimit(),7);
 c.cursor=new Date(2026,9,1);assert.equal(c.monthlyOffLimit(),9);
});
test('RN D/E fixed staffing excludes HN and weekday holiday uses one nurse',()=>{
 const c=setup({roles:['HN','RN','RN','NK','AN']}),cfg=c.schedulerConfig();
 for(const date of ['2026-09-05','2026-09-06','2026-09-24']){
   const ds=c.dayDemands(n(date),cfg);for(const key of ['D','E']){const d=ds.find(d=>d.key===key);assert.deepEqual([...d.roles],['RN']);assert.equal(d.min,1);assert.equal(d.max,1)}
   assert.equal(ds.find(d=>d.key==='NR').min,1);assert.equal(c.dayAllowed(c.state.staff[0],n(date)),false);
 }
 assert.equal(c.dayDemands(n('2026-09-07'),cfg).find(d=>d.key==='D').min,2);
 assert.equal(c.dayDemands(n('2026-09-07'),cfg).find(d=>d.key==='NR').roles.length,2);
});
test('scope-aware zero minimum/maximum applies to placement, demand, and analysis; first identical rule wins',()=>{
 const c=setup({roles:['RN','NK','AN'],rules:[{type:'maximum',shift:'N',group:'nurse',day:'rest',value:0},{type:'maximum',shift:'N',group:'nurse',day:'rest',value:3},{type:'minimum',shift:'D',group:'AN',day:'weekday',value:2}]});
 const cfg=c.schedulerConfig();assert.equal(c.coverageLimits(n('2026-09-05'),'N','nurse',cfg).max,0);
 assert.equal(c.canPlace({},n('2026-09-05'),c.state.staff[1],'N',cfg),false);
 assert.equal(c.coverageLimits(n('2026-09-07'),'N','nurse',cfg).max,Infinity);
 assert.equal(c.dayDemands(n('2026-09-07'),cfg).find(d=>d.key==='AD').min,2);
 const problems=c.analyzeMonth({'2026-09-05:2':'N'});assert.ok(problems['2026-09-05'].some(s=>s.includes('최대 인원 초과')));
 assert.ok(problems['2026-09-05'].some(s=>s.includes('최소 1명과 최대 0명 충돌')));
});
test('monthly RN and NK configured quotas change actual generated output; no unprotected upper-limit breaches',()=>{
 for(const limit of [0,4]){
   const c=setup({roles:['RN','RN','NK','NK'],coverage:quietCoverage(),rules:[{type:'rnNightMin',value:limit},{type:'rnNightMax',value:limit},{type:'nkMonthly',value:limit},{type:'nightMinBlock',value:2}]});
   // N minimum is one on all days, so zero quotas cannot be hidden as success.
   for(const row of Object.values(c.state.rosterSettings.coverage))row.N=1;
   const r=c.solveMonth();assert.deepEqual([...c.nkBalance(r.plan).counts],[limit,limit]);assert.deepEqual([...c.rnNightBalance(r.plan).counts],[limit,limit]);
   assert.ok(Object.values(c.analyzeMonth(r.plan)).flat().some(s=>s.includes('月')||s.includes('월 RN/NK N 최소')));
 }
});
test('additional N maximum zero reaches generation, including independent NK repair',()=>{
 const c=setup({roles:['NK','NK'],coverage:quietCoverage(),rules:[{type:'maximum',shift:'N',group:'nurse',value:0}]});
 for(const row of Object.values(c.state.rosterSettings.coverage))row.N=1;
 const r=c.solveMonth();assert.deepEqual([...c.nkBalance(r.plan).counts],[0,0]);assert.ok(r.missing>0);
});
test('additional N block length and post-night rest constrain real generated output',()=>{
 const c=setup({roles:['NK','NK'],coverage:quietCoverage(),rules:[{type:'nkMonthly',value:12},{type:'nightMinBlock',value:2},{type:'nightMaxBlock',value:2},{type:'nightRest',value:3}]});
 for(const row of Object.values(c.state.rosterSettings.coverage))row.N=1;
 const r=c.solveMonth();assert.deepEqual([...c.nkBalance(r.plan).counts],[12,12]);
 for(const st of c.state.staff)for(const d of c.getMonthDates())if(r.plan[c.keyFor(d,st.id)]==='N'){
   const day=n(c.keyFor(d,0).split(':')[0]);assert.equal(c.nightRun(r.plan,day,st.id).length,2);
   assert.deepEqual([...c.staffProblems(r.plan,day,st,'N',c.schedulerConfig())],[]);
 }
});
test('work rules, rest hours, preference and duplicate precedence are all consumed',()=>{
 const c=setup({roles:['AN'],coverage:quietCoverage(),rules:[{type:'weeklyOff',value:4},{type:'maxConsecutive',value:2},{type:'maxConsecutive',value:5},{type:'preferred',shift:'E'},{type:'minRestHours',value:20}]});
 const cfg=c.schedulerConfig();assert.equal(cfg.maxWeekly,3);assert.equal(cfg.maxConsecutive,2);assert.equal(cfg.minRestHours,20);assert.equal(c.preferenceScore('E',cfg),-8);
 const day=n('2026-09-07');assert.ok(c.staffProblems({'2026-09-06:1':'E'},day,c.state.staff[0],'D',cfg).some(s=>s.includes('20시간')));
 const r=c.solveMonth();let e=0,d=0;
 for(const date of c.getMonthDates()){const sh=r.plan[c.keyFor(date,1)];if(sh==='E')e++;if(sh==='D')d++;if(sh!=='O')assert.deepEqual([...c.staffProblems(r.plan,n(c.keyFor(date,0).split(':')[0]),c.state.staff[0],sh,cfg)],[])}
 assert.ok(e>d,'preferred evening influences generated shifts');
});
test('invalid values, unknown rule types and crossed monthly/block bounds are visible, never silently ignored',()=>{
 const c=setup();for(const rules of [[{type:'rnNightMin',value:7},{type:'rnNightMax',value:5}],[{type:'nkMonthly',value:1.5}],[{type:'unknown',value:1}],[{type:'nightMinBlock',value:3},{type:'nightMaxBlock',value:2}]]){
   assert.ok(c.validateRules(rules).length);c.state.rules=rules;assert.equal(c.generateMonth(),false);
 }
});
test('personal upper limits never overwrite conflicting wanted shifts; analysis exposes RN excess',()=>{
 const c=setup({roles:['RN'],coverage:quietCoverage(),rules:[{type:'rnNightMax',value:5}]});
 for(let day=1;day<=7;day++)c.setWanted(`2026-09-${c.pad(day)}:1`,'N');
 const r=c.solveMonth();for(let day=1;day<=7;day++)assert.equal(r.plan[`2026-09-${c.pad(day)}:1`],'N');
 assert.equal(c.monthlyNights(r.plan,1),7);assert.ok(Object.values(c.analyzeMonth(r.plan)).flat().some(s=>s.includes('RN 월 N 7회')));
});

test('M minimum for a disallowed group/day reports shortage instead of silently dropping the rule',()=>{const c=setup({roles:['AN'],rules:[{type:'minimum',shift:'M',group:'AN',day:'weekday',value:1}]});const d=c.dayDemands(n('2026-09-07')).find(d=>d.key==='XM');assert.equal(d.min,1);assert.deepEqual([...d.roles],['AN']);assert.ok(c.analyzeMonth({})['2026-09-07'].some(s=>s.includes('M(AN·기본 담당일과 충돌)')));});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../nurse-scheduler.js'),'utf8');
function setup(){
 const state={staff:[{id:1,name:'가',category:'RN'},{id:2,name:'나',category:'RN'},{id:3,name:'다',category:'AN'}],monthStaff:{'2026-08':[1,2,3]},assignments:{'2026-09-01:2':1,'2026-09-01:2_type':'N'},wanted:{'2026-09-02:2':'O'},leave:{'2026-09-02:2':'vacation'},generationSnapshot:{month:'2026-09',shifts:{'2026-09-01:2':'N'}},rules:[],holidayYears:{}};
 const c={state,cursor:new Date(2026,8,1),pad:n=>String(n).padStart(2,'0'),save:()=>true,alert:()=>{},render:()=>{},KEY:'test',localStorage:{setItem(){}}};
 c.keyFor=(d,id)=>`${d.getFullYear()}-${c.pad(d.getMonth()+1)}-${c.pad(d.getDate())}:${id}`;
 c.getMonthDates=()=>Array.from({length:30},(_,i)=>new Date(2026,8,i+1));c.hasWanted=k=>Object.hasOwn(c.state.wanted,k);
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function putAssignment'),src.indexOf('function removeRelated')),c);vm.runInContext(src.slice(src.indexOf('function rosterMonth'),src.indexOf('function openMonthStaff')),c);
 vm.runInContext(src.slice(src.indexOf('const DAY_MS='),src.indexOf('function renderRosterSettings')),c);
 vm.runInContext(src.slice(src.indexOf('function generateMonth'),src.indexOf('autoGenerate.onclick')),c);
 return c;
}
test('monthly membership is independent, inherited once, and follows global order',()=>{
 const c=setup();c.ensureMonthStaff();assert.deepEqual([...c.monthStaffIds()],[1,2,3]);
 c.saveMonthStaff([1,3]);c.reorderStaff(3,1);assert.deepEqual(c.activeStaff().map(s=>s.id),[3,1]);
 assert.deepEqual([...c.state.monthStaff['2026-08']],[1,2,3]);
 c.cursor=new Date(2026,9,1);c.ensureMonthStaff();assert.deepEqual([...c.monthStaffIds()],[1,3]);
 c.cursor=new Date(2026,8,1);c.saveMonthStaff([2]);assert.deepEqual([...c.state.monthStaff['2026-10']],[1,3]);
});
test('exclusion removes staffing counts but preserves data; inclusion restores it',()=>{
 const c=setup(),before=JSON.stringify([c.state.assignments,c.state.wanted,c.state.leave,c.state.generationSnapshot]);
 c.ensureMonthStaff();c.saveMonthStaff([1]);assert.equal(c.currentPlan()['2026-09-01:2'],undefined);
 assert.equal(c.countShift({'2026-09-01:2':'N'},Date.UTC(2026,8,1)/86400000,'N'),0);
 assert.equal(JSON.stringify([c.state.assignments,c.state.wanted,c.state.leave,c.state.generationSnapshot]),before);
 c.saveMonthStaff([1,2]);assert.equal(c.currentPlan()['2026-09-01:2'],'N');
});
test('generation only changes included staff and preserves excluded snapshots',()=>{
 const c=setup();c.ensureMonthStaff();c.saveMonthStaff([1]);
 assert.equal(c.generateMonth(),true);
 assert.equal(c.state.assignments['2026-09-01:2_type'],'N');
 assert.equal(c.state.generationSnapshot.shifts['2026-09-01:2'],'N');
 assert.equal(c.state.wanted['2026-09-02:2'],'O');assert.equal(c.state.leave['2026-09-02:2'],'vacation');
 assert.equal(c.state.assignments['2026-09-03:2'],undefined);
 c.saveMonthStaff([]);const before=JSON.stringify(c.state);assert.equal(c.generateMonth(),false);assert.equal(JSON.stringify(c.state),before);
});
test('failed persistence rolls back order and membership',()=>{
 const c=setup();c.ensureMonthStaff();const before=JSON.stringify(c.state);c.save=()=>false;
 assert.equal(c.reorderStaff(3,1),false);assert.equal(c.saveMonthStaff([]),false);assert.equal(JSON.stringify(c.state),before);
});
test('wanted toggle separates manual provenance, preserves vacation and supports rollback',()=>{
 const c=setup(),key='2026-09-07:1';
 assert.equal(c.saveUserShift(key,'V',true),true);assert.equal(c.hasWanted(key),true);assert.equal(c.isVacation(key),true);
 assert.equal(c.saveUserShift(key,'V',false),true);assert.equal(c.hasWanted(key),false);assert.equal(c.hasManual(key),true);assert.equal(c.isVacation(key),true);
 c.setWanted(key,'D');assert.equal(c.hasManual(key),false);assert.equal(c.isVacation(key),false);
 const before=JSON.stringify(c.state);c.save=()=>false;assert.equal(c.saveUserShift(key,'N',false),false);assert.equal(JSON.stringify(c.state),before);
});
test('entered OFF counts toward two weekly days off rather than subtracting extra workdays',()=>{
 const c=setup(),n=Date.UTC(2026,8,7)/86400000,cfg=c.schedulerConfig();
 c.setWanted('2026-09-08:1','O');c.setManual('2026-09-10:1','O');
 assert.equal(c.weeklyWorkTarget(n,1,cfg),5);assert.equal(c.offNeighbourPriority(n+2,1),2);
 c.setWanted('2026-09-11:1','O');assert.equal(c.weeklyWorkTarget(n,1,cfg),4);
 const plan=c.currentPlan();assert.equal(c.canPlace(plan,n+1,c.state.staff[0],'D',cfg),false);
 assert.equal(c.canPlace(plan,n+2,c.state.staff[0],'D',cfg),true);
});
test('weekend and public holiday demand uses RN or NK plus separate AN',()=>{
 const c=setup(),cfg=c.schedulerConfig();
 for(const date of ['2026-09-05','2026-09-06','2026-09-24']){
  const n=Date.parse(date+'T00:00:00Z')/86400000,demands=c.dayDemands(n,cfg);
  const night=demands.filter(d=>d.shift==='N');assert.equal(night.length,2);
  assert.deepEqual([...night[0].roles],['RN','NK']);assert.equal(night[0].min,1);
  assert.deepEqual([...night[1].roles],['AN']);assert.equal(night[1].min,1);
  assert.equal(demands.find(d=>d.key==='D').min,date==='2026-09-05'?2:1);assert.equal(demands.find(d=>d.key==='E').min,1);
 }
 const n=Date.UTC(2026,8,6)/86400000,plan={'2026-09-06:1':'D'};
 assert.equal(c.canPlace(plan,n,c.state.staff[1],'D',cfg),false);
});
test('NK exact half targets and equal-length N/rest preference',()=>{
 const c=setup();c.state.staff=[{id:1,name:'NK1',category:'NK'},{id:2,name:'NK2',category:'NK'}];c.state.monthStaff={'2026-09':[1,2]};c.state.assignments={};c.state.wanted={};
 const result=c.solveMonth();assert.equal(c.nkBalance(result.plan).penalty,0);
 assert.deepEqual([...c.nkBalance(result.plan).counts],[15,15]);
 const dates=c.getMonthDates().map(d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
 assert.equal(c.nkRestPreference(result.plan,dates),0);
 for(const days of [28,29,30,31])for(let attempt=0;attempt<6;attempt++){
  const blocks=c.nkTemplate(days,attempt),counts=[0,0];for(const b of blocks){assert.ok([2,3].includes(b.len));counts[b.who]+=b.len;}
  assert.deepEqual(counts.sort((a,b)=>a-b),[Math.floor(days/2),Math.ceil(days/2)]);
 }
});
test('general manual shifts remain fixed during regeneration, including invalid requests',()=>{
 const c=setup();c.ensureMonthStaff();c.saveMonthStaff([1]);c.setManual('2026-09-07:1','D');c.setManual('2026-09-08:1','O');
 for(let day=14;day<=19;day++)c.setWanted(`2026-09-${day}:1`,'D');
 const result=c.solveMonth();assert.equal(result.plan['2026-09-07:1'],'D');assert.equal(result.plan['2026-09-08:1'],'O');
 for(let day=14;day<=19;day++)assert.equal(result.plan[`2026-09-${day}:1`],'D');
});
test('two fixed OFF days are followed by work on all other feasible days in that week',()=>{
 const c=setup();c.state.staff=[{id:1,name:'RN',category:'RN'}];c.state.monthStaff={'2026-09':[1]};c.state.assignments={};c.state.wanted={};
 // Isolate OFF placement from mandatory night-rest conflicts.
 c.state.rosterSettings={weekend:{RN:true},coverage:{weekday:{D:1,E:0,N:0,AD:0,AE:0,AN:0},saturday:{D:1,E:0,N:0,AD:0,AE:0,AN:0},holiday:{D:1,E:0,N:0,AD:0,AE:0,AN:0}}};
 c.setWanted('2026-09-08:1','O');c.setManual('2026-09-10:1','O');
 const result=c.solveMonth();
 for(const day of ['07','09','11','12','13'])assert.notEqual(result.plan[`2026-09-${day}:1`],'O',day);
});
test('both pickers save immediately using their wanted checkbox',()=>{
 const c=setup(),nodes={},buttons=()=>['D','E','N','M','O','V'].map(shift=>({dataset:{shift},classList:{toggle(){}}})),assignmentButtons=buttons(),shiftButtons=buttons();
 const node=()=>({value:'',checked:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){}});
 c.document={getElementById:id=>nodes[id]??=(node()),querySelectorAll:selector=>selector.startsWith('#assignmentShiftOptions')?assignmentButtons:shiftButtons};
 for(const name of ['assignmentDateInput','assignmentStaffInput','assignmentModal','cancelAssignmentModal','saveAssignment','shiftModal','deleteAssignment'])c[name]=node();
 c.assignmentDateInput.value='2026-09-07';c.assignmentStaffInput.value='1';
 vm.runInContext(src.slice(src.indexOf('let assignmentShiftType='),src.indexOf('let ruleDraft=')),c);
 nodes.assignmentWanted=node();nodes.assignmentWanted.checked=false;
 assignmentButtons[0].onclick();assert.equal(c.state.manual['2026-09-07:1'],'D');assert.equal(c.hasWanted('2026-09-07:1'),false);
 nodes.assignmentWanted.checked=true;assignmentButtons[2].onclick();assert.equal(c.state.wanted['2026-09-07:1'],'N');
 vm.runInContext(src.slice(src.indexOf('let editingAssignmentKey='),src.indexOf('document.addEventListener("keydown"')),c);
 nodes.shiftWanted=node();nodes.shiftWanted.checked=false;vm.runInContext("editingAssignmentKey='2026-09-08:1'",c);
 shiftButtons[5].onclick();assert.equal(c.state.manual['2026-09-08:1'],'O');assert.equal(c.isVacation('2026-09-08:1'),true);
});
for(const [year,month,days] of [[2026,2,28],[2028,2,29],[2026,10,31]])test(`NK generation covers half each in ${days}-day month`,()=>{
 const c=setup();c.cursor=new Date(year,month-1,1);c.getMonthDates=()=>Array.from({length:days},(_,i)=>new Date(year,month-1,i+1));
 c.state.staff=[{id:1,name:'NK1',category:'NK'},{id:2,name:'NK2',category:'NK'}];c.state.monthStaff={[`${year}-${String(month).padStart(2,'0')}`]:[1,2]};c.state.assignments={};c.state.wanted={};c.state.generationSnapshot=null;
 const result=c.solveMonth();assert.equal(c.nkBalance(result.plan).penalty,0);assert.deepEqual([...c.nkBalance(result.plan).counts].sort((a,b)=>a-b),[Math.floor(days/2),Math.ceil(days/2)]);
});
test('impossible NK half target is reported without overwriting wanted OFF',()=>{
 const c=setup();c.state.staff=[{id:1,name:'NK1',category:'NK'},{id:2,name:'NK2',category:'NK'}];c.state.monthStaff={'2026-09':[1,2]};c.state.assignments={};c.state.wanted={};
 for(let d=1;d<=30;d++)c.setWanted(`2026-09-${String(d).padStart(2,'0')}:1`,'O');
 const result=c.solveMonth();assert.ok(c.nkBalance(result.plan).penalty>0);
 assert.ok(Object.values(c.analyzeMonth(result.plan)).flat().some(s=>s.includes('절반 분담 미충족')));
 for(let d=1;d<=30;d++)assert.equal(result.plan[`2026-09-${String(d).padStart(2,'0')}:1`],'O');
});

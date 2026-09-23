const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../nurse-scheduler.js'),'utf8');
function setup(){
 const state={staff:[{id:1,name:'가',category:'RN'},{id:2,name:'나',category:'RN'},{id:3,name:'다',category:'AN'}],monthStaff:{'2026-08':[1,2,3]},assignments:{'2026-09-01:2':1,'2026-09-01:2_type':'N'},wanted:{'2026-09-02:2':'O'},leave:{'2026-09-02:2':'vacation'},generationSnapshot:{month:'2026-09',shifts:{'2026-09-01:2':'N'}},rules:[],holidayYears:{}};
 const c={state,cursor:new Date(2026,8,1),pad:n=>String(n).padStart(2,'0'),save:()=>true,alert:()=>{},render:()=>{},KEY:'test',localStorage:{setItem(){}}};
 c.keyFor=(d,id)=>`${d.getFullYear()}-${c.pad(d.getMonth()+1)}-${c.pad(d.getDate())}:${id}`;
 c.getMonthDates=()=>Array.from({length:30},(_,i)=>new Date(2026,8,i+1));c.hasWanted=k=>Object.hasOwn(c.state.wanted,k);
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function rosterMonth'),src.indexOf('function openMonthStaff')),c);
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

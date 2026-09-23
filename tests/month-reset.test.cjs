const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../nurse-scheduler.js'),'utf8');
const remove=main.slice(main.indexOf('function removeRelated('),main.indexOf('\nconst pad='));
const reset=main.slice(main.indexOf('function resetCurrentMonth('),main.indexOf('\nfunction openStaffModal('));
function setup({saveOK=true,confirmed=true,snapshotMonth='2026-09'}={}){
 const wanted=Object.fromEntries(['D','E','N','M','O','O'].map((s,i)=>[`2026-09-0${i+1}:1`,s]));
 wanted['2026-10-01:1']='O';
 const assignments={};for(const [k,s]of Object.entries(wanted)){assignments[k]=1;assignments[k+'_type']=s;}
 assignments['2026-09-07:1']=1;assignments['2026-09-07:1_type']='N';
 assignments['2026-10-02:1']=1;assignments['2026-10-02:1_type']='E';
 const s={staff:[{id:1,name:'직원'}],rules:[{type:'example'}],wanted,assignments,leave:{'2026-09-06:1':'vacation','2026-09-07:1':'vacation','2026-10-01:1':'vacation'},generationSnapshot:{month:snapshotMonth,shifts:{[snapshotMonth+'-07:1']:'N'}}};
 const buttons={clearAuto:{},clear:{}},ctx={state:s,cursor:new Date(2026,8,1),clear:buttons.clear,document:{getElementById:id=>buttons[id]},pad:n=>String(n).padStart(2,'0'),confirm:()=>confirmed,render:()=>{},save:()=>saveOK};
 vm.createContext(ctx);vm.runInContext('function putAssignment(k,s){state.assignments[k]=1;state.assignments[k+"_type"]=s;}\n'+remove+'\n'+reset,ctx);
 return {ctx,buttons,before:JSON.stringify(s)};
}
test('wanted reset preserves all manual shifts, OFF, vacation and other months',()=>{
 const {ctx,buttons}=setup();buttons.clearAuto.onclick();
 for(const [k,shift]of Object.entries(ctx.state.wanted))assert.equal(ctx.state.assignments[k+'_type'],shift);
 assert.equal(Object.keys(ctx.state.wanted).length,7);
 assert.equal(ctx.state.assignments['2026-09-07:1'],undefined);
 assert.equal(ctx.state.leave['2026-09-06:1'],'vacation');assert.equal(ctx.state.leave['2026-09-07:1'],undefined);
 assert.equal(ctx.state.assignments['2026-10-02:1_type'],'E');assert.equal(ctx.state.leave['2026-10-01:1'],'vacation');
 assert.equal(ctx.state.generationSnapshot,null);assert.equal(ctx.state.staff[0].id,1);assert.equal(ctx.state.rules[0].type,'example');
});
test('wanted map restores missing manual assignment and keeps another month snapshot',()=>{
 const {ctx,buttons}=setup({snapshotMonth:'2026-10'});delete ctx.state.assignments['2026-09-05:1'];delete ctx.state.assignments['2026-09-05:1_type'];buttons.clearAuto.onclick();
 assert.equal(ctx.state.assignments['2026-09-05:1_type'],'O');assert.equal(ctx.state.generationSnapshot.month,'2026-10');
 assert.equal(ctx.state.generationSnapshot.shifts['2026-10-07:1'],'N');
});
test('full reset removes only current month wanted, leave, assignments and snapshot',()=>{
 const {ctx,buttons}=setup();buttons.clear.onclick();
 for(const map of [ctx.state.wanted,ctx.state.leave,ctx.state.assignments])assert.equal(Object.keys(map).some(k=>k.startsWith('2026-09-')),false);
 assert.equal(ctx.state.wanted['2026-10-01:1'],'O');assert.equal(ctx.state.generationSnapshot,null);
});
test('cancellation and storage failure preserve prior data',()=>{
 for(const config of [{confirmed:false},{saveOK:false}])for(const button of ['clearAuto','clear']){
  const {ctx,buttons,before}=setup(config);buttons[button].onclick();assert.equal(JSON.stringify(ctx.state),before);
 }
});

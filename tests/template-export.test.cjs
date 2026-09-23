const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const JSZip=require('../vendor/jszip.min.js');
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const env={DOMParser,XMLSerializer,JSZip};env.globalThis=env;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../nurse-scheduler-excel.js'),'utf8'),env);
const templatePath=process.env.TEMPLATE_FILE||path.join(__dirname,'../nurse_scheduler_template.xlsx');
const template=fs.readFileSync(templatePath);
const parse=s=>new DOMParser().parseFromString(s,'application/xml');
const nodes=(doc,name)=>Array.from(doc.getElementsByTagNameNS(NS,name));
const cell=(doc,ref)=>nodes(doc,'c').find(c=>c.getAttribute('r')===ref);
const value=(doc,ref)=>{const c=cell(doc,ref);return c?(nodes(c,'t').map(n=>n.textContent).join('')||nodes(c,'v')[0]?.textContent||''):'';};
const formula=(doc,ref)=>nodes(cell(doc,ref),'f')[0]?.textContent;
const staff=(category,name,year=2026,month=9)=>({category,name,shifts:Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>['D','E','N','M','O','휴가'][i%6])});
async function load(options,bytes=template){const result=await env.NurseSchedulerExcel.build(bytes,options);const zip=await JSZip.loadAsync(result.bytes);return {result,zip,doc:parse(await zip.file('xl/worksheets/sheet1.xml').async('string')),styles:parse(await zip.file('xl/styles.xml').async('string'))};}
test('template export: grouping, spare rows, totals, formula injection and preserved heading styles',async()=>{
 const input=[staff('AN','보조'),staff('RN','=1+1'),staff('NK','야간'),staff('HN','수간호'),staff('MD','미드'),staff('린넨','제외')];
 const snapshot=JSON.stringify(input),before=Buffer.from(template);
 const {result,zip,doc,styles}=await load({year:2026,month:9,staff:input,holidays:{'2026-09-24':'추석'},issues:[['2026-09-01',['확인 <필요>']]]});
 assert.equal(JSON.stringify(input),snapshot);assert.deepEqual(template,before);
 assert.equal(result.layout.nurseSlots,5);assert.equal(result.layout.assistantSlots,2);
 assert.deepEqual([9,10,11,12,13,14,15].map(r=>value(doc,'B'+r)),['HN','RN','MD','NK','','AN','']);
 assert.equal(value(doc,'C10'),'=1+1');assert.equal(nodes(cell(doc,'C10'),'f').length,0);
 assert.equal(value(doc,'AH7'),'');assert.equal(value(doc,'AG7'),'30');assert.equal(value(doc,'H9'),'OFF');assert.equal(value(doc,'I9'),'휴가');
 assert.equal(value(doc,'AI9'),'5');assert.equal(value(doc,'AJ9'),'0');assert.equal(value(doc,'AK9'),'5');
 assert.equal(formula(doc,'D17'),'COUNTIF(D9:D13,"D")');assert.equal(value(doc,'D17'),'4');assert.equal(value(doc,'G20'),'5');
 assert.match(formula(doc,'AI13'),/^IF\(C13="","",COUNTIF/);
 const xfs=nodes(styles,'cellXfs')[0].childNodes; // filter element nodes below
 const xf=Array.from(xfs).filter(n=>n.nodeType===1)[Number(cell(doc,'D13').getAttribute('s'))];
 const border=nodes(styles,'borders')[0].childNodes;const b=Array.from(border).filter(n=>n.nodeType===1)[Number(xf.getAttribute('borderId'))];
 assert.equal(nodes(b,'bottom')[0].getAttribute('style'),'double');
 assert.equal(nodes(doc,'cfRule').length,0);
 const srcZip=await JSZip.loadAsync(template),src=parse(await srcZip.file('xl/worksheets/sheet1.xml').async('string'));
 const ser=new XMLSerializer();
 const widths=d=>nodes(d,'col').filter(n=>Number(n.getAttribute('min'))<=44).map(n=>[Number(n.getAttribute('min')),Math.min(44,Number(n.getAttribute('max'))),n.getAttribute('width'),n.getAttribute('hidden')]);
 assert.deepEqual(widths(doc),widths(src));
 for(let c of ['B2','AE4','AG4','B5'])assert.equal(cell(doc,c).getAttribute('s'),cell(src,c).getAttribute('s'));
 assert.deepEqual(nodes(doc,'mergeCell').map(n=>n.getAttribute('ref')),nodes(src,'mergeCell').map(n=>n.getAttribute('ref')));
 assert.equal(ser.serializeToString(nodes(doc,'pageMargins')[0]),ser.serializeToString(nodes(src,'pageMargins')[0]));
 assert.equal(zip.file('xl/sharedStrings.xml'),null);assert.ok(zip.file('xl/worksheets/sheet2.xml'));
 const allText=(await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')).map(p=>zip.file(p).async('string')))).join('');
 assert.ok(!allText.includes('린넨'));assert.ok(!allText.includes('심경아'));
 if(process.env.EXPORT_TEST_DIR){fs.mkdirSync(process.env.EXPORT_TEST_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.EXPORT_TEST_DIR,'sample.xlsx'),result.bytes);}
});
test('cleared role text and deleted linen row still work',async()=>{
 const z=await JSZip.loadAsync(template);let text=await z.file('xl/worksheets/sheet1.xml').async('string');
 text=text.replace(/<c\b[^>]*\br="B(?:9|1\d|2[0-5])"[^>]*?(?:\/>|>.*?<\/c>)/g,m=>m.replace(/<v>.*?<\/v>/,'').replace(/ t="s"/,''));
 const edited=parse(text);
 const data=nodes(edited,'sheetData')[0];
 for(const row of Array.from(data.childNodes).filter(n=>n.nodeType===1)){
   const r=Number(row.getAttribute('r'));
   if(r===25){data.removeChild(row);continue;}
   if(r>25){row.setAttribute('r',r-1);for(const c of nodes(row,'c'))c.setAttribute('r',c.getAttribute('r').replace(/\d+$/,String(r-1)));}
 }
 text=new XMLSerializer().serializeToString(edited);
 z.file('xl/worksheets/sheet1.xml',text);
 const {doc}=await load({year:2026,month:9,staff:[staff('RN','간호'),staff('AN','보조')]},await z.generateAsync({type:'nodebuffer'}));
 assert.equal(value(doc,'B9'),'RN');assert.equal(value(doc,'B11'),'AN');
});
for(const [year,month,days]of [[2026,2,28],[2028,2,29],[2026,4,30],[2026,10,31]])test(`calendar ${year}-${month}`,async()=>{
 const {doc}=await load({year,month,staff:[staff('RN','한명',year,month)]});
 const cols=['AE','AF','AG','AH'];
 assert.deepEqual(cols.map(c=>value(doc,c+'7')),Array.from({length:4},(_,i)=>i+28<=days?String(i+28):''));
 for(let i=days;i<31;i++){const c=String.fromCharCode(65+Math.floor((i+3)/26)-1)+String.fromCharCode(65+(i+3)%26);assert.equal(value(doc,c+'9'),'');}
 assert.equal(value(doc,'B5'),`${year}년 ${month}월`);
});
test('only AN has no nurse counts; large roster expands and allows multiple pages',async()=>{
 const {doc,result}=await load({year:2026,month:9,staff:[staff('AN','보조')]});assert.equal(result.layout.nurseSlots,0);assert.equal(value(doc,'B9'),'AN');assert.equal(formula(doc,'D'+result.layout.totals),'0');
 const input=[...Array.from({length:22},(_,i)=>staff('RN','간호'+i)),...Array.from({length:5},(_,i)=>staff('AN','보조'+i))];
 const big=await load({year:2026,month:9,staff:input});assert.equal(big.result.layout.end,35);assert.equal(big.result.layout.totals,37);assert.equal(nodes(big.doc,'pageSetup')[0].getAttribute('fitToHeight'),'0');assert.equal(value(big.doc,'B31'),'AN');
 if(process.env.EXPORT_TEST_DIR)fs.writeFileSync(path.join(process.env.EXPORT_TEST_DIR,'large.xlsx'),big.result.bytes);
});
test('invalid input fails instead of silently exporting a different layout',async()=>{
 await assert.rejects(()=>load({year:2026,month:9,staff:[]}));
 await assert.rejects(()=>load({year:2026,month:9,staff:[staff('UNKNOWN','모름')]}));
 await assert.rejects(()=>load({year:2026,month:9,staff:[staff('RN','한명')]},Buffer.from('not zip')));
});
test('export button captures month, loads relative template, restores button and reports missing files',async()=>{
 const main=fs.readFileSync(path.join(__dirname,'../nurse-scheduler.js'),'utf8');
 const code=main.slice(main.indexOf('let excelModulesPromise;'),main.indexOf('\nfunction esc('));
 const exported=[],alerts=[],urls=[],requests=[];
 const button={disabled:false,textContent:'엑셀 출력'};
 let fail=false;
 const url=class extends URL{};url.createObjectURL=()=> 'blob:test';url.revokeObjectURL=()=>{};
 const fake={
  URL:url,Blob,Uint8Array,console:{error(){}},setTimeout(){},location:{protocol:'http:'},
  document:{baseURI:'http://localhost:8080/nurse-scheduler/index.html',head:{appendChild(){}},body:{appendChild(){}},createElement(){return {click(){urls.push(this.download)},remove(){}}}},
  exportExcel:button,JSZip,NurseSchedulerExcel:{async build(bytes,options){exported.push(options);return {bytes:new Uint8Array([80,75]),mimeType:'test',filename:'test.xlsx'}}},
  cursor:new Date(2026,8,1),getMonthDates:()=>[new Date(2026,8,1)],holidaysFor:()=>({'2026-09-24':'추석'}),analyzeMonth:()=>({}),
  state:{wanted:{test:'N'},staff:[{id:1,name:'테스트',category:'RN'}],assignments:{'test':1,'test_type':'N'}},keyFor:()=> 'test',displayShift:(k,sh)=>sh,
  alert:m=>alerts.push(m),async fetch(path){requests.push(String(path));fake.cursor=new Date(2026,9,1);return {ok:!fail,status:404,arrayBuffer:async()=>new Uint8Array([80,75]).buffer}}
 };fake.globalThis=fake;vm.runInNewContext(code,fake);await button.onclick();
 assert.equal(exported[0].staff[0].wanted[0],true);assert.equal(exported[0].month,9);assert.equal(exported[0].staff[0].shifts[0],'N');assert.equal(requests[0],'http://localhost:8080/nurse-scheduler/nurse_scheduler_template.xlsx');assert.equal(urls.length,1);assert.equal(button.disabled,false);
 fail=true;await button.onclick();assert.match(alerts[0],/nurse_scheduler_template.xlsx/);assert.equal(button.textContent,'엑셀 출력');assert.equal(button.disabled,false);
 fake.location.protocol='file:';await button.onclick();assert.match(alerts[1],/localhost/);
});
test('background colors follow wanted provenance, holiday and explicit OFF priority',async()=>{
 const p=staff('RN','색상검증');
 p.shifts.fill('O');p.wanted=Array(30).fill(false);
 // Sept 2026: 1-4 weekdays, 5 Saturday, 6 Sunday, 24 holiday.
 p.shifts[0]='D';p.shifts[1]='D';p.wanted[1]=true;
 p.wanted[2]=true;p.shifts[3]='휴가';p.wanted[3]=true;
 p.wanted[5]=true;p.shifts[23]='E';p.wanted[23]=true;
 p.shifts[24]='휴가';p.wanted[24]=true;p.wanted[25]=true;
 const {doc,styles}=await load({year:2026,month:9,staff:[p],holidays:{'2026-09-24':'추석','2026-09-25':'추석','2026-09-26':'추석','2026-09-28':'시험휴일'}});
 const elements=n=>Array.from(n.childNodes).filter(n=>n.nodeType===1);
 const fills=elements(nodes(styles,'fills')[0]),xfs=elements(nodes(styles,'cellXfs')[0]);
 const fill=ref=>fills[Number(xfs[Number(cell(doc,ref).getAttribute('s'))].getAttribute('fillId'))];
 const rgb=ref=>nodes(fill(ref),'fgColor')[0]?.getAttribute('rgb');
 for(const ref of ['D9','F9','I9','AC9','AH9'])assert.equal(rgb(ref),'FFFFFFFF',ref+' must be white');
 for(const ref of ['E9','G9','AA9','AB9'])assert.equal(rgb(ref),'FFBDD7EE',ref+' must be blue');
 const serialize=n=>new XMLSerializer().serializeToString(n);
 for(const ref of ['H9','AE9','H10'])assert.equal(serialize(fill(ref)),serialize(fill('H7')),ref+' must match template holiday yellow');
 assert.equal(nodes(doc,'conditionalFormatting').length,0);
 assert.equal(value(doc,'F9'),'OFF');assert.equal(value(doc,'G9'),'휴가');
});

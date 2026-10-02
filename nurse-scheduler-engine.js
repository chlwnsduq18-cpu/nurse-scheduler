// Shared by the UI validator and the background generator. No DOM access.
// Date-only arithmetic uses UTC, independent of DST. Week = Monday through Sunday.
const DAY_MS=86400000;
const dateStringCache=new Map();
const isoDay=n=>{if(!dateStringCache.has(n))dateStringCache.set(n,new Date(n*DAY_MS).toISOString().slice(0,10));return dateStringCache.get(n)};
const dayNumber=s=>Math.floor(Date.parse(s+'T00:00:00Z')/DAY_MS);
const work=sh=>!!sh && sh!=='O';
const defaultShiftTimes={D:{start:'07:00',end:'15:00',breakMinutes:30},E:{start:'15:00',end:'23:00',breakMinutes:30},N:{start:'23:00',end:'07:00',breakMinutes:30},M:{start:'09:00',end:'18:00',breakMinutes:60}};
function schedulerConfig(){
 const cfg={coverageRules:[],maxWeekly:5,maxConsecutive:5,nightRest:2,preferred:'ALL',minRestHours:11,nkMonthly:15,rnNightMin:4,rnNightMax:5,nightMinBlock:2,nightMaxBlock:3,nkRestMatch:1,ruleErrors:validateRules(state.rules||[])};
 const seen=new Set();
 for(const r of state.rules||[]){
   const tag=ruleIdentity(r);if(seen.has(tag))continue;seen.add(tag);
   const def=RULE_TYPES[r.type],v=Number(r.value);if(!def)continue;
   if(r.type==='preferred'){if(['ALL','D','E','N','M'].includes(r.shift))cfg.preferred=r.shift;continue}
   if(!Number.isInteger(v)||v<def.min||v>def.max)continue;
   if(def.coverage){cfg.coverageRules.push(r);continue}
   if(r.type==='weeklyOff')cfg.maxWeekly=7-v;
   else cfg[r.type]=v;
 }
 return cfg;
}
function coverageLimits(n,sh,group,cfg){
 let min=0,max=Infinity;const kind=dayKind(n)==='weekday'?'weekday':'rest';
 for(const r of cfg.coverageRules||[]){
   if(r.shift!==sh||!['ALL',group].includes(r.group||'ALL')||!['ALL',kind].includes(r.day||'ALL'))continue;
   if(r.type==='minimum')min=Math.max(min,Number(r.value));else max=Math.min(max,Number(r.value));
 }
 return {min,max};
}
function preferenceScore(sh,cfg){return cfg.preferred===sh?-8:0}

const timingCache=new Map();
function shiftTiming(sh){
  const t=(state.shiftTimes||defaultShiftTimes)[sh];
  if(!t)return null;
  const cacheKey=t.start+"/"+t.end+"/"+t.breakMinutes;
  if(timingCache.has(cacheKey))return timingCache.get(cacheKey);
  const minutes=s=>Number(s.split(':')[0])*60+Number(s.split(':')[1]);
  const start=minutes(t.start),end0=minutes(t.end),end=end0<=start?end0+1440:end0;
  const pause=Number(t.breakMinutes),hours=(end-start-pause)/60;
  const required=hours>=8?60:hours>=4?30:0;
  const result={start,end,hours,valid:Number.isFinite(hours)&&hours>0&&hours<=8&&pause>=required&&pause<end-start};
  timingCache.set(cacheKey,result);return result;
}
function currentPlan(){
  const p={};
  Object.keys(state.assignments).filter(k=>!k.endsWith('_type')).forEach(k=>{if(state.assignments[k])p[k]=state.assignments[k+'_type']||'D'});
  Object.assign(p,state.manual||{},state.wanted);
  for(const k of Object.keys(p))if(!activeStaff(k.slice(0,7)).some(st=>st.id===Number(k.split(':')[1])))delete p[k];
  return p;
}
function weekStart(n){return n-((new Date(n*DAY_MS).getUTCDay()+6)%7)}
// 2026 calendar: KASI 2026 almanac + 2026 Labor/Constitution Day amendments.
const HOLIDAYS_2026={
 '2026-01-01':'신정','2026-02-16':'설 연휴','2026-02-17':'설날','2026-02-18':'설 연휴',
 '2026-03-01':'삼일절','2026-03-02':'삼일절 대체공휴일','2026-05-01':'노동절','2026-05-05':'어린이날',
 '2026-05-24':'부처님오신날','2026-05-25':'부처님오신날 대체공휴일','2026-06-03':'지방선거일',
 '2026-06-06':'현충일','2026-07-17':'제헌절','2026-08-15':'광복절','2026-08-17':'광복절 대체공휴일',
 '2026-09-24':'추석 연휴','2026-09-25':'추석','2026-09-26':'추석 연휴','2026-10-03':'개천절',
 '2026-10-05':'개천절 대체공휴일','2026-10-09':'한글날','2026-12-25':'성탄절'
};
const ROSTER_DEFAULTS={weekend:{HN:false,RN:true,MD:false,NK:true,AN:true},coverage:{
 weekday:{D:2,E:2,N:2,AD:1,AE:1,AN:0},saturday:{D:1,E:1,N:1,AD:1,AE:1,AN:1},holiday:{D:1,E:1,N:1,AD:1,AE:1,AN:1}}};
function rosterSettings(){return state.rosterSettings||ROSTER_DEFAULTS}
function holidaysFor(year){return state.holidayYears?.[year]?.dates||(year===2026?HOLIDAYS_2026:{})}
function holidayName(n){return holidaysFor(new Date(n*DAY_MS).getUTCFullYear())[isoDay(n)]||''}
function dayKind(n){return holidayName(n)||new Date(n*DAY_MS).getUTCDay()===0?'holiday':new Date(n*DAY_MS).getUTCDay()===6?'saturday':'weekday'}
function isWeekend(n){return [0,6].includes(new Date(n*DAY_MS).getUTCDay())}
function isVacation(k){return state.leave?.[k]==='vacation'&&fixedShift(k)==='O'}
function displayShift(k,sh){return isVacation(k)?'휴가':sh}
function dayAllowed(st,n){
 const role=st.category||'RN';
 if(role==='MD'&&isWeekend(n))return false;
 if(role==='HN'&&isWeekend(n))return false;
 if((role==='HN'||role==='MD')&&holidayName(n))return false;
 return dayKind(n)==='weekday'||rosterSettings().weekend[role]!==false;
}
function midDemand(n,cfg=schedulerConfig()){
 const weekend=isWeekend(n),group=weekend?'AN':'nurse',limits=coverageLimits(n,'M',group,cfg);
 return {key:'M',shift:'M',roles:weekend?['AN']:['MD','RN'],min:holidayName(n)&&!weekend?limits.min:Math.max(1,limits.min),max:limits.max,label:weekend?'M(주말 AN)':'M(평일 MD·RN 대체)'};
}
function allowedShifts(role){return role==='HN'?['D','O']:role==='MD'?['M','O']:role==='NK'?['N','O']:role==='RN'?['D','E','N','M','O']:['D','E','N','M','O']}
function countShift(plan,n,sh,roles=null){return activeStaff(isoDay(n).slice(0,7)).filter(st=>(!roles||roles.includes(st.category||'RN'))&&plan[isoDay(n)+':'+st.id]===sh).length}
function dayDemands(n,cfg=schedulerConfig()){
 const c=rosterSettings().coverage[dayKind(n)],otherMidGroup=isWeekend(n)?'nurse':'AN',otherMid=coverageLimits(n,'M',otherMidGroup,cfg),demand=(key,shift,roles,value,label,fixed=false)=>{
   const limits=coverageLimits(n,shift,roles[0]==='AN'?'AN':'nurse',cfg),min=Math.max(value,limits.min);
   return {key,shift,roles,min,max:Math.min(limits.max,fixed?min:Infinity),label};
 };
 return [
   demand('D','D',['RN'],c.D,'D(RN)',true),demand('E','E',['RN'],c.E,'E(RN)',true),
   demand('NR','N',['RN','NK'],c.N,'N(RN/NK)'),
   demand('AD','D',['AN'],c.AD,'D(AN)'),demand('AE','E',['AN'],c.AE,'E(AN)'),demand('AN','N',['AN'],c.AN,'N(AN)'),midDemand(n,cfg),
   ...(otherMid.min>0?[{key:'XM',shift:'M',roles:otherMidGroup==='AN'?['AN']:['MD','RN'],min:otherMid.min,max:otherMid.max,label:`M(${otherMidGroup==='AN'?'AN':'간호사'}·기본 담당일과 충돌)`}]:[])
 ];
}
function calendarOffCount(){return getMonthDates().filter(d=>dayKind(dayNumber(keyFor(d,0).split(':')[0]))!=='weekday').length}
function monthlyOffLimit(){
 const value=state.monthOffLimits?.[rosterMonth()];
 return state.monthOffModes?.[rosterMonth()]==='manual'&&Number.isInteger(value)?value:calendarOffCount();
}

function monthlyWorkTarget(st){
 const dates=getMonthDates();
 if(st.category==='NK')return schedulerConfig().nkMonthly;
 const vacation=dates.filter(d=>isVacation(keyFor(d,st.id))).length;
 return Math.max(0,dates.length-monthlyOffLimit()-vacation);
}
function monthlyWorked(plan,id){return getMonthDates().filter(d=>work(plan[keyFor(d,id)])).length}
// Upper bound before committing night blocks: include forced OFF and weekly caps.
function possibleMonthWork(plan,st,cfg){
 const dates=getMonthDates().map(d=>dayNumber(keyFor(d,0).split(':')[0])),set=new Set(dates),blocked=new Set();
 for(const n of dates)if(!dayAllowed(st,n)||fixedShift(isoDay(n)+':'+st.id)==='O')blocked.add(n);
 for(let n=dates[0]-3;n<=dates.at(-1)+1;n++){
   if(plan[isoDay(n)+':'+st.id]!=='N')continue;
   if(plan[isoDay(n-1)+':'+st.id]!=='N')blocked.add(n-1);
   if(plan[isoDay(n+1)+':'+st.id]!=='N')for(let i=1;i<=Math.max(cfg.nightRest,['RN','NK','AN'].includes(st.category)?2:1);i++)blocked.add(n+i);
 }
 let total=0;
 for(const monday of new Set(dates.map(weekStart))){
   let available=0,outside=0;
   for(let n=monday;n<monday+7;n++){
     if(set.has(n)){if(!blocked.has(n))available++;}
     else if(work(plan[isoDay(n)+':'+st.id]))outside++;
   }
   total+=Math.min(available,Math.max(0,cfg.maxWeekly-outside));
 }
 return total;
}
function weeklyWorkTarget(n,id,cfg){
 const st=state.staff.find(s=>s.id===id);let available=0;
 for(let d=weekStart(n);d<weekStart(n)+7;d++){
   const k=isoDay(d)+':'+id;
   if(dayAllowed(st,d)&&fixedShift(k)!=='O')available++;
 }
 // Entered OFF is part of weekly rest, not an extra deduction from five days.
 return Math.min(available,cfg.maxWeekly);
}
function offNeighbourPriority(n,id){
 let fixedOff=0;for(let d=weekStart(n);d<weekStart(n)+7;d++)if(fixedShift(isoDay(d)+':'+id)==='O')fixedOff++;
 if(fixedOff<2)return 0;
 return [-1,1].filter(delta=>fixedShift(isoDay(n+delta)+':'+id)==='O').length;
}
function unwantedAdjacentOff(plan,dates){
 let total=0;for(const st of activeStaff().filter(s=>s.category!=='NK'))for(const n of dates){
  const k=isoDay(n)+':'+st.id;if(!hasFixed(k)&&!work(plan[k]))total+=offNeighbourPriority(n,st.id);
 }return total;
}
function nkRestPreference(plan,dates){
 let penalty=0;const start=dates[0],end=dates.at(-1);
 for(const st of activeStaff().filter(s=>s.category==='NK'))for(const n of dates){
  if(plan[isoDay(n)+':'+st.id]!=='N'||plan[isoDay(n+1)+':'+st.id]==='N')continue;
  const run=nightRun(plan,n,st.id);let next=n+1;
  while(next<=end&&!work(plan[isoDay(next)+':'+st.id]))next++;
  if(next<=end)penalty+=Math.abs(next-n-1-run.length);
 }
 return penalty;
}
function weeklyWorked(plan,n,id){let count=0;for(let d=weekStart(n);d<weekStart(n)+7;d++)if(work(plan[isoDay(d)+':'+id]))count++;return count}
function nightRun(plan,n,id){let a=n,b=n;while(plan[isoDay(a-1)+':'+id]==='N'&&n-a<31)a--;while(plan[isoDay(b+1)+':'+id]==='N'&&b-n<31)b++;return {a,b,length:b-a+1}}
function staffProblems(plan,n,st,sh,cfg){
 if(!work(sh))return [];
 const id=st.id,role=st.category||'RN',errors=[],get=d=>d===n?sh:plan[isoDay(d)+':'+id]||'O';
 if(!allowedShifts(role).includes(sh))errors.push('분류별 허용 근무 위반');
 if(!dayAllowed(st,n))errors.push('주말·공휴일 OFF 조건');
 if(sh==='M'){
   const demand=midDemand(n,cfg);
   if(!demand.roles.includes(role)||demand.min===0)errors.push('M 담당 직군·요일 조건 위반');
   else if(role==='RN'&&countShift(plan,n,'M',['MD'])>=demand.min)errors.push('MD 배정으로 이미 채워진 M 대체');
 }
 if(role==='AN'&&sh==='N'&&dayDemands(n,cfg).find(d=>d.key==='AN').min===0)errors.push('AN N 대상일 아님');
 if(!shiftTiming(sh)?.valid)errors.push('실근로 8시간·휴게시간 설정 확인');
 let hours=0;for(let d=weekStart(n);d<weekStart(n)+7;d++)if(work(get(d)))hours+=shiftTiming(get(d))?.hours||0;
 const weekly=Array.from({length:7},(_,i)=>get(weekStart(n)+i)).filter(work).length;
 if(weekly>cfg.maxWeekly)errors.push(`주 ${cfg.maxWeekly}일 상한 초과`);
 else if(weekly>weeklyWorkTarget(n,id,cfg))errors.push('입력 OFF·근무 가능일 조건 위반');
 if(hours>40+1e-8)errors.push('주 40시간 상한 초과');
 let run=1;for(let d=n-1;d>=n-31&&work(get(d));d--)run++;for(let d=n+1;d<=n+31&&work(get(d));d++)run++;
 if(run>cfg.maxConsecutive)errors.push(`연속 ${cfg.maxConsecutive}일 상한 초과`);
 if(sh==='N'&&['RN','NK'].includes(role)){
   let nights=1;for(let d=n-1;d>=n-4&&get(d)==='N';d--)nights++;for(let d=n+1;d<=n+4&&get(d)==='N';d++)nights++;
   if(nights>cfg.nightMaxBlock)errors.push(`N 연속 ${cfg.nightMaxBlock}일 상한 초과`);
 }
 for(const direction of [-1,1])for(let delta=1;delta<=32;delta++){
   const other=get(n+direction*delta);if(!work(other))continue;
   const left=direction<0?other:sh,right=direction<0?sh:other,leftDay=direction<0?n-delta:n;
   const lt=shiftTiming(left),rt=shiftTiming(right);
   if(lt&&rt&&delta*1440+rt.start-lt.end<cfg.minRestHours*60)errors.push(`근무 사이 ${cfg.minRestHours}시간 휴식 부족`);
   const protectedNight=role==='RN'||role==='NK'||(role==='AN'&&(isWeekend(leftDay)||holidayName(leftDay)));
   if(delta===1&&((left==='N'&&right!=='N')||(left!=='N'&&right==='N')))errors.push('N 묶음 앞뒤 다른 근무 사이에 OFF 필요');
   if(left==='N'&&!(right==='N'&&delta===1)&&delta-1<Math.max(cfg.nightRest,protectedNight?2:0))errors.push(`N 종료 후 최소 ${Math.max(cfg.nightRest,protectedNight?2:0)}일 OFF 부족`);
   break;
 }
 return [...new Set(errors)];
}
function canPlace(plan,n,st,sh,cfg){
 const k=isoDay(n)+':'+st.id,role=st.category||'RN';
 if(hasFixed(k)||work(plan[k])||!dayAllowed(st,n))return false;
 if(weeklyWorked(plan,n,st.id)>=weeklyWorkTarget(n,st.id,cfg))return false;
 if(role!=='NK'&&monthlyWorked(plan,st.id)>=monthlyWorkTarget(st))return false;
 const group=role==='AN'?'AN':'nurse',pool=role==='AN'?['AN']:['HN','RN','NK','MD'];
 if(countShift(plan,n,sh,pool)>=coverageLimits(n,sh,group,cfg).max)return false;
 const demand=dayDemands(n,cfg).find(d=>d.shift===sh&&d.roles.includes(role));
 if(demand&&countShift(plan,n,sh,demand.roles)>=demand.max)return false;
 if(role==='NK'&&sh==='N'&&monthlyNights(plan,st.id)>=(cfg.nkTargets?.[st.id]??cfg.nkMonthly))return false;
 if(role==='RN'&&sh==='N'&&monthlyNights(plan,st.id)>=cfg.rnNightMax)return false;
 if(sh==='N'&&(!demand||(role==='AN'&&(demand.min===0||countShift(plan,n,'N',demand.roles)>=demand.min))))return false;
 if(sh==='M'){
   const demand=midDemand(n,cfg);
   if(!demand.roles.includes(role)||demand.min===0)return false;
   if(role!=='MD'&&countShift(plan,n,'M',demand.roles)>=demand.min)return false;
 }
 return staffProblems(plan,n,st,sh,cfg).length===0;
}
function workTargetGaps(plan,cfg=schedulerConfig()){
 const dates=getMonthDates().map(d=>dayNumber(keyFor(d,0).split(':')[0])),gaps=[];
 for(const st of activeStaff()){
   if(st.category==='NK')continue;
   const target=monthlyWorkTarget(st),actual=monthlyWorked(plan,st.id);
   if(actual<target)gaps.push({name:st.name,id:st.id,monday:weekStart(dates[0]),target,actual,missing:target-actual,freeDates:dates.filter(d=>dayAllowed(st,d)&&!hasFixed(isoDay(d)+':'+st.id)&&!work(plan[isoDay(d)+':'+st.id]))});
 }
 return gaps;
}
function monthlyNights(plan,id){return getMonthDates().filter(d=>plan[keyFor(d,id)]==='N').length}
function rnNightBalance(plan,cfg=schedulerConfig()){
 const rn=activeStaff().filter(s=>s.category==='RN'),counts=rn.map(s=>monthlyNights(plan,s.id));
 return {rn,counts,penalty:counts.reduce((sum,c)=>sum+Math.max(0,cfg.rnNightMin-c)+Math.max(0,c-cfg.rnNightMax),0),spread:counts.length?Math.max(...counts)-Math.min(...counts):0};
}
function nkBalance(plan,cfg=schedulerConfig()){
 const nk=activeStaff().filter(s=>s.category==='NK'),counts=nk.map(s=>monthlyNights(plan,s.id));
 return {nk,counts,penalty:counts.reduce((sum,c)=>sum+Math.abs(c-cfg.nkMonthly),0)};
}

function analyzeMonth(plan=currentPlan()){
 const cfg=schedulerConfig(),issues={},dates=getMonthDates(),start=dayNumber(keyFor(dates[0],0).split(':')[0]),end=start+dates.length-1;
 const add=(n,msg)=>{if(n<start||n>end)return;const dk=isoDay(n);(issues[dk]??=[]).push(msg)};
 for(let n=start;n<=end;n++){
   for(const d of dayDemands(n,cfg)){
     const count=countShift(plan,n,d.shift,d.roles);
     if(count<d.min)add(n,`${d.label} ${d.min-count}명 부족 · 원티드/규칙 확인`);
     if(count>d.max)add(n,`${d.label} ${count-d.max}명 초과 · 사용자 지정/최대 규칙 확인`);
   }
   for(const sh of ['D','E','N','M'])for(const pool of [['HN','RN','NK','MD'],['AN']])if(countShift(plan,n,sh,pool)>coverageLimits(n,sh,pool[0]==='AN'?'AN':'nurse',cfg).max)add(n,`${pool[0]==='AN'?'AN':'간호사'} ${sh} 최대 인원 초과`);
   for(const st of activeStaff()){
     const k=isoDay(n)+':'+st.id,sh=plan[k],role=st.category||'RN';
     for(const e of staffProblems(plan,n,st,sh,cfg))add(n,`${st.name}: ${e}${hasFixed(k)?' (사용자 지정 유지)':''}`);
     if(sh==='N'&&['RN','NK'].includes(role)){
       const block=nightRun(plan,n,st.id);
       if(block.length<cfg.nightMinBlock)add(n,`${st.name}: N은 ${cfg.nightMinBlock}~${cfg.nightMaxBlock}일 묶음 필요${n===start||n===end?' · 인접 월 확인':''}`);

     }
   }
 }
 for(const g of workTargetGaps(plan,cfg))for(const n of (g.freeDates.length?g.freeDates:[Math.max(start,g.monday)]))add(n,`${g.name}: 월 기준 OFF ${monthlyOffLimit()}일보다 ${g.missing}일 초과 · 근무 ${g.actual}/${g.target}일 · 입력 OFF·N 전후 휴식·주간 상한·직군 조건 확인`);
 const balance=nkBalance(plan);
 if(balance.nk.length!==2)add(start,`NK ${balance.nk.length}명 등록됨 · 기본 교대는 NK 2명 기준`);
 if(balance.penalty)add(start,`NK 월 N ${cfg.nkMonthly}회 미충족: ${balance.nk.map((s,i)=>s.name+' '+balance.counts[i]+'일').join(', ')}`);
 const rn=rnNightBalance(plan,cfg);
 for(let i=0;i<rn.rn.length;i++)if(rn.counts[i]<cfg.rnNightMin||rn.counts[i]>cfg.rnNightMax)add(start,`${rn.rn[i].name}: RN 월 N ${rn.counts[i]}회 · 기준 ${cfg.rnNightMin}~${cfg.rnNightMax}회 미충족`);
 if(rn.spread>1)add(start,'RN 월 N 배분 편차 '+rn.spread+'회 · 균등 배분 확인');
 for(const error of cfg.ruleErrors)add(start,'추가 규칙 오류: '+error);
 const requiredN=Array.from({length:dates.length},(_,i)=>start+i).reduce((sum,n)=>sum+dayDemands(n,cfg).find(d=>d.key==='NR').min,0);
 const capacityN=balance.nk.length*cfg.nkMonthly+rn.rn.length*cfg.rnNightMax;
 if(requiredN>capacityN)add(start,`월 RN/NK N 최소 ${requiredN}칸 > 개인별 월 최대 합계 ${capacityN}칸 · N 인원/횟수 설정 충돌`);
 for(const n of Array.from({length:dates.length},(_,i)=>start+i))for(const d of dayDemands(n,cfg))if(d.min>d.max)add(n,`${d.label} 최소 ${d.min}명과 최대 ${d.max}명 충돌`);
 for(const st of activeStaff().filter(s=>s.category!=='NK'))if(monthlyWorked(plan,st.id)>monthlyWorkTarget(st))add(start,`${st.name}: 월 근무 목표 ${monthlyWorkTarget(st)}일 초과 (사용자 지정 유지)`);
 return issues;
}
// Balanced alternating blocks are only a seed; final per-person quotas use nkMonthly.
function nkTemplate(days,attempt){
 const targets=attempt%2?[Math.ceil(days/2),Math.floor(days/2)]:[Math.floor(days/2),Math.ceil(days/2)];
 if(days%6===0&&attempt%6<2)return Array.from({length:days/3},(_,i)=>({who:(i+attempt)%2,len:3}));
 if(days%4===0&&attempt%6<2)return Array.from({length:days/2},(_,i)=>({who:(i+attempt)%2,len:2}));
 const memo=new Set();
 function visit(a,b,who,depth){
   if(a+b===days)return [];
   const key=a+','+b+','+who;if(memo.has(key))return null;
   for(const len of ((attempt+depth)%3===0?[3,2]:[2,3])){
     const next=[a,b];next[who]+=len;if(next[who]>targets[who])continue;
     const tail=visit(next[0],next[1],1-who,depth+1);if(tail)return [{who,len},...tail];
   }
   memo.add(key);return null;
 }
 return visit(0,0,attempt%2,0)||[];
}
function addNightBlock(plan,st,a,len,cfg,start,end){
 if(a<start||a+len-1>end)return null;
 const trial={...plan};let added=0;
 for(let n=a;n<a+len;n++){
   const k=isoDay(n)+':'+st.id;
   if(trial[k]==='N')continue;
   if(!canPlace(trial,n,st,'N',cfg))return null;
   trial[k]='N';added++;
 }
 if(!added)return null;
 if(st.category==='RN'&&cfg.rnNightMax-monthlyNights(trial,st.id)===1&&nightRun(trial,a,st.id).length>=cfg.nightMaxBlock&&cfg.nightMinBlock>1)return null;
 if(['RN','NK'].includes(st.category)&&nightRun(trial,a,st.id).length<cfg.nightMinBlock)return null;

 for(let n=a;n<a+len;n++)if(staffProblems(trial,n,st,'N',cfg).length)return null;
 return trial;
}
// Rebuild an NK independently to meet its explicit monthly target.
// Overlap remains possible unless an explicit maximum rule forbids it.
function repairNkTarget(plan,st,target,cfg,dates,variant=0){
 const start=dates[0],end=dates.at(-1),id=st.id,base={...plan};
 for(const n of dates){const k=isoDay(n)+':'+id;if(!hasFixed(k))delete base[k]}
 const prior=nightRun(base,start-1,id);
 let initialRun=base[isoDay(start-1)+':'+id]==='N'?prior.length:0,initialOff=0;
 if(!initialRun)for(let n=start-1;n>=start-4&&!work(base[isoDay(n)+':'+id]);n--)initialOff++;
 let states=[{plan:base,count:0,run:initialRun,off:initialOff,lastRun:0,cost:0}];
 for(let i=0;i<dates.length;i++){
   const n=dates[i],k=isoDay(n)+':'+id,fixed=fixedShift(k),candidates=new Map();
   for(const prev of states)for(const sh of fixed!==undefined?[fixed]:['N','O']){
     if(sh==='N'&&prev.count>=target&&fixed===undefined)continue;
     if(sh!=='N'&&prev.run>0&&prev.run<cfg.nightMinBlock&&!hasFixed(isoDay(n-1)+':'+id))continue;
     const trial={...prev.plan,[k]:sh};
     if(sh==='N'&&fixed===undefined&&!canPlace(prev.plan,n,st,'N',cfg))continue;
     const count=prev.count+(sh==='N'?1:0),run=sh==='N'?prev.run+1:0,off=sh==='N'?0:prev.off+1;
     let cost=prev.cost;
     if(sh==='N'){
       if(!prev.run&&prev.lastRun&&cfg.nkRestMatch)cost+=Math.abs(prev.off-prev.lastRun)*3;
       const demand=dayDemands(n,cfg).find(d=>d.shift==='N'&&d.roles.includes('NK'));
       if(demand&&countShift(plan,n,'N',demand.roles)>=demand.min)cost+=1;
       cost+=((i+variant)%5)*0.01;
     }
     const next={plan:trial,count,run,off,lastRun:prev.run||prev.lastRun,cost};
     const key=[count,run,Math.min(off,4),next.lastRun,weeklyWorked(trial,n,id)].join(':');
     if(!candidates.has(key)||candidates.get(key).cost>cost)candidates.set(key,next);
   }
   states=[...candidates.values()].sort((a,b)=>(Math.abs(a.count-target*(i+1)/dates.length)*4+a.cost)-(Math.abs(b.count-target*(i+1)/dates.length)*4+b.cost)).slice(0,160);
   if(!states.length)return plan;
 }
 const valid=states.filter(s=>dates.every(n=>{
   const k=isoDay(n)+':'+id;if(hasFixed(k)||s.plan[k]!=='N')return true;
   return !staffProblems(s.plan,n,st,'N',cfg).length&&nightRun(s.plan,n,id).length>=cfg.nightMinBlock;
 }));
 valid.sort((a,b)=>(Math.abs(target-a.count)*100000+a.cost)-(Math.abs(target-b.count)*100000+b.cost));
 const best=valid[0],current=dates.filter(n=>plan[isoDay(n)+':'+id]==='N').length;
 return best&&Math.abs(target-best.count)<Math.abs(target-current)?best.plan:plan;
}
// Repair surplus D/E/M placements without disturbing night blocks or daily coverage.
function repairDayTargets(plan,cfg,dates){
 for(let pass=0;pass<16;pass++){
   const gaps=workTargetGaps(plan,cfg),before=gaps.reduce((sum,g)=>sum+g.missing,0);if(!before)break;
   let changed=false;
   outer:for(const g of gaps){
     const st=state.staff.find(s=>s.id===g.id),shifts=allowedShifts(st.category).filter(sh=>work(sh)&&sh!=='N');
     for(const n of g.freeDates)for(const r of dates.filter(d=>Math.abs(n-d)<=7)){
       const rk=isoDay(r)+':'+st.id,old=plan[rk];if(!work(old)||old==='N'||hasFixed(rk))continue;
       const dm=dayDemands(r,cfg).find(d=>d.shift===old&&d.roles.includes(st.category));
       if(dm&&countShift(plan,r,old,dm.roles)<=dm.min)continue;
       const trial={...plan};delete trial[rk];
       for(const sh of shifts){
         if(!canPlace(trial,n,st,sh,cfg))continue;
         const candidate={...trial,[isoDay(n)+':'+st.id]:sh};
         refill:for(const d of dates.filter(d=>weekStart(d)===weekStart(r)))for(const replacement of shifts){
           if(canPlace(candidate,d,st,replacement,cfg)){candidate[isoDay(d)+':'+st.id]=replacement;break refill}
         }
         const after=workTargetGaps(candidate,cfg).reduce((sum,g)=>sum+g.missing,0);
         if(after<before){for(const k of Object.keys(plan))delete plan[k];Object.assign(plan,candidate);changed=true;break outer}
       }
     }
   }
   if(!changed)break;
 }
}
// Add whole blocks to meet personal RN night minima, even when daily minimum is filled.
// The same placement gate enforces maxima, rest, role and protected entries.
function fillRnNightTargets(plan,cfg,dates,baseline,random){
 const rn=activeStaff().filter(st=>st.category==='RN'),start=dates[0],end=dates.at(-1);
 for(let pass=0;pass<rn.length*4;pass++){
   const before=rnNightBalance(plan,cfg),options=[];
   for(const st of rn.filter(st=>monthlyNights(plan,st.id)<cfg.rnNightMin))for(const a of dates){
     for(let len=cfg.nightMinBlock;len<=cfg.nightMaxBlock;len++){
       const trial=addNightBlock(plan,st,a,len,cfg,start,end);if(!trial)continue;
       const after=rnNightBalance(trial,cfg);if(after.penalty>=before.penalty)continue;
       let gain=0,change=0;for(let n=a;n<a+len;n++){
         const dem=dayDemands(n,cfg).find(d=>d.key==='NR');gain+=Math.max(0,dem.min-countShift(plan,n,'N',dem.roles));
         if(baseline[isoDay(n)+':'+st.id]!==undefined&&baseline[isoDay(n)+':'+st.id]!=='N')change++;
       }
       options.push({trial,score:after.penalty*1000+after.spread*20-gain*30+change*2+(monthlyWorkTarget(st)-possibleMonthWork(trial,st,cfg))*2+random()*8});
     }
   }
   if(!options.length)break;options.sort((a,b)=>a.score-b.score);plan=options[0].trial;
 }
 return plan;
}
function solveMonth(){
 const cfg=schedulerConfig(),dates=getMonthDates().map(d=>dayNumber(keyFor(d,0).split(':')[0])),start=dates[0],end=dates.at(-1),month=isoDay(start).slice(0,7);
 const priorityDates=[...dates].sort((a,b)=>(dayKind(a)==='saturday'?0:dayKind(a)==='holiday'?1:2)-(dayKind(b)==='saturday'?0:dayKind(b)==='holiday'?1:2)||a-b);
 const current=currentPlan(),baseline={},fixed={};
 for(const [k,v]of Object.entries(current))if(!k.startsWith(month+'-'))fixed[k]=v;
 for(const [k,v]of Object.entries({...state.manual,...state.wanted}))if(activeStaff(k.slice(0,7)).some(st=>st.id===Number(k.split(':')[1])))fixed[k]=v;
 for(const n of dates)for(const st of activeStaff()){const k=isoDay(n)+':'+st.id;baseline[k]=state.generationSnapshot?.month===month?state.generationSnapshot.shifts[k]??current[k]:current[k]}
 const nk=activeStaff().filter(s=>s.category==='NK'),nkCache=new Map();let best=null;
 for(let attempt=0;attempt<36;attempt++){
   let plan={...fixed},seed=731+attempt*7919;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
   cfg.nkTargets=Object.fromEntries(nk.map(st=>[st.id,cfg.nkMonthly]));
   if(nk.length===2){let n=start;for(const block of nkTemplate(dates.length,attempt)){
     const trial=addNightBlock(plan,nk[block.who],n,block.len,cfg,start,end);if(trial)plan=trial;n+=block.len;
   }}
   const cacheKey=attempt%6;
   if(nkCache.has(cacheKey))Object.assign(plan,nkCache.get(cacheKey));
   else{
     for(const st of nk)plan=repairNkTarget(plan,st,cfg.nkTargets[st.id],cfg,dates,attempt);
     const shifts={};for(const st of nk)for(const n of dates){const k=isoDay(n)+':'+st.id;if(plan[k]!==undefined)shifts[k]=plan[k]}
     nkCache.set(cacheKey,shifts);
   }
   // Keep previous valid night blocks first on one third of attempts.
   if(attempt%3===0)for(const st of activeStaff())for(const n of dates){
     if(baseline[isoDay(n)+':'+st.id]!=='N'||baseline[isoDay(n-1)+':'+st.id]==='N')continue;
     let len=1;while(n+len<=end&&baseline[isoDay(n+len)+':'+st.id]==='N')len++;
     if(len>=cfg.nightMinBlock&&len<=cfg.nightMaxBlock||st.category==='AN'&&len===1){const trial=addNightBlock(plan,st,n,len,cfg,start,end);if(trial)plan=trial}
   }
   // Fill night demand with whole blocks; all two-day post-night rest checks include future wanteds.
   for(const n of dates)for(const demand of dayDemands(n,cfg).filter(d=>d.shift==='N')){
     while(countShift(plan,n,'N',demand.roles)<demand.min){
       const options=[];
       for(const st of activeStaff().filter(s=>demand.roles.includes(s.category||'RN'))){
         for(const len of (st.category==='AN'?[1,2,3]:Array.from({length:Math.max(0,cfg.nightMaxBlock-cfg.nightMinBlock+1)},(_,i)=>cfg.nightMinBlock+i)))for(let offset=0;offset<len;offset++){
           const a=n-offset,trial=addNightBlock(plan,st,a,len,cfg,start,end);if(!trial)continue;
           let gain=0,changes=0,total=0;
           for(let d=a;d<a+len;d++){
             const dem=dayDemands(d,cfg).find(x=>x.shift==='N'&&x.roles.includes(st.category));
             gain+=Math.max(0,dem.min-countShift(plan,d,'N',dem.roles));
             if(baseline[isoDay(d)+':'+st.id]!==undefined&&baseline[isoDay(d)+':'+st.id]!=='N')changes++;
           }
           for(const d of dates)if(plan[isoDay(d)+':'+st.id]==='N')total++;
           let stranded=0;
           if(st.category!=='AN')for(let d=start;d<=end;d++){
             const need=x=>{if(x<start||x>end)return false;const dm=dayDemands(x,cfg).find(q=>q.shift==='N'&&q.roles.includes(st.category));return dm&&countShift(trial,x,'N',dm.roles)<dm.min};
             if(need(d)&&!need(d-1)&&!need(d+1))stranded++;
           }
           const restConflict=st.category==='NK'?0:[a+len,a+len+1].filter(d=>d<=end&&!hasFixed(isoDay(d)+':'+st.id)&&offNeighbourPriority(d,st.id)>0).length;
           options.push({trial,score:restConflict*10+stranded*20-gain*40+changes*3+total*4+preferenceScore('N',cfg)+random()*5});
         }
       }
       if(!options.length)break;options.sort((a,b)=>a.score-b.score);plan=options[0].trial;
     }
   }
   plan=fillRnNightTargets(plan,cfg,dates,baseline,random);
   // HN and MD planned work, then preserve feasible existing day/evening shifts.
   for(const st of activeStaff().filter(s=>['HN','MD'].includes(s.category)))for(const n of priorityDates){const sh=st.category==='HN'?'D':'M';if(canPlace(plan,n,st,sh,cfg))plan[isoDay(n)+':'+st.id]=sh}
   if(attempt%3===0)for(const n of dates)for(const st of activeStaff()){const k=isoDay(n)+':'+st.id,sh=baseline[k];if(work(sh)&&sh!=='N'&&canPlace(plan,n,st,sh,cfg))plan[k]=sh}
   for(const n of priorityDates)for(const d of dayDemands(n,cfg).filter(d=>d.shift!=='N').sort((a,b)=>Number(b.shift==='M')-Number(a.shift==='M'))){
     while(countShift(plan,n,d.shift,d.roles)<d.min){
       const options=activeStaff().filter(st=>d.roles.includes(st.category||'RN')&&canPlace(plan,n,st,d.shift,cfg)).map(st=>{
         const k=isoDay(n)+':'+st.id,prev=plan[isoDay(n-1)+':'+st.id];
         return {st,score:-60*offNeighbourPriority(n,st.id)+(baseline[k]===d.shift?-20:0)+(prev===d.shift?-4:0)+preferenceScore(d.shift,cfg)+weeklyWorked(plan,n,st.id)*2+random()*8};
       }).sort((a,b)=>a.score-b.score);
       if(!options.length)break;plan[isoDay(n)+':'+options[0].st.id]=d.shift;
     }
   }
   // Minimize unnecessary OFF without introducing surplus N or substituting AN for nurses.
   for(const st of activeStaff().filter(s=>s.category!=='NK'))for(let loop=0;loop<dates.length;loop++){
     const options=[];for(const n of dates)for(const sh of allowedShifts(st.category||'RN').filter(s=>work(s)&&s!=='N')){
       if(!canPlace(plan,n,st,sh,cfg))continue;const k=isoDay(n)+':'+st.id;
       options.push({k,sh,score:-60*offNeighbourPriority(n,st.id)+(baseline[k]===sh?-20:0)+(plan[isoDay(n-1)+':'+st.id]===sh?-4:0)+preferenceScore(sh,cfg)+countShift(plan,n,sh,[st.category])*2+random()*6});
     }
     if(!options.length)break;options.sort((a,b)=>a.score-b.score);plan[options[0].k]=options[0].sh;
   }
   repairDayTargets(plan,cfg,dates);
   let missing=0,changes=0;
   for(const n of dates){for(const d of dayDemands(n,cfg))missing+=Math.max(0,d.min-countShift(plan,n,d.shift,d.roles));for(const st of activeStaff()){const k=isoDay(n)+':'+st.id;plan[k]??='O';if(baseline[k]!==undefined&&baseline[k]!==plan[k])changes++}}
   const criticalMissing=dates.filter(n=>dayKind(n)!=='weekday').reduce((sum,n)=>sum+dayDemands(n,cfg).filter(d=>['D','E','NR','AN'].includes(d.key)).reduce((s,d)=>s+Math.max(0,d.min-countShift(plan,n,d.shift,d.roles)),0),0);
   const unfilled=workTargetGaps(plan,cfg).reduce((s,g)=>s+g.missing,0),balance=nkBalance(plan,cfg).penalty,rnBalance=rnNightBalance(plan,cfg),score=[balance,rnBalance.penalty,criticalMissing,missing,rnBalance.spread,unfilled,unwantedAdjacentOff(plan,dates),cfg.nkRestMatch?nkRestPreference(plan,dates):0,changes];
   const better=!best||score.some((v,i)=>v<best.score[i]&&score.slice(0,i).every((x,j)=>x===best.score[j]));
   if(better)best={plan,missing,changes,unfilled,month,score};
   if(score.every(v=>v===0))break;
 }
 return best;
}

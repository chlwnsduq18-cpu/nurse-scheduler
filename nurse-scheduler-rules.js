// Additional rule definitions, validation and saved-data migration. No UI access.
function defaultAdditionalRules(){return [
 {type:'nkMonthly',value:15},{type:'rnNightMin',value:4},{type:'rnNightMax',value:5},
 {type:'nightMinBlock',value:2},{type:'nightMaxBlock',value:3},
 {type:'nightRest',value:2},{type:'nkRestMatch',value:1},{type:'minRestHours',value:11}
]}
function migrateRosterRules(data){
 data.monthOffLimits=data.monthOffLimits||{};data.monthOffModes=data.monthOffModes||{};
 if((data.schemaVersion||0)<14){
   if(data.rosterSettings){
     data.rosterSettings.weekend={...data.rosterSettings.weekend,HN:false,MD:false};
     for(const kind of ['weekday','saturday','holiday']){
       data.rosterSettings.coverage[kind]={...data.rosterSettings.coverage[kind],D:kind==='weekday'?2:1,E:kind==='weekday'?2:1,N:kind==='weekday'?2:1};
     }
   }
   for(const r of data.rules)if(r.type==='nightRest'||r.type==='weeklyOff')r.value=Math.max(2,Number(r.value)||0);
   for(const rule of defaultAdditionalRules())if(!data.rules.some(r=>r.type===rule.type))data.rules.push(rule);
   data.schemaVersion=14;
 }
}
const RULE_TYPES={
 minimum:{label:'근무별 최소 인원',min:0,max:30,coverage:true},
 maximum:{label:'근무별 최대 인원',min:0,max:30,coverage:true},
 maxConsecutive:{label:'최대 연속 근무일',min:0,max:31},
 nightRest:{label:'N 종료 후 최소 OFF',min:2,max:31},
 weeklyOff:{label:'주간 최소 OFF 일수',min:2,max:7},
 preferred:{label:'선호 근무 우선',shift:true},
 nkMonthly:{label:'NK 1인 월 N 횟수',min:0,max:31},
 rnNightMin:{label:'RN 1인 월 N 최소',min:0,max:31},
 rnNightMax:{label:'RN 1인 월 N 최대',min:0,max:31},
 nightMinBlock:{label:'RN/NK N 묶음 최소',min:1,max:3},
 nightMaxBlock:{label:'RN/NK N 묶음 최대',min:1,max:3},
 nkRestMatch:{label:'NK N 묶음 길이만큼 OFF 선호',min:0,max:1},
 minRestHours:{label:'근무 사이 최소 휴식(시간)',min:11,max:72}
};
function ruleIdentity(rule){return rule.type+(['minimum','maximum'].includes(rule.type)?':'+rule.shift+':'+(rule.group||'ALL')+':'+(rule.day||'ALL'):'')}
function validateRules(rules){
 const errors=[],seen=new Set();
 for(const r of rules){
   const def=RULE_TYPES[r.type];if(!def){errors.push('지원하지 않는 추가 규칙: '+r.type);continue}
   if(seen.has(ruleIdentity(r)))continue;seen.add(ruleIdentity(r));
   if(def.coverage&&(!['D','E','N','M'].includes(r.shift)||!['ALL','nurse','AN'].includes(r.group||'ALL')||!['ALL','weekday','rest'].includes(r.day||'ALL')))errors.push('인원 규칙의 근무·대상·날짜를 확인해주세요.');
   if(def.shift){if(!['ALL','D','E','N','M'].includes(r.shift))errors.push('선호 근무를 확인해주세요.');continue}
   const value=Number(r.value);
   if(r.value===''||!Number.isInteger(value)||value<def.min||value>def.max)errors.push(def.label+': '+def.min+'~'+def.max+' 정수가 필요합니다.');
 }
 const first=type=>rules.find(r=>r.type===type);
 if(Number(first('rnNightMin')?.value??4)>Number(first('rnNightMax')?.value??5))errors.push('RN 월 N 최소는 최대보다 클 수 없습니다.');
 if(Number(first('nightMinBlock')?.value??2)>Number(first('nightMaxBlock')?.value??3))errors.push('N 묶음 최소는 최대보다 클 수 없습니다.');
 return [...new Set(errors)];
}


const KEY="small-hospital-nurse-scheduler-v1";
let state=JSON.parse(localStorage.getItem(KEY)||"null")||{
  staff:[
    {id:1,name:"김민지"},{id:2,name:"이수진"},{id:3,name:"박지현"},
    {id:4,name:"최유진"},{id:5,name:"정하늘"},{id:6,name:"한서윤"}
  ], 
  assignments:{},
  rules:[]
};

if(!state.rules) state.rules = [];
if(!state.staff) state.staff = [];
// v4 분류 체계 마이그레이션: 기존 저장 데이터도 그대로 사용할 수 있게 변환합니다.
state.staff.forEach(s=>{
  if(!s.category){
    if(s.type==="주간") s.category="MD";
    else if(s.type==="야간전담") s.category="NK";
    else if(s.position==="책임간호사") s.category="HN";
    else s.category="RN";
  }
});


// v5: legacy assignments have no provenance; preserve all as user requests.
state.assignments=state.assignments||{};
if(!state.wanted){
  state.wanted={};
  Object.keys(state.assignments).filter(k=>!k.endsWith("_type")).forEach(k=>{
    if(state.assignments[k]) state.wanted[k]=state.assignments[k+"_type"]||"D";
  });
}
state.manual=state.manual||{};
// v14 migrates defaults once; saved rosters and user-entered shifts remain untouched.
migrateRosterRules(state);
state.monthStaff=state.monthStaff||{};
// Freeze existing months before membership is edited; preserve historical rosters.
for(const k of [...Object.keys(state.assignments),...Object.keys(state.wanted)]){
  const month=k.slice(0,7);
  if(/^\d{4}-\d{2}$/.test(month)&&!Object.hasOwn(state.monthStaff,month))state.monthStaff[month]=state.staff.map(st=>st.id);
}
if(state.rosterSettings?.weekend)state.rosterSettings.weekend.MD=false;
state.leave=state.leave||{};
state.holidayYears=state.holidayYears||{};
state.generationSnapshot=state.generationSnapshot||null; // One latest snapshot, never a history array.
let cursor=new Date(2026,8,1);
let viewMode="calendar";
const save=()=>{
  try{localStorage.setItem(KEY,JSON.stringify(state));return true}
  catch(error){alert("저장하지 못했습니다. 브라우저 저장 공간 또는 저장 권한을 확인해주세요. 현재 변경은 이 화면에만 남아 있습니다.");return false}
};
save();

function putAssignment(k,shift){state.assignments[k]=1;state.assignments[k+"_type"]=shift}
function setWanted(k,shift){
  if(state.manual)delete state.manual[k];
  delete state.leave[k];
  if(shift==='V'){state.leave[k]='vacation';shift='O'}
  state.wanted[k]=shift;putAssignment(k,shift);
}



function setManual(k,shift){
  state.manual=state.manual||{};delete state.wanted[k];delete state.leave[k];
  if(shift==='V'){state.leave[k]='vacation';shift='O'}
  state.manual[k]=shift;putAssignment(k,shift);
}
function saveUserShift(k,shift,wanted){
  const previous=JSON.parse(JSON.stringify(state));
  if(wanted)setWanted(k,shift);else setManual(k,shift);
  if(!save()){state=previous;return false}return true;
}
function releaseWanted(k){
  if(state.manual)delete state.manual[k];
  delete state.leave[k];
  delete state.wanted[k];
  delete state.assignments[k];delete state.assignments[k+"_type"];
}
function removeRelated(predicate){
  Object.keys(state.manual||{}).forEach(k=>{if(predicate(k))delete state.manual[k]});
  Object.keys(state.assignments).forEach(k=>{if(predicate(k.endsWith("_type")?k.slice(0,-5):k))delete state.assignments[k]});
  Object.keys(state.wanted).forEach(k=>{if(predicate(k))delete state.wanted[k]});
  Object.keys(state.leave).forEach(k=>{if(predicate(k))delete state.leave[k]});
  if(state.generationSnapshot){
    Object.keys(state.generationSnapshot.shifts).forEach(k=>{if(predicate(k))delete state.generationSnapshot.shifts[k]});
    if(!Object.keys(state.generationSnapshot.shifts).length)state.generationSnapshot=null;
  }
}


function ensureMonthStaff(){
  const month=rosterMonth();
  if(!Object.hasOwn(state.monthStaff,month)){
    state.monthStaff[month]=[...monthStaffIds(month)];save();
  }
}
function saveMonthStaff(ids){
  const previous=state.monthStaff;
  const chosen=new Set(ids);
  state.monthStaff={...previous,[rosterMonth()]:state.staff.filter(st=>chosen.has(st.id)).map(st=>st.id)};
  if(!save()){state.monthStaff=previous;return false}return true;
}
function reorderStaff(id,targetId,after=false){
  const previous=state.staff,source=previous.find(st=>st.id===id);
  if(!source||id===targetId||!previous.some(st=>st.id===targetId))return false;
  const next=previous.filter(st=>st.id!==id),index=next.findIndex(st=>st.id===targetId);
  next.splice(index+(after?1:0),0,source);state.staff=next;
  if(!save()){state.staff=previous;return false}return true;
}
function openMonthStaff(){
  const dialog=document.getElementById('monthStaffDialog'),selected=new Set(monthStaffIds());
  document.getElementById('monthStaffTitle').textContent=rosterMonth()+' 편성 인원';
  document.getElementById('monthStaffChoices').innerHTML=state.staff.map(st=>`<label class="month-staff-choice"><input type="checkbox" value="${st.id}" ${selected.has(st.id)?'checked':''}><span>${esc(st.name)} · ${esc(st.category||'RN')}</span></label>`).join('')||'<p>등록된 직원이 없습니다.</p>';
  dialog.showModal();
}
document.getElementById('monthStaffSettings').onclick=openMonthStaff;
document.getElementById('cancelMonthStaff').onclick=()=>document.getElementById('monthStaffDialog').close();
document.getElementById('saveMonthStaff').onclick=()=>{
  const ids=Array.from(document.querySelectorAll('#monthStaffChoices input:checked'),el=>Number(el.value));
  const removed=activeStaff().filter(st=>!ids.includes(st.id));
  const hasData=removed.some(st=>Object.keys(state.assignments).some(k=>k.startsWith(rosterMonth()+'-')&&k.endsWith(':'+st.id))||Object.keys(state.wanted).some(k=>k.startsWith(rosterMonth()+'-')&&k.endsWith(':'+st.id)));
  if(hasData&&!confirm('제외할 직원에게 이 달의 근무 또는 원티드가 있습니다. 데이터는 보관하고 표시·자동 생성·집계·엑셀에서 제외할까요? 다시 포함하면 기존 데이터를 볼 수 있습니다.'))return;
  if(saveMonthStaff(ids)){document.getElementById('monthStaffDialog').close();render()}
};

function render(){
  ensureMonthStaff();
  document.getElementById("monthStaffSettings").textContent=`이번 달 편성 인원 (${activeStaff().length}/${state.staff.length})`;
  const issues=showValidation();
  const y=cursor.getFullYear(), m=cursor.getMonth();
  monthTitle.textContent=`${y}년 ${m+1}월`;
  staffList.innerHTML="";
  state.staff.forEach(s=>{
    const el=document.createElement("div"); el.className="staff"; el.draggable=true; el.tabIndex=0; el.title="끌어서 목록 순서 변경 또는 날짜에 배정 · Alt+위/아래로 순서 변경"; el.dataset.id=s.id;
    el.innerHTML=`<div class="staff-info"><span class="dot"></span><div class="staff-main"><span class="staff-name">${esc(s.name)}</span><span class="staff-category" data-category="${esc(s.category||"RN")}">${esc(s.category||"RN")}</span></div></div><div><button class="del edit" title="정보 수정">정보</button><button class="del" title="삭제">×</button></div>`;
    el.classList.toggle('staff-excluded',!activeStaff().some(st=>st.id===s.id));
    el.ondragstart=e=>{
      if(e.target.closest('button')){e.preventDefault();return}
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('application/x-staff-order',String(s.id));
      e.dataTransfer.setData('staffId',String(s.id));
    };
    el.onkeydown=e=>{
      if(e.target!==el||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
      const index=state.staff.findIndex(st=>st.id===s.id),target=state.staff[index+(e.key==='ArrowUp'?-1:1)];
      if(target&&reorderStaff(s.id,target.id,e.key==='ArrowDown')){render();staffList.querySelector(`[data-id="${s.id}"]`)?.focus()}
    };
    el.ondragover=e=>{if(Array.from(e.dataTransfer.types).includes('application/x-staff-order')){e.preventDefault();el.classList.add('reorder-over')}};
    el.ondragleave=()=>el.classList.remove('reorder-over');
    el.ondrop=e=>{const id=Number(e.dataTransfer.getData('application/x-staff-order'));if(!id)return;e.preventDefault();e.stopPropagation();el.classList.remove('reorder-over');if(reorderStaff(id,s.id,e.clientY>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2))render()};
    el.ondragend=()=>staffList.querySelectorAll('.reorder-over').forEach(n=>n.classList.remove('reorder-over'));
    el.querySelector(".edit").onclick=()=>openStaffModal(s.id);
    el.querySelector(".del:not(.edit)").onclick=()=>{
      if(confirm(`${s.name} 간호사를 삭제할까요?`)){
        state.staff=state.staff.filter(x=>x.id!==s.id);
        Object.keys(state.monthStaff).forEach(m=>state.monthStaff[m]=state.monthStaff[m].filter(id=>id!==s.id));
        removeRelated(k=>k.endsWith(":"+s.id));
        save();
        render();
      }
    };
    staffList.appendChild(el);
  });
  calendarViewBtn.classList.toggle("active",viewMode==="calendar");
  tableViewBtn.classList.toggle("active",viewMode==="table");
  calendar.classList.toggle("hidden",viewMode!=="calendar");
  scheduleTableWrap.classList.toggle("active",viewMode==="table");
  scheduleViewHint.textContent=viewMode==="calendar" ? "간호사 목록 → 날짜로 Drag & Drop" : "간호사별 월간 근무표 · 셀을 클릭하여 근무 등록/수정";
  if(viewMode==="table"){
    renderScheduleTable();
    return;
  }
  const cal=document.getElementById("calendar");cal.innerHTML="";
  ["일","월","화","수","목","금","토"].forEach(x=>{let h=document.createElement("div");h.className="dow";h.textContent=x;cal.appendChild(h)});
  const first=new Date(y,m,1), startDate=new Date(y,m,1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(startDate);d.setDate(startDate.getDate()+i);
    const dateKey=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const cell=document.createElement("div");cell.className="day"+(d.getMonth()!==m?" out":"");
    cell.innerHTML=`<div class="day-top"><div class="num" title="클릭하여 펼치기">${d.getDate()}</div><div class="shift-summary"><span>D <b data-summary="D">0</b></span><span>E <b data-summary="E">0</b></span><span>N <b data-summary="N">0</b></span><span>M <b data-summary="M">0</b></span></div></div><div class="dropzone"></div>`;
    
    // 셀 클릭 시 모달 오픈 (단, 배정 항목이나 버튼 클릭 시 제외)
    cell.onclick=(e)=>{
      if(e.target.closest(".assignment") || e.target.closest(".num")) return;
      openAssignmentModal(dateKey);
    };

    if(issues[dateKey]){
      cell.classList.add('needs-review');cell.title=issues[dateKey].join(' / ');
      const warning=document.createElement('button');warning.className='day-warning';warning.textContent='⚠ 확인 필요';
      warning.onclick=e=>{e.stopPropagation();openAssignmentModal(dateKey)};cell.appendChild(warning);
    }
    const holiday=holidayName(dayNumber(dateKey));
    if(holiday){cell.classList.add('public-holiday');cell.querySelector('.num').title=holiday+' · 클릭하여 펼치기'}
    const num=cell.querySelector(".num");
    num.onclick=(e)=>{
      e.stopPropagation();
      document.querySelectorAll(".day.expanded").forEach(other=>{if(other!==cell)other.classList.remove("expanded")});
      cell.classList.toggle("expanded");
    };

    const dz=cell.querySelector(".dropzone");dz.dataset.date=dateKey;
    dz.ondragover=e=>{e.preventDefault();dz.classList.add("over")};
    dz.ondragleave=()=>dz.classList.remove("over");
    dz.ondrop=e=>{
      e.preventDefault();dz.classList.remove("over");
      moveAssignmentToDate(e,dateKey);
    };
    const list=document.createElement("div");list.className="assignment-list";dz.appendChild(list);
    
    const summary={D:0,E:0,N:0,M:0};
    activeStaff(dateKey.slice(0,7)).forEach(s=>{
      const k=keyFor(d,s.id);
      const sh=state.assignments[k+"_type"]||"D";
      if(state.assignments[k] && sh!=="O") summary[sh]++;
    });
    cell.querySelectorAll("[data-summary]").forEach(el=>{el.textContent=summary[el.dataset.summary]||0});
    
    list.ondragover=e=>{e.preventDefault();dz.classList.add("over");list.classList.add("over")};
    list.ondragleave=e=>{if(!list.contains(e.relatedTarget)){list.classList.remove("over");if(!dz.matches(":hover"))dz.classList.remove("over")}};
    list.ondrop=e=>{e.preventDefault();e.stopPropagation();list.classList.remove("over");dz.classList.remove("over");moveAssignmentToDate(e,dateKey)};
    
    activeStaff(dateKey.slice(0,7)).forEach(s=>{
      const k=keyFor(d,s.id);
      if(state.assignments[k] && (state.assignments[k+"_type"]!=="O" || hasFixed(k))){
        const a=document.createElement("div");a.className="assignment";a.draggable=true;a.dataset.key=k;
        const shiftType=state.assignments[k+"_type"]||"D";
        const displayName=shortName(s.name);
        a.innerHTML=`<span class="assignment-name" title="${esc(s.name)}">${esc(displayName)}</span><button class="shift-badge shift-${isVacation(k)?'V':esc(shiftType)}" title="근무 형태 변경 · ${esc(s.name)}" aria-label="${esc(s.name)} 근무 형태 변경">${displayShift(k,shiftType)}${hasWanted(k)?" 🔒":""}</button><button class="remove-shift" title="지정 OFF로 변경" aria-label="${esc(s.name)} 지정 OFF로 변경">O</button>`;
        const shiftBtn=a.querySelector(".shift-badge");
        shiftBtn.onclick=e=>{e.stopPropagation();openShiftModal(k)};
        a.querySelector(".remove-shift").onclick=e=>{e.stopPropagation();if(saveUserShift(k,"O",hasWanted(k)))render()};
        a.onclick=e=>{if(e.target.closest("button"))return;openShiftModal(k)};
        a.addEventListener("dragstart",e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("assignmentKey",k);a.classList.add("dragging")});
        a.addEventListener("dragend",()=>{a.classList.remove("dragging");document.querySelectorAll(".assignment-list.over").forEach(x=>x.classList.remove("over"));document.querySelectorAll(".dropzone.over").forEach(x=>x.classList.remove("over"))});
        list.appendChild(a);
      }
    });
    cal.appendChild(cell);
  }
}


function getAssignmentShift(date,staffId){
  const k=keyFor(date,staffId);
  return state.assignments[k] ? (state.assignments[k+"_type"]||"D") : "O";
}

function renderScheduleTable(){
  const issues=analyzeMonth();
  const y=cursor.getFullYear(),m=cursor.getMonth(),days=getDaysInMonth(y,m);
  const dates=Array.from({length:days},(_,i)=>new Date(y,m,i+1));
  const dayNames=["일","월","화","수","목","금","토"];
  const summaries={};
  dates.forEach(d=>{
    const dk=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    summaries[dk]={D:0,E:0,N:0,M:0};
    activeStaff().forEach(st=>{
      const sh=getAssignmentShift(d,st.id);
      if(sh!=="O") summaries[dk][sh]=(summaries[dk][sh]||0)+1;
    });
  });

  let html='<thead><tr><th class="staff-col">이름</th><th class="category-col">분류</th>';
  dates.forEach(d=>{
    const dk=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const cls=holidayName(dayNumber(dk))?' public-holiday':d.getDay()===0?' sun':d.getDay()===6?' sat':'';
    const sm=summaries[dk];
    html+=`<th class="date-head${cls}${issues[dk]?' needs-review':''}" title="${esc(holidayName(dayNumber(dk))+' '+(issues[dk]||[]).join(' / '))}"><span class="weekday">${dayNames[d.getDay()]}</span><span class="date-num">${d.getDate()}${issues[dk]?' ⚠':''}</span><div class="table-day-summary"><span>D${sm.D}</span><span>E${sm.E}</span><span>N${sm.N}</span><span>M${sm.M}</span></div></th>`;
  });
  html+='<th class="total-col">월 합계</th></tr></thead><tbody>';

  activeStaff().forEach(st=>{
    const counts={D:0,E:0,N:0,M:0,O:0,V:0};
    html+=`<tr><th class="staff-col" title="${esc(st.name)}">${esc(st.name)}</th><td class="category-col">${esc(st.category||"RN")}</td>`;
    dates.forEach(d=>{
      const sh=getAssignmentShift(d,st.id);
      const countCode=isVacation(keyFor(d,st.id))?'V':sh;
      counts[countCode]=(counts[countCode]||0)+1;
      const dk=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      html+=`<td class="shift-cell${issues[dk]?' needs-review':''}" data-date="${dk}" data-staff-id="${st.id}" title="${esc(st.name)} · ${dk} · ${sh} ${esc((issues[dk]||[]).join(' / '))}"><span class="table-shift shift-${isVacation(keyFor(d,st.id))?'V':sh}">${displayShift(keyFor(d,st.id),sh)}${hasWanted(keyFor(d,st.id))?'<small class="wanted-mark" title="사용자 지정">🔒</small>':""}</span></td>`;
    });
    html+=`<td class="total-col">D${counts.D} · E${counts.E} · N${counts.N} · M${counts.M} · O${counts.O} · 휴가${counts.V}</td></tr>`;
  });
  html+='</tbody>';
  scheduleTable.innerHTML=html;
  scheduleTable.querySelectorAll('.shift-cell').forEach(cell=>{
    cell.onclick=()=>{
      const dateKey=cell.dataset.date;
      const staffId=Number(cell.dataset.staffId);
      const key=`${dateKey}:${staffId}`;
      if(state.assignments[key]) openShiftModal(key);
      else openAssignmentModal(dateKey,staffId);
    };
  });
}

calendarViewBtn.onclick=()=>{viewMode="calendar";render()};
tableViewBtn.onclick=()=>{viewMode="table";render()};


function shortName(name){
  const value=String(name||"").trim();
  return value.length<=3 ? value : value.slice(0,2)+"...";
}

function moveAssignmentToDate(e,dateKey){
  const staffId=Number(e.dataTransfer.getData("staffId"));
  const fromKey=e.dataTransfer.getData("assignmentKey");
  if(staffId){
    if(!activeStaff(dateKey.slice(0,7)).some(st=>st.id===staffId)){alert('이번 달 편성 인원에서 먼저 포함해주세요.');return}
    const newKey=`${dateKey}:${staffId}`;
    if(!state.assignments[newKey]){
      openAssignmentModal(dateKey,staffId);
    }
    return;
  }
  if(fromKey){
    const parts=fromKey.split(":");
    const id=Number(parts[1]);
    if(!activeStaff(dateKey.slice(0,7)).some(st=>st.id===id)){alert('해당 월의 편성 인원에 포함되지 않은 직원입니다.');return}
    const newKey=`${dateKey}:${id}`;
    if(fromKey===newKey)return;
    if(state.assignments[newKey]){
      alert("해당 날짜에 이미 같은 간호사가 배정되어 있습니다.");
      return;
    }
    const oldType=isVacation(fromKey)?"V":state.assignments[fromKey+"_type"]||"D";
    const previous=JSON.parse(JSON.stringify(state)),wanted=hasWanted(fromKey);
    setManual(fromKey,"O");
    if(wanted)setWanted(newKey,oldType);else setManual(newKey,oldType);
    if(!save()){state=previous;return}render();
  }
}

// Keep the provenance controls available even when an older HTML shell is cached.
for(const [id,target] of [['assignmentWanted','assignmentShiftOptions'],['shiftWanted','shiftOptions']]){
  if(!document.getElementById(id))document.getElementById(target)?.insertAdjacentHTML('beforebegin',`<label class="wanted-toggle"><input type="checkbox" id="${id}" checked> 원티드로 등록</label><p class="hint">체크 해제: 일반 수동 조정. 체크 후 근무 버튼을 누르면 저장됩니다.</p>`);
}
let assignmentShiftType="D";

function openAssignmentModal(dateKey, staffId=null){
  assignmentDateInput.value=dateKey;
  const parts=dateKey.split(":");
  const datePart=parts[0];
  const d=new Date(datePart+"T00:00:00");
  assignmentDateDisplay.value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  assignmentStaffInput.innerHTML="";
  activeStaff(datePart.slice(0,7)).forEach(s=>{
    const option=document.createElement("option");
    option.value=s.id;
    option.textContent=s.name;
    assignmentStaffInput.appendChild(option);
  });

  let selectedId=staffId ? Number(staffId) : null;
  if(!selectedId && parts[1]) selectedId=Number(parts[1]);
  if(selectedId && activeStaff(datePart.slice(0,7)).some(s=>s.id===selectedId)) assignmentStaffInput.value=selectedId;

  const currentKey=`${datePart}:${Number(assignmentStaffInput.value)}`;
  document.getElementById("assignmentWanted").checked=hasWanted(currentKey)||(!hasManual(currentKey)&&!state.assignments[currentKey]);
  assignmentShiftType=isVacation(currentKey)?"V":(currentKey && state.assignments[currentKey+"_type"]) || "D";
  document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(b=>{
    b.classList.toggle("active",b.dataset.shift===assignmentShiftType);
  });
  assignmentModalSubtitle.textContent=`${datePart} 근무를 등록하거나 수정합니다. `+(analyzeMonth()[datePart]||[]).join(" / ");
  assignmentModal.classList.add("open");
  assignmentModal.setAttribute("aria-hidden","false");
}

function closeAssignmentModal(){
  assignmentModal.classList.remove("open");
  assignmentModal.setAttribute("aria-hidden","true");
}

function syncAssignmentShiftForSelectedStaff(){
  const dateKey=assignmentDateInput.value;
  const staffId=Number(assignmentStaffInput.value);
  const currentKey=dateKey && staffId ? `${dateKey}:${staffId}` : "";
  document.getElementById("assignmentWanted").checked=hasWanted(currentKey)||(!hasManual(currentKey)&&!state.assignments[currentKey]);
  assignmentShiftType=isVacation(currentKey)?"V":(currentKey && state.assignments[currentKey+"_type"]) || "D";
  document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(b=>{
    b.classList.toggle("active",b.dataset.shift===assignmentShiftType);
  });
}

document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(b=>{
  b.onclick=()=>{
    assignmentShiftType=b.dataset.shift;
    saveAssignment.onclick();
  };
});
const closeAssignmentModalButton=document.getElementById("closeAssignmentModal");
closeAssignmentModalButton.onclick=closeAssignmentModal;
cancelAssignmentModal.onclick=closeAssignmentModal;
assignmentStaffInput.onchange=syncAssignmentShiftForSelectedStaff;
assignmentModal.addEventListener("click",e=>{if(e.target===assignmentModal)closeAssignmentModal()});

saveAssignment.onclick=()=>{
  const dateKey=assignmentDateInput.value;
  const staffId=Number(assignmentStaffInput.value);
  if(!dateKey || !staffId||!activeStaff(dateKey.slice(0,7)).some(st=>st.id===staffId))return;
  const key=`${dateKey}:${staffId}`;
  if(!saveUserShift(key,assignmentShiftType,document.getElementById("assignmentWanted").checked))return;
  closeAssignmentModal();
  render();
};

let ruleDraft=[];
function renderRules(){
 ruleList.innerHTML='';
 if(!ruleDraft.length){ruleList.innerHTML='<div class="hint">추가 규칙이 없습니다. 기본 기준이 적용됩니다.</div>';return}
 ruleDraft.forEach((rule,i)=>{
   const row=document.createElement('div');row.className='rule-item';
   row.innerHTML=`<div class="rule-order">${i+1}</div><select class="rule-type" aria-label="추가 규칙 종류">${Object.entries(RULE_TYPES).map(([key,def])=>`<option value="${key}">${def.label}</option>`).join('')}</select><div class="rule-value-wrap"></div><button class="rule-remove" title="규칙 삭제">×</button>`;
   const type=row.querySelector('.rule-type'),wrap=row.querySelector('.rule-value-wrap');type.value=rule.type;
   const buildValue=()=>{
     const def=RULE_TYPES[type.value];
     if(def.coverage){
       wrap.innerHTML=`<div class="rule-coverage-fields"><select class="rule-shift" aria-label="근무"><option>D</option><option>E</option><option>N</option><option>M</option></select><select class="rule-group" aria-label="대상"><option value="ALL">간호사·AN 각각</option><option value="nurse">간호사</option><option value="AN">AN</option></select><select class="rule-day" aria-label="날짜"><option value="ALL">모든 날짜</option><option value="weekday">일반 평일</option><option value="rest">주말·공휴일</option></select><input class="rule-number" aria-label="인원" type="number" step="1" min="${def.min}" max="${def.max}"></div>`;
       for(const key of ['shift','group','day']){const el=wrap.querySelector('.rule-'+key);el.value=rule[key]|| (key==='shift'?'D':'ALL');el.onchange=()=>rule[key]=el.value}
     }else if(def.shift){wrap.innerHTML='<select class="rule-shift" aria-label="선호 근무"><option>ALL</option><option>D</option><option>E</option><option>N</option><option>M</option></select>';const el=wrap.querySelector('.rule-shift');el.value=rule.shift||'ALL';el.onchange=()=>rule.shift=el.value}
     else wrap.innerHTML=`<input class="rule-number" aria-label="규칙 값" type="number" step="1" min="${def.min}" max="${def.max}">`;
     const input=wrap.querySelector('.rule-number');if(input){input.value=rule.value??def.min;input.oninput=()=>rule.value=input.value}
   };
   buildValue();type.onchange=()=>{rule.type=type.value;rule.value=defaultAdditionalRules().find(r=>r.type===rule.type)?.value??RULE_TYPES[rule.type].min??'';buildValue()};
   row.querySelector('.rule-remove').onclick=()=>{ruleDraft.splice(i,1);renderRules()};ruleList.appendChild(row);
 });
}

addRule.onclick=()=>{
  ruleDraft.push({type:"minimum",shift:"D",value:"1"});
  renderRules();
};

ruleSettings.onclick=()=>{
  ruleDraft=JSON.parse(JSON.stringify(state.rules));renderTimeSettings();renderRosterSettings();renderRules();
  ruleModal.classList.add("open");
  ruleModal.setAttribute("aria-hidden","false");
};
function closeRuleModal(){
  ruleModal.classList.remove("open");
  ruleModal.setAttribute("aria-hidden","true");
}
const closeRuleModalButton=document.getElementById("closeRuleModal");
closeRuleModalButton.onclick=closeRuleModal;
cancelRuleModal.onclick=closeRuleModal;
ruleModal.addEventListener("click",e=>{if(e.target===ruleModal)closeRuleModal()});

saveRules.onclick=()=>{
  let rosterDraft;
  try{rosterDraft=readRosterSettings()}catch(error){alert(error.message);return}
  const shiftTimes=JSON.parse(JSON.stringify(defaultShiftTimes));
  for(const input of shiftTimeSettings.querySelectorAll('input')){
    if(!input.value || !input.checkValidity()){alert('근무시간과 휴게시간을 올바르게 입력해주세요.');return}
    shiftTimes[input.dataset.code][input.dataset.field]=input.dataset.field==='breakMinutes'?Number(input.value):input.value;
  }
  const rules=JSON.parse(JSON.stringify(ruleDraft)),errors=validateRules(rules);
  if(errors.length){alert(errors.join('\n'));return}
  const previous=JSON.parse(JSON.stringify(state));
  state.shiftTimes=shiftTimes;state.shiftTimesConfirmed=confirmShiftTimes.checked;
  state.monthOffLimits={...state.monthOffLimits,[rosterMonth()]:rosterDraft.offLimit};
  state.monthOffModes={...state.monthOffModes,[rosterMonth()]:rosterDraft.offMode};
  state.rosterSettings=rosterDraft.settings;state.holidayYears[cursor.getFullYear()]=rosterDraft.calendar;
  state.rules=rules;
  if(!save()){state=previous;return}

  closeRuleModal();render();
};

// Local dependencies are loaded only when exporting. Paths resolve next to index.html.
let excelModulesPromise;
function loadExcelModules(){
  if(excelModulesPromise)return excelModulesPromise;
  const load=(path,ready)=>ready()?Promise.resolve():new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL(path,document.baseURI).href;
    script.onload=()=>ready()?resolve():reject(new Error('엑셀 모듈 초기화에 실패했습니다: '+path));
    script.onerror=()=>{script.remove();reject(new Error(path+' 파일을 불러오지 못했습니다. 배포 파일을 확인해주세요.'));};
    document.head.appendChild(script);
  });
  excelModulesPromise=load('vendor/jszip.min.js',()=>!!globalThis.JSZip)
    .then(()=>load('nurse-scheduler-excel.js?v=20261002-rules5',()=>!!globalThis.NurseSchedulerExcel))
    .catch(error=>{excelModulesPromise=null;throw error;});
  return excelModulesPromise;
}
exportExcel.onclick=async()=>{
  if(exportExcel.disabled)return;
  if(location.protocol==='file:'){
    alert('템플릿을 읽으려면 GitHub Pages 또는 http://localhost:8080에서 사이트를 열어주세요. HTML 파일을 직접 열면 브라우저가 엑셀 파일 접근을 제한합니다.');
    return;
  }
  // Capture the visible month before any asynchronous work so navigation cannot mix months.
  const dates=getMonthDates(),year=cursor.getFullYear(),month=cursor.getMonth()+1;
  const options={year,month,spareRows:1,baseOff:monthlyOffLimit(),holidays:{...holidaysFor(year)},
    issues:Object.entries(analyzeMonth()),
    staff:activeStaff().map(st=>({id:st.id,name:st.name,category:st.category||'RN',
      manual:dates.map(d=>hasManual(keyFor(d,st.id))),
      wanted:dates.map(d=>Object.hasOwn(state.wanted||{},keyFor(d,st.id))),
      shifts:dates.map(d=>{const k=keyFor(d,st.id);return displayShift(k,state.assignments[k]?(state.assignments[k+'_type']||'D'):'O');})}))};
  const label=exportExcel.textContent;
  exportExcel.disabled=true;exportExcel.textContent='엑셀 작성 중…';
  try{
    await loadExcelModules();
    const response=await fetch(new URL('nurse_scheduler_template.xlsx',document.baseURI),{cache:'no-store'});
    if(!response.ok)throw new Error('nurse_scheduler_template.xlsx를 찾을 수 없습니다. index.html과 같은 폴더에 파일을 두고 함께 업로드해주세요. (HTTP '+response.status+')');
    const bytes=await response.arrayBuffer();
    if(new Uint8Array(bytes)[0]!==0x50||new Uint8Array(bytes)[1]!==0x4b)throw new Error('템플릿이 올바른 .xlsx 파일이 아닙니다. 파일명과 배포 경로를 확인해주세요.');
    const result=await NurseSchedulerExcel.build(bytes,options);
    const url=URL.createObjectURL(new Blob([result.bytes],{type:result.mimeType}));
    const link=document.createElement('a');link.href=url;link.download=result.filename;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(error){
    console.error('Excel template export failed',error);
    alert('엑셀을 출력하지 못했습니다.\n'+(error.message||String(error)));
  }finally{exportExcel.disabled=false;exportExcel.textContent=label;}
};

function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
add.onclick=()=>openStaffModal();
prev.onclick=()=>{cursor.setMonth(cursor.getMonth()-1);render()};
next.onclick=()=>{cursor.setMonth(cursor.getMonth()+1);render()};
// Reset only the visible month. The wanted map is the source of truth, including
// explicit OFF and vacation, rather than inferring manual entries from the grid.
function resetCurrentMonth(keepWanted){
  const month=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const label=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;
  const message=keepWanted
    ? `${label}의 자동 배정과 일반 수동 조정을 초기화할까요?\n체크된 원티드 근무·OFF·휴가는 유지합니다. 일반 수동 조정은 삭제합니다.\n이 달의 자동생성 스냅샷도 삭제합니다.`
    : `${label}의 근무표를 전체 초기화할까요?\n원티드·일반 수동 조정·휴가·자동 배정을 모두 삭제합니다.\n이 달의 자동생성 스냅샷도 삭제합니다.`;
  if(!confirm(message))return false;
  const prefix=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-`;
  const previous=state;
  state=JSON.parse(JSON.stringify(previous));
  removeRelated(k=>k.startsWith(prefix));
  if(state.generationSnapshot?.month===month)state.generationSnapshot=null;
  if(keepWanted){
    Object.entries(previous.wanted).forEach(([k,shift])=>{
      if(!k.startsWith(prefix))return;
      state.wanted[k]=shift;putAssignment(k,shift);
      if(Object.prototype.hasOwnProperty.call(previous.leave,k))state.leave[k]=previous.leave[k];
    });
  }
  if(!save()){state=previous;render();return false;}
  render();return true;
}
document.getElementById('clearAuto').onclick=()=>resetCurrentMonth(true);
clear.onclick=()=>resetCurrentMonth(false);

function openStaffModal(id=null){
  staffModal.classList.add("open");
  staffModal.setAttribute("aria-hidden","false");
  const s=id ? state.staff.find(x=>x.id===id) : null;
  editStaffId.value=s?.id||"";
  staffNameInput.value=s?.name||"";
  staffCategoryInput.value=s?.category||"RN";
  staffCareerInput.value=s?.career??"";
  staffPhoneInput.value=s?.phone||"";
  staffMemoInput.value=s?.memo||"";
  modalSubtitle.textContent=s ? `${s.name} 간호사의 기본 정보를 수정합니다.` : "간호사의 기본 정보를 등록합니다.";
  staffNameInput.focus();
}
function closeStaffModal(){
  staffModal.classList.remove("open");
  staffModal.setAttribute("aria-hidden","true");
}
closeModal.onclick=closeStaffModal;
cancelModal.onclick=closeStaffModal;
staffModal.addEventListener("click",e=>{if(e.target===staffModal)closeStaffModal()});
saveStaff.onclick=()=>{
  const name=staffNameInput.value.trim();
  if(!name){alert("이름을 입력해주세요.");staffNameInput.focus();return}
  const id=Number(editStaffId.value);
  const data={
    name,
    category:staffCategoryInput.value,
    career:Number(staffCareerInput.value||0),
    phone:staffPhoneInput.value.trim(),
    memo:staffMemoInput.value.trim()
  };
  if(id){
    const s=state.staff.find(x=>x.id===id);
    Object.assign(s,data);
  }else{
    const newId=Date.now();
    state.staff.push({id:newId,...data});
    state.monthStaff[rosterMonth()]=[...monthStaffIds(),newId];
  }
  save(); closeStaffModal(); render();
};

let editingAssignmentKey=null;
function openShiftModal(k){
  editingAssignmentKey=k;
  const parts=k.split(":");
  const s=state.staff.find(x=>x.id===Number(parts[1]));
  const current=isVacation(k)?"V":state.assignments[k+"_type"]||"O";
  document.getElementById("shiftWanted").checked=hasWanted(k)||(!hasManual(k)&&!state.assignments[k]);
  shiftModal.classList.add("open");shiftModal.setAttribute("aria-hidden","false");
  shiftModalSubtitle.textContent=s ? `${s.name} · ${parts[0]} ${hasWanted(k)?"원티드 · 자동 생성 시 보호":hasManual(k)?"수동 조정 · 자동 생성 시 보호":"자동 배정"} · 근무 형태를 변경합니다.` : "배정된 근무 형태를 변경합니다.";
  document.querySelectorAll("#shiftOptions .shift-option").forEach(b=>b.classList.toggle("active",b.dataset.shift===current));
}
function closeShiftModal(){shiftModal.classList.remove("open");shiftModal.setAttribute("aria-hidden","true");editingAssignmentKey=null}
const closeShiftModalButton=document.getElementById("closeShiftModal");
closeShiftModalButton.onclick=closeShiftModal;
shiftModal.addEventListener("click",e=>{if(e.target===shiftModal)closeShiftModal()});
document.querySelectorAll("#shiftOptions .shift-option").forEach(b=>b.onclick=()=>{if(!editingAssignmentKey)return;if(!saveUserShift(editingAssignmentKey,b.dataset.shift,document.getElementById("shiftWanted").checked))return;closeShiftModal();render()});
deleteAssignment.onclick=()=>{if(!editingAssignmentKey)return;releaseWanted(editingAssignmentKey);save();closeShiftModal();render()};

document.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  if(shiftModal.classList.contains("open")) closeShiftModal();
  else if(assignmentModal.classList.contains("open")) closeAssignmentModal();
  else if(ruleModal.classList.contains("open")) closeRuleModal();
  else if(staffModal.classList.contains("open")) closeStaffModal();
});

function showValidation(){
 const issues=analyzeMonth(),entries=Object.entries(issues),year=cursor.getFullYear();
 const known=state.holidayYears?.[year]?state.holidayYears[year].confirmed:year===2026;
 generationStatus.innerHTML=`<div>간호사/AN 별도 인원 · 공휴일 우선 · 주말 설정: 편성 규칙 · <span class="vacation-legend">휴가</span>${!known?' · ⚠ 이 연도 공휴일 입력·확인이 필요합니다.':''}${!state.shiftTimesConfirmed?' · 근무시간은 예시입니다.':''}</div><details><summary>${entries.length?`⚠ 확인 필요 ${entries.length}일 — 사유 보기`:'기본 편성 검사에서 부족·초과 없음'}</summary>${entries.map(([dk,msg])=>`<div><b>${dk}</b> ${esc(msg.join(' / '))}</div>`).join('')}</details>`;
 return issues;
}
function renderRosterSettings(){
 document.getElementById('offModeManual').onchange=()=>{const manual=document.getElementById('offModeManual').checked;document.getElementById('monthlyOffLimit').disabled=!manual;if(!manual)document.getElementById('monthlyOffLimit').value=calendarOffCount()};

 const manual=state.monthOffModes?.[rosterMonth()]==='manual';
 document.getElementById('offModeManual').checked=manual;
 document.getElementById('monthlyOffLimit').value=monthlyOffLimit();document.getElementById('monthlyOffLimit').disabled=!manual;
 document.getElementById('offCalendarCount').textContent=calendarOffCount()+'일 (토·일·공휴일 중복 제외)';
 const settings=rosterSettings();
 weekendSettings.innerHTML=['HN','RN','MD','NK','AN'].map(role=>`<label><input type="checkbox" data-role="${role}" ${!['HN','MD'].includes(role)&&settings.weekend[role]?'checked':''} ${['HN','MD'].includes(role)?'disabled':''}> ${role} ${['HN','MD'].includes(role)?'주말·공휴일 OFF (고정)':'주말·공휴일 근무 가능'}</label>`).join('');
 coverageSettings.innerHTML='<table class="coverage-editor"><thead><tr><th>날짜</th><th>D RN(고정)</th><th>E RN(고정)</th><th>N RN+NK(최소)</th><th>D AN</th><th>E AN</th><th>N AN</th></tr></thead><tbody>'+Object.entries(settings.coverage).map(([kind,row])=>`<tr><th>${{weekday:'평일',saturday:'토요일',holiday:'일요일·공휴일'}[kind]}</th>${['D','E','N','AD','AE','AN'].map(key=>`<td><input type="number" min="0" max="30" step="1" data-kind="${kind}" data-field="${key}" value="${row[key]}" aria-label="${kind} ${key}"></td>`).join('')}</tr>`).join('')+'</tbody></table>';
 const year=cursor.getFullYear();holidayYearLabel.textContent=year+'년 공휴일';
 holidayDates.value=Object.entries(holidaysFor(year)).sort().map(([day,name])=>day+' '+name).join('\n');
 confirmHolidayYear.checked=state.holidayYears?.[year]?!!state.holidayYears[year].confirmed:year===2026;
}
function readRosterSettings(){
 const offLimit=Number(document.getElementById('monthlyOffLimit').value);
 if(!Number.isInteger(offLimit)||offLimit<0||offLimit>getMonthDates().length)throw Error('월 기준 OFF는 0부터 해당 월 일수까지의 정수로 입력해주세요.');
 const settings=JSON.parse(JSON.stringify(ROSTER_DEFAULTS));
 for(const el of weekendSettings.querySelectorAll('input'))settings.weekend[el.dataset.role]=['HN','MD'].includes(el.dataset.role)?false:el.checked;
 for(const el of coverageSettings.querySelectorAll('input')){
   if(el.value===''||!el.checkValidity()||!Number.isInteger(Number(el.value)))throw Error('필요 인원은 0~30의 정수로 입력해주세요.');
   settings.coverage[el.dataset.kind][el.dataset.field]=Number(el.value);
 }
 const dates={},year=cursor.getFullYear();
 for(const line of holidayDates.value.split('\n').map(s=>s.trim()).filter(Boolean)){
   const match=line.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/);
   if(!match||!match[1].startsWith(year+'-')||!Number.isFinite(dayNumber(match[1]))||isoDay(dayNumber(match[1]))!==match[1])throw Error('공휴일은 해당 연도의 YYYY-MM-DD 이름 형식으로 입력해주세요.');
   dates[match[1]]=match[2]||'공휴일';
 }
 return {settings,offLimit,offMode:document.getElementById('offModeManual').checked?'manual':'calendar',calendar:{dates,confirmed:confirmHolidayYear.checked}};
}

function generateMonth(){
  const year=cursor.getFullYear();
  if(!(state.holidayYears[year]?state.holidayYears[year].confirmed:year===2026)){
    alert('편성 규칙에서 '+year+'년 공휴일 목록을 입력하고 확인해주세요.');return false;
  }
  if(!activeStaff().length){alert('이번 달 편성 인원을 선택해주세요.');return false}
  const errors=validateRules(state.rules||[]);if(errors.length){alert(errors.join('\n'));return false}
  return applyGeneratedMonth(solveMonth());
}
function applyGeneratedMonth(result){
  const next=JSON.parse(JSON.stringify(state)),shifts=state.generationSnapshot?.month===rosterMonth()?{...state.generationSnapshot.shifts}:{};
  for(const date of getMonthDates())for(const st of activeStaff()){const k=keyFor(date,st.id);shifts[k]=result.plan[k];next.assignments[k]=1;next.assignments[k+'_type']=shifts[k]}
  next.generationSnapshot={month:result.month,savedAt:new Date().toISOString(),shifts};
  try{localStorage.setItem(KEY,JSON.stringify(next))}catch(error){alert('저장 공간 또는 권한 문제로 생성 결과를 저장하지 못했습니다. 기존 근무표와 스냅샷을 유지합니다.');return false}
  state=next;render();
  const count=Object.keys(analyzeMonth()).length;
  alert(`${count?'조건 미충족 편성 결과':'자동 생성 완료'} · 이전 결과 대비 ${result.changes}칸 변경\n월 OFF 기준 초과 합계: ${result.unfilled}일\n${count?`확인 필요한 날짜 ${count}일을 옅은 붉은색으로 표시했습니다.\n원티드 직접 배정 또는 조건 조정 후 다시 생성해주세요. 사용자 지정도 위반 사유는 표시됩니다.`:'기본 편성 검사에서 부족·초과가 발견되지 않았습니다.'}\n최신 스냅샷 1개를 저장했습니다. 실제 근무·휴게시간, 주휴·야간근로 조건은 별도 확인이 필요합니다.`);
  return true;
}
function solveMonthInWorker(){
 if(typeof Worker==='undefined'||location.protocol==='file:')return Promise.resolve().then(()=>solveMonth());
 return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('nurse-scheduler-worker.js?v=20261002-rules5',document.baseURI));
   worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.result)};
   worker.onerror=()=>{worker.terminate();reject(new Error('자동생성 계산 파일을 읽지 못했습니다. 배포 폴더의 Worker/규칙/계산 파일을 확인해주세요.'))};
   worker.postMessage({state,year:cursor.getFullYear(),month:cursor.getMonth()});
 });
}
autoGenerate.onclick=async()=>{
 if(autoGenerate.disabled)return;
 if(!activeStaff().length){alert('이번 달 편성 인원을 선택해주세요.');return}
 const errors=validateRules(state.rules||[]);if(errors.length){alert(errors.join('\n'));return}
 const year=cursor.getFullYear();if(!(state.holidayYears[year]?state.holidayYears[year].confirmed:year===2026)){alert('편성 규칙에서 '+year+'년 공휴일 목록을 입력하고 확인해주세요.');return}
 if(!confirm('원티드·일반 수동 조정·휴가를 보호하고 새 편성 기준으로 생성할까요?\nRN/NK 월 N 횟수와 묶음·휴식은 추가 규칙을 적용합니다. D/E는 RN 고정 인원입니다. AN은 별도 인원입니다. 미충족 사유는 붉은색으로 표시합니다.'+(state.shiftTimesConfirmed?'':'\n근무시간은 예시입니다. 실제 시간 설정을 확인해주세요.')))return;
 const before=JSON.stringify(state),month=rosterMonth();
 autoGenerate.disabled=true;autoGenerate.textContent='편성 중…';
 try{
   const result=await solveMonthInWorker();
   if(month!==rosterMonth()||before!==JSON.stringify(state)){alert('계산 중 월 또는 입력 데이터가 바뀌어 생성 결과를 적용하지 않았습니다. 현재 입력을 유지하며 다시 생성해주세요.');return}
   applyGeneratedMonth(result);
 }catch(error){alert(error.message)}
 finally{autoGenerate.disabled=false;autoGenerate.textContent='자동 생성'}
};
function renderTimeSettings(){
  const times=state.shiftTimes||defaultShiftTimes;
  shiftTimeSettings.innerHTML=['D','E','N','M'].map(sh=>`<div class="time-setting"><b>${sh}</b><label>시작<input type="time" data-code="${sh}" data-field="start" value="${esc(times[sh].start)}"></label><label>종료<input type="time" data-code="${sh}" data-field="end" value="${esc(times[sh].end)}"></label><label>휴게(분)<input type="number" min="0" max="1440" data-code="${sh}" data-field="breakMinutes" value="${times[sh].breakMinutes}"></label></div>`).join('');
  confirmShiftTimes.checked=!!state.shiftTimesConfirmed;
}

render();

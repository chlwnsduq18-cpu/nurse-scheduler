
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
state.schemaVersion=9;
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
const hasWanted=k=>Object.prototype.hasOwnProperty.call(state.wanted,k);
function putAssignment(k,shift){state.assignments[k]=1;state.assignments[k+"_type"]=shift}
function setWanted(k,shift){
  delete state.leave[k];
  if(shift==='V'){state.leave[k]='vacation';shift='O'}
  state.wanted[k]=shift;putAssignment(k,shift);
}
function releaseWanted(k){
  delete state.leave[k];
  delete state.wanted[k];
  delete state.assignments[k];delete state.assignments[k+"_type"];
}
function removeRelated(predicate){
  Object.keys(state.assignments).forEach(k=>{if(predicate(k.endsWith("_type")?k.slice(0,-5):k))delete state.assignments[k]});
  Object.keys(state.wanted).forEach(k=>{if(predicate(k))delete state.wanted[k]});
  Object.keys(state.leave).forEach(k=>{if(predicate(k))delete state.leave[k]});
  if(state.generationSnapshot){
    Object.keys(state.generationSnapshot.shifts).forEach(k=>{if(predicate(k))delete state.generationSnapshot.shifts[k]});
    if(!Object.keys(state.generationSnapshot.shifts).length)state.generationSnapshot=null;
  }
}
const pad=n=>String(n).padStart(2,"0");
const keyFor=(d,id)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}:${id}`;

function render(){
  const issues=showValidation();
  const y=cursor.getFullYear(), m=cursor.getMonth();
  monthTitle.textContent=`${y}년 ${m+1}월`;
  staffList.innerHTML="";
  state.staff.forEach(s=>{
    const el=document.createElement("div"); el.className="staff"; el.draggable=true; el.dataset.id=s.id;
    el.innerHTML=`<div class="staff-info"><span class="dot"></span><div class="staff-main"><span class="staff-name">${esc(s.name)}</span><span class="staff-category" data-category="${esc(s.category||"RN")}">${esc(s.category||"RN")}</span></div></div><div><button class="del edit" title="정보 수정">정보</button><button class="del" title="삭제">×</button></div>`;
    el.addEventListener("dragstart",e=>e.dataTransfer.setData("staffId",s.id));
    el.querySelector(".edit").onclick=()=>openStaffModal(s.id);
    el.querySelector(".del:not(.edit)").onclick=()=>{
      if(confirm(`${s.name} 간호사를 삭제할까요?`)){
        state.staff=state.staff.filter(x=>x.id!==s.id);
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
    state.staff.forEach(s=>{
      const k=keyFor(d,s.id);
      const sh=state.assignments[k+"_type"]||"D";
      if(state.assignments[k] && sh!=="O") summary[sh]++;
    });
    cell.querySelectorAll("[data-summary]").forEach(el=>{el.textContent=summary[el.dataset.summary]||0});
    
    list.ondragover=e=>{e.preventDefault();dz.classList.add("over");list.classList.add("over")};
    list.ondragleave=e=>{if(!list.contains(e.relatedTarget)){list.classList.remove("over");if(!dz.matches(":hover"))dz.classList.remove("over")}};
    list.ondrop=e=>{e.preventDefault();e.stopPropagation();list.classList.remove("over");dz.classList.remove("over");moveAssignmentToDate(e,dateKey)};
    
    state.staff.forEach(s=>{
      const k=keyFor(d,s.id);
      if(state.assignments[k] && (state.assignments[k+"_type"]!=="O" || hasWanted(k))){
        const a=document.createElement("div");a.className="assignment";a.draggable=true;a.dataset.key=k;
        const shiftType=state.assignments[k+"_type"]||"D";
        const displayName=shortName(s.name);
        a.innerHTML=`<span class="assignment-name" title="${esc(s.name)}">${esc(displayName)}</span><button class="shift-badge shift-${isVacation(k)?'V':esc(shiftType)}" title="근무 형태 변경 · ${esc(s.name)}" aria-label="${esc(s.name)} 근무 형태 변경">${displayShift(k,shiftType)}${hasWanted(k)?" 🔒":""}</button><button class="remove-shift" title="지정 OFF로 변경" aria-label="${esc(s.name)} 지정 OFF로 변경">O</button>`;
        const shiftBtn=a.querySelector(".shift-badge");
        shiftBtn.onclick=e=>{e.stopPropagation();openShiftModal(k)};
        a.querySelector(".remove-shift").onclick=e=>{e.stopPropagation();setWanted(k,"O");save();render()};
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
    state.staff.forEach(st=>{
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

  state.staff.forEach(st=>{
    const counts={D:0,E:0,N:0,M:0,O:0};
    html+=`<tr><th class="staff-col" title="${esc(st.name)}">${esc(st.name)}</th><td class="category-col">${esc(st.category||"RN")}</td>`;
    dates.forEach(d=>{
      const sh=getAssignmentShift(d,st.id);
      counts[sh]=(counts[sh]||0)+1;
      const dk=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      html+=`<td class="shift-cell${issues[dk]?' needs-review':''}" data-date="${dk}" data-staff-id="${st.id}" title="${esc(st.name)} · ${dk} · ${sh} ${esc((issues[dk]||[]).join(' / '))}"><span class="table-shift shift-${isVacation(keyFor(d,st.id))?'V':sh}">${displayShift(keyFor(d,st.id),sh)}${hasWanted(keyFor(d,st.id))?'<small class="wanted-mark" title="사용자 지정">🔒</small>':""}</span></td>`;
    });
    html+=`<td class="total-col">D${counts.D} · E${counts.E} · N${counts.N} · M${counts.M} · O${counts.O}</td></tr>`;
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

function getDaysInMonth(y,m){return new Date(y,m+1,0).getDate()}
function shortName(name){
  const value=String(name||"").trim();
  return value.length<=3 ? value : value.slice(0,2)+"...";
}

function moveAssignmentToDate(e,dateKey){
  const staffId=Number(e.dataTransfer.getData("staffId"));
  const fromKey=e.dataTransfer.getData("assignmentKey");
  if(staffId){
    const newKey=`${dateKey}:${staffId}`;
    if(!state.assignments[newKey]){
      setWanted(newKey,"D");
      save(); render();
    }
    return;
  }
  if(fromKey){
    const parts=fromKey.split(":");
    const id=Number(parts[1]);
    const newKey=`${dateKey}:${id}`;
    if(fromKey===newKey)return;
    if(state.assignments[newKey]){
      alert("해당 날짜에 이미 같은 간호사가 배정되어 있습니다.");
      return;
    }
    const oldType=isVacation(fromKey)?"V":state.assignments[fromKey+"_type"]||"D";
    setWanted(fromKey,"O");
    setWanted(newKey,oldType);
    save();render();
  }
}

let assignmentShiftType="D";

function openAssignmentModal(dateKey, staffId=null){
  assignmentDateInput.value=dateKey;
  const parts=dateKey.split(":");
  const datePart=parts[0];
  const d=new Date(datePart+"T00:00:00");
  assignmentDateDisplay.value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  assignmentStaffInput.innerHTML="";
  state.staff.forEach(s=>{
    const option=document.createElement("option");
    option.value=s.id;
    option.textContent=s.name;
    assignmentStaffInput.appendChild(option);
  });

  let selectedId=staffId ? Number(staffId) : null;
  if(!selectedId && parts[1]) selectedId=Number(parts[1]);
  if(selectedId && state.staff.some(s=>s.id===selectedId)) assignmentStaffInput.value=selectedId;

  const currentKey=selectedId ? `${datePart}:${selectedId}` : "";
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
  assignmentShiftType=isVacation(currentKey)?"V":(currentKey && state.assignments[currentKey+"_type"]) || "D";
  document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(b=>{
    b.classList.toggle("active",b.dataset.shift===assignmentShiftType);
  });
}

document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(b=>{
  b.onclick=()=>{
    assignmentShiftType=b.dataset.shift;
    document.querySelectorAll("#assignmentShiftOptions .shift-option").forEach(x=>x.classList.toggle("active",x===b));
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
  if(!dateKey || !staffId)return;
  const key=`${dateKey}:${staffId}`;
  setWanted(key,assignmentShiftType);
  save();
  closeAssignmentModal();
  render();
};

let ruleDraft=[];
function renderRules(){
  ruleList.innerHTML="";
  if(!ruleDraft.length){
    ruleList.innerHTML='<div class="hint" style="padding:18px;text-align:center;border:1px dashed #dfe3e8;border-radius:8px">등록된 규칙이 없습니다.</div>';
    return;
  }
  ruleDraft.forEach((rule,i)=>{
    const row=document.createElement("div");
    row.className="rule-item";
    row.innerHTML=`
      <div class="rule-order">${i+1}</div>
      <select class="rule-type">
        <option value="minimum">근무별 최소 인원</option>
        <option value="maximum">근무별 최대 인원</option>
        <option value="maxConsecutive">최대 연속 근무일</option>
        <option value="nightRest">N 근무 후 최소 휴식일</option>
        <option value="weeklyOff">주간 최소 OFF 일수</option>
        <option value="preferred">선호 근무 우선</option>
      </select>
      <div class="rule-value-wrap"></div>
      <button class="rule-remove" title="규칙 삭제">×</button>`;
    const type=row.querySelector(".rule-type");
    const wrap=row.querySelector(".rule-value-wrap");
    type.value=rule.type;
    const buildValue=()=>{
      if(type.value==="minimum" || type.value==="maximum"){
        wrap.innerHTML=`<div style="display:grid;grid-template-columns:1fr 80px;gap:6px"><select class="rule-shift"><option>D</option><option>E</option><option>N</option><option>M</option></select><input class="rule-number" type="number" min="0" value="${esc(String(rule.value||0))}"></div>`;
        wrap.querySelector(".rule-shift").value=rule.shift||"D";
      }else if(type.value==="maxConsecutive" || type.value==="nightRest" || type.value==="weeklyOff"){
        const label=type.value==="maxConsecutive"?"연속":type.value==="nightRest"?"휴식":"OFF";
        wrap.innerHTML=`<div style="display:grid;grid-template-columns:1fr 80px;gap:6px"><span style="height:36px;display:flex;align-items:center;padding:0 9px;border:1px solid #e1e4e8;border-radius:7px;background:#f7f8fa;font-size:11px">${label}</span><input class="rule-number" type="number" min="0" value="${esc(String(rule.value||0))}"></div>`;
      }else{
        wrap.innerHTML=`<select class="rule-shift"><option>ALL</option><option>D</option><option>E</option><option>N</option><option>M</option></select>`;
        wrap.querySelector(".rule-shift").value=rule.shift||"ALL";
      }
      const numberInput=wrap.querySelector('.rule-number');
      const shiftInput=wrap.querySelector('.rule-shift');
      if(numberInput)numberInput.oninput=()=>{rule.value=numberInput.value};
      if(shiftInput)shiftInput.onchange=()=>{rule.shift=shiftInput.value};
    };
    buildValue();
    type.onchange=()=>{rule.type=type.value;buildValue()};
    row.querySelector(".rule-remove").onclick=()=>{ruleDraft.splice(i,1);renderRules()};
    ruleList.appendChild(row);
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
  const rows=[...ruleList.querySelectorAll(".rule-item")];
  if(rows.some(row=>{const n=row.querySelector('.rule-number');return n&&(!n.value||!n.checkValidity())})){
    alert('규칙 값은 0 이상의 정수로 입력해주세요.');return;
  }
  state.shiftTimes=shiftTimes;state.shiftTimesConfirmed=confirmShiftTimes.checked;
  state.rosterSettings=rosterDraft.settings;state.holidayYears[cursor.getFullYear()]=rosterDraft.calendar;
  state.rules=rows.map(row=>{
    const type=row.querySelector(".rule-type").value;
    const shiftEl=row.querySelector(".rule-shift");
    const numberEl=row.querySelector(".rule-number");
    return {type,shift:shiftEl ? shiftEl.value : (type==="nightRest"?"N":"ALL"),value:numberEl ? numberEl.value : ""};
  });
  save();
  closeRuleModal();render();
};

function getMonthDates(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),days=getDaysInMonth(y,m);
  return Array.from({length:days},(_,i)=>new Date(y,m,i+1));
}

exportExcel.onclick=()=>{
  if(typeof XLSX==="undefined"){
    alert("엑셀 모듈을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해주세요.");
    return;
  }
  const dates=getMonthDates();
  const y=cursor.getFullYear(),m=cursor.getMonth();
  const rows=[];
  const header=["간호사","분류","경력",...dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`)];
  rows.push(header);
  state.staff.forEach(s=>{
    const row=[s.name,s.category||"RN",s.career||0];
    dates.forEach(d=>{
      const k=keyFor(d,s.id);
      row.push(displayShift(k,state.assignments[k] ? (state.assignments[k+"_type"]||"D") : "O"));
    });
    rows.push(row);
  });

  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!freeze"]={xSplit:3,ySplit:1};
  ws["!cols"]=[
    {wch:12},{wch:8},{wch:7},
    ...dates.map(()=>({wch:5}))
  ];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,`${y}년 ${m+1}월`);
  const issues=Object.entries(analyzeMonth());
  if(issues.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['날짜','확인 사유'],...issues.map(([d,reasons])=>[d,reasons.join(' / ')])]),'편성 확인');
  XLSX.writeFile(wb,`간호사_근무표_${y}-${pad(m+1)}.xlsx`);
};

function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
add.onclick=()=>openStaffModal();
prev.onclick=()=>{cursor.setMonth(cursor.getMonth()-1);render()};
next.onclick=()=>{cursor.setMonth(cursor.getMonth()+1);render()};
clear.onclick=()=>{if(confirm("현재 월의 사용자 지정, 자동 배정 및 해당 월 스냅샷을 모두 지울까요?")){
  const prefix=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-`;
  removeRelated(k=>k.startsWith(prefix));save();render();
}};

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
    state.staff.push({id:Date.now(),...data});
  }
  save(); closeStaffModal(); render();
};

let editingAssignmentKey=null;
function openShiftModal(k){
  editingAssignmentKey=k;
  const parts=k.split(":");
  const s=state.staff.find(x=>x.id===Number(parts[1]));
  const current=isVacation(k)?"V":state.assignments[k+"_type"]||"D";
  shiftModal.classList.add("open");shiftModal.setAttribute("aria-hidden","false");
  shiftModalSubtitle.textContent=s ? `${s.name} · ${parts[0]} ${hasWanted(k)?"사용자 지정 · 자동 생성 시 보호":"자동 배정"} · 근무 형태를 변경합니다.` : "배정된 근무 형태를 변경합니다.";
  document.querySelectorAll("#shiftOptions .shift-option").forEach(b=>b.classList.toggle("active",b.dataset.shift===current));
}
function closeShiftModal(){shiftModal.classList.remove("open");shiftModal.setAttribute("aria-hidden","true");editingAssignmentKey=null}
const closeShiftModalButton=document.getElementById("closeShiftModal");
closeShiftModalButton.onclick=closeShiftModal;
shiftModal.addEventListener("click",e=>{if(e.target===shiftModal)closeShiftModal()});
document.querySelectorAll("#shiftOptions .shift-option").forEach(b=>b.onclick=()=>{if(!editingAssignmentKey)return;setWanted(editingAssignmentKey,b.dataset.shift);save();closeShiftModal();render()});
deleteAssignment.onclick=()=>{if(!editingAssignmentKey)return;releaseWanted(editingAssignmentKey);save();closeShiftModal();render()};

document.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  if(shiftModal.classList.contains("open")) closeShiftModal();
  else if(assignmentModal.classList.contains("open")) closeAssignmentModal();
  else if(ruleModal.classList.contains("open")) closeRuleModal();
  else if(staffModal.classList.contains("open")) closeStaffModal();
});

// Date-only arithmetic uses UTC, independent of DST. Week = Monday through Sunday.
const DAY_MS=86400000;
const dateStringCache=new Map();
const isoDay=n=>{if(!dateStringCache.has(n))dateStringCache.set(n,new Date(n*DAY_MS).toISOString().slice(0,10));return dateStringCache.get(n)};
const dayNumber=s=>Math.floor(Date.parse(s+'T00:00:00Z')/DAY_MS);
const work=sh=>!!sh && sh!=='O';
const defaultShiftTimes={D:{start:'07:00',end:'15:00',breakMinutes:30},E:{start:'15:00',end:'23:00',breakMinutes:30},N:{start:'23:00',end:'07:00',breakMinutes:30},M:{start:'09:00',end:'18:00',breakMinutes:60}};
function schedulerConfig(){
  const cfg={minimum:{D:0,E:0,N:0,M:0},maximum:{D:Infinity,E:Infinity,N:Infinity,M:Infinity},maxWeekly:5,maxConsecutive:5,nightRest:0,preferred:'ALL',minRestHours:11};
  const seen=new Set();
  for(const r of state.rules){
    const tag=r.type+(['minimum','maximum'].includes(r.type)?r.shift:'');
    if(seen.has(tag))continue;seen.add(tag);
    const v=Number(r.value);
    if(r.type==='preferred'){cfg.preferred=r.shift;continue}
    if(!Number.isFinite(v)||v<0)continue;
    if(r.type==='minimum' && r.shift in cfg.minimum)cfg.minimum[r.shift]=Math.max(cfg.minimum[r.shift],Math.floor(v));
    if(r.type==='maximum' && r.shift in cfg.maximum)cfg.maximum[r.shift]=Math.floor(v);
    if(r.type==='maxConsecutive')cfg.maxConsecutive=Math.max(0,Math.min(31,Math.floor(v)));
    if(r.type==='weeklyOff')cfg.maxWeekly=Math.max(0,Math.min(5,7-Math.floor(v)));
    if(r.type==='nightRest')cfg.nightRest=Math.min(31,Math.floor(v));
  }
  return cfg;
}
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
  Object.assign(p,state.wanted);return p;
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
 weekday:{D:2,E:2,N:2,AD:1,AE:1,AN:0},saturday:{D:2,E:1,N:1,AD:1,AE:1,AN:1},holiday:{D:1,E:1,N:2,AD:1,AE:1,AN:1}}};
function rosterSettings(){return state.rosterSettings||ROSTER_DEFAULTS}
function holidaysFor(year){return state.holidayYears?.[year]?.dates||(year===2026?HOLIDAYS_2026:{})}
function holidayName(n){return holidaysFor(new Date(n*DAY_MS).getUTCFullYear())[isoDay(n)]||''}
function dayKind(n){return holidayName(n)||new Date(n*DAY_MS).getUTCDay()===0?'holiday':new Date(n*DAY_MS).getUTCDay()===6?'saturday':'weekday'}
function isWeekend(n){return [0,6].includes(new Date(n*DAY_MS).getUTCDay())}
function isVacation(k){return state.leave?.[k]==='vacation'&&state.wanted[k]==='O'}
function displayShift(k,sh){return isVacation(k)?'휴가':sh}
function dayAllowed(st,n){
 const role=st.category||'RN';
 if(role==='MD'&&isWeekend(n))return false;
 if((role==='HN'||role==='MD')&&holidayName(n))return false;
 return !isWeekend(n)||rosterSettings().weekend[role]!==false;
}
function midDemand(n,cfg=schedulerConfig()){
 if(isWeekend(n))return {key:'M',shift:'M',roles:['AN'],min:Math.max(1,cfg.minimum.M),label:'M(주말 AN)'};
 return {key:'M',shift:'M',roles:['MD','RN'],min:holidayName(n)?0:Math.max(1,cfg.minimum.M),label:'M(평일 MD·RN 대체)'};
}
function allowedShifts(role){return role==='HN'?['D','O']:role==='MD'?['M','O']:role==='NK'?['N','O']:role==='RN'?['D','E','N','M','O']:['D','E','N','M','O']}
function countShift(plan,n,sh,roles=null){return state.staff.filter(st=>(!roles||roles.includes(st.category||'RN'))&&plan[isoDay(n)+':'+st.id]===sh).length}
function dayDemands(n,cfg=schedulerConfig()){
 const kind=dayKind(n),c=rosterSettings().coverage[kind];
 const night=Math.max(c.N,cfg.minimum.N);
 return [
 {key:'D',shift:'D',roles:kind==='weekday'?['HN','RN']:['RN'],min:Math.max(c.D,cfg.minimum.D),label:kind==='weekday'?'D(HN+RN)':'D(RN)'},
 {key:'E',shift:'E',roles:['RN'],min:Math.max(c.E,cfg.minimum.E),label:'E(RN)'},
 {key:'NK',shift:'N',roles:['NK'],min:Math.min(1,night),label:'N(NK)'},
 {key:'RN',shift:'N',roles:['RN'],min:Math.max(0,night-1),label:'N(RN)'},
 {key:'AD',shift:'D',roles:['AN'],min:c.AD,label:'D(AN)'},
 {key:'AE',shift:'E',roles:['AN'],min:c.AE,label:'E(AN)'},
 {key:'AN',shift:'N',roles:['AN'],min:c.AN,label:'N(AN)'},
 midDemand(n,cfg)
 ];
}
function weeklyWorkTarget(n,id,cfg){
 const st=state.staff.find(s=>s.id===id);let wantedOff=0,available=0;
 for(let d=weekStart(n);d<weekStart(n)+7;d++){
   const k=isoDay(d)+':'+id;
   if(state.wanted[k]==='O')wantedOff++;
   if(dayAllowed(st,d)&&state.wanted[k]!=='O')available++;
 }
 return Math.min(available,Math.max(0,cfg.maxWeekly-wantedOff));
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
 if(role==='AN'&&sh==='N'&&rosterSettings().coverage[dayKind(n)].AN===0)errors.push('AN N 대상일 아님');
 if(!shiftTiming(sh)?.valid)errors.push('실근로 8시간·휴게시간 설정 확인');
 let hours=0;for(let d=weekStart(n);d<weekStart(n)+7;d++)if(work(get(d)))hours+=shiftTiming(get(d))?.hours||0;
 const weekly=Array.from({length:7},(_,i)=>get(weekStart(n)+i)).filter(work).length;
 if(weekly>cfg.maxWeekly)errors.push(`주 ${cfg.maxWeekly}일 상한 초과`);
 else if(weekly>weeklyWorkTarget(n,id,cfg))errors.push('기본 OFF·원티드 OFF 부족');
 if(hours>40+1e-8)errors.push('주 40시간 상한 초과');
 let run=1;for(let d=n-1;d>=n-31&&work(get(d));d--)run++;for(let d=n+1;d<=n+31&&work(get(d));d++)run++;
 if(run>cfg.maxConsecutive)errors.push(`연속 ${cfg.maxConsecutive}일 상한 초과`);
 if(sh==='N'&&['RN','NK'].includes(role)){
   let nights=1;for(let d=n-1;d>=n-4&&get(d)==='N';d--)nights++;for(let d=n+1;d<=n+4&&get(d)==='N';d++)nights++;
   if(nights>3)errors.push('N 연속 3일 상한 초과');
 }
 for(const direction of [-1,1])for(let delta=1;delta<=32;delta++){
   const other=get(n+direction*delta);if(!work(other))continue;
   const left=direction<0?other:sh,right=direction<0?sh:other,leftDay=direction<0?n-delta:n;
   const lt=shiftTiming(left),rt=shiftTiming(right);
   if(lt&&rt&&delta*1440+rt.start-lt.end<cfg.minRestHours*60)errors.push('근무 사이 11시간 휴식 부족');
   const protectedNight=role==='RN'||role==='NK'||(role==='AN'&&(isWeekend(leftDay)||holidayName(leftDay)));
   if(left==='N'&&!(right==='N'&&delta===1)&&delta-1<Math.max(cfg.nightRest,protectedNight?2:0))errors.push('N 종료 후 최소 2일 OFF 부족');
   break;
 }
 return [...new Set(errors)];
}
function canPlace(plan,n,st,sh,cfg){
 const k=isoDay(n)+':'+st.id,role=st.category||'RN';
 if(hasWanted(k)||work(plan[k])||!dayAllowed(st,n))return false;
 if(weeklyWorked(plan,n,st.id)>=weeklyWorkTarget(n,st.id,cfg))return false;
 const pool=role==='AN'?['AN']:['HN','RN','NK','MD'];
 if(countShift(plan,n,sh,pool)>=cfg.maximum[sh])return false;
 if(sh==='N'){
   const demand=dayDemands(n,cfg).find(d=>d.shift==='N'&&d.roles.includes(role));
   if(!demand||countShift(plan,n,'N',demand.roles)>=demand.min)return false;
 }
 if(sh==='M'){
   const demand=midDemand(n,cfg);
   if(!demand.roles.includes(role)||demand.min===0)return false;
   if(role!=='MD'&&countShift(plan,n,'M',demand.roles)>=demand.min)return false;
 }
 return staffProblems(plan,n,st,sh,cfg).length===0;
}
function workTargetGaps(plan,cfg=schedulerConfig()){
 const dates=getMonthDates().map(d=>dayNumber(keyFor(d,0).split(':')[0])),inMonth=new Set(dates),gaps=[];
 for(const monday of [...new Set(dates.map(weekStart))])for(const st of state.staff){
   if(st.category==='NK')continue; // NK has a monthly half-roster target, not five days every week.
   let actual=0,eligible=0,outside=0;
   for(let d=monday;d<monday+7;d++){
     const k=isoDay(d)+':'+st.id;
     if(inMonth.has(d)){if(work(plan[k]))actual++;if(dayAllowed(st,d)&&state.wanted[k]!=='O')eligible++}
     else if(work(plan[k]))outside++;
   }
   const target=Math.min(eligible,Math.max(0,weeklyWorkTarget(monday,st.id,cfg)-outside));
   if(actual<target)gaps.push({name:st.name,id:st.id,monday,target,actual,missing:target-actual,freeDates:dates.filter(d=>weekStart(d)===monday&&dayAllowed(st,d)&&!hasWanted(isoDay(d)+':'+st.id)&&!work(plan[isoDay(d)+':'+st.id]))});
 }
 return gaps;
}
function nkBalance(plan){
 const dates=getMonthDates(),nk=state.staff.filter(s=>s.category==='NK');
 const counts=nk.map(s=>dates.filter(d=>plan[keyFor(d,s.id)]==='N').length);
 return {nk,counts,penalty:nk.length===2?counts.reduce((sum,c)=>sum+Math.max(0,Math.floor(dates.length/2)-c,c-Math.ceil(dates.length/2)),0):0};
}
function analyzeMonth(plan=currentPlan()){
 const cfg=schedulerConfig(),issues={},dates=getMonthDates(),start=dayNumber(keyFor(dates[0],0).split(':')[0]),end=start+dates.length-1;
 const add=(n,msg)=>{if(n<start||n>end)return;const dk=isoDay(n);(issues[dk]??=[]).push(msg)};
 for(let n=start;n<=end;n++){
   for(const d of dayDemands(n,cfg)){
     const count=countShift(plan,n,d.shift,d.roles);
     if(count<d.min)add(n,`${d.label} ${d.min-count}명 부족 · 원티드/규칙 확인`);
     if(d.shift==='N'&&count>d.min)add(n,`${d.label} 정원 ${d.min}명 초과`);
   }
   for(const sh of ['D','E','N','M'])for(const pool of [['HN','RN','NK','MD'],['AN']])if(countShift(plan,n,sh,pool)>cfg.maximum[sh])add(n,`${pool[0]==='AN'?'AN':'간호사'} ${sh} 최대 인원 초과`);
   for(const st of state.staff){
     const k=isoDay(n)+':'+st.id,sh=plan[k],role=st.category||'RN';
     for(const e of staffProblems(plan,n,st,sh,cfg))add(n,`${st.name}: ${e}${hasWanted(k)?' (사용자 지정 유지)':''}`);
     if(sh==='O'&&role==='NK'){
       let off=1;
       for(let d=n-1;d>=n-4&&plan[isoDay(d)+':'+st.id]==='O';d--)off++;
       for(let d=n+1;d<=n+4&&plan[isoDay(d)+':'+st.id]==='O';d++)off++;
       if(off>3)add(n,`${st.name}: NK 연속 OFF 3일 초과${hasWanted(k)?' (사용자 지정 유지)':''}`);
     }
     if(sh==='N'&&['RN','NK'].includes(role)){
       const block=nightRun(plan,n,st.id);
       if(block.length<2)add(n,`${st.name}: N은 2~3일 묶음 필요${n===start||n===end?' · 인접 월 확인':''}`);
       if(role==='NK'&&n===block.b){
         let next=n+1;while(next<=end&&plan[isoDay(next)+':'+st.id]!=='N')next++;
         if(next<=end&&next-n-1>3)add(n,`${st.name}: NK OFF 3일 초과 · 원티드/교대 확인`);
       }
     }
   }
 }
 for(const g of workTargetGaps(plan,cfg))for(const n of (g.freeDates.length?g.freeDates:[Math.max(start,g.monday)]))add(n,`${g.name}: 주간 목표 ${g.target}일 중 ${g.actual}일 · ${g.missing}일 추가 편성 필요`);
 const balance=nkBalance(plan);
 if(balance.nk.length!==2)add(start,`NK ${balance.nk.length}명 등록됨 · 기본 교대는 NK 2명 기준`);
 if(balance.penalty)add(start,`NK 월간 절반 분담 미충족: ${balance.nk.map((s,i)=>s.name+' '+balance.counts[i]+'일').join(', ')}`);
 return issues;
}
function showValidation(){
 const issues=analyzeMonth(),entries=Object.entries(issues),year=cursor.getFullYear();
 const known=state.holidayYears?.[year]?state.holidayYears[year].confirmed:year===2026;
 generationStatus.innerHTML=`<div>간호사/AN 별도 인원 · 공휴일 우선 · 주말 설정: 편성 규칙 · <span class="vacation-legend">휴가</span>${!known?' · ⚠ 이 연도 공휴일 입력·확인이 필요합니다.':''}${!state.shiftTimesConfirmed?' · 근무시간은 예시입니다.':''}</div><details><summary>${entries.length?`⚠ 확인 필요 ${entries.length}일 — 사유 보기`:'기본 편성 검사에서 부족·초과 없음'}</summary>${entries.map(([dk,msg])=>`<div><b>${dk}</b> ${esc(msg.join(' / '))}</div>`).join('')}</details>`;
 return issues;
}
// Two NK workers alternate complete 2/3-day blocks, with floor/ceil(month/2) targets.
function nkTemplate(days,attempt){
 const targets=attempt%2?[Math.ceil(days/2),Math.floor(days/2)]:[Math.floor(days/2),Math.ceil(days/2)];
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
 for(let n=a;n<a+len;n++)if(staffProblems(trial,n,st,'N',cfg).length)return null;
 return trial;
}
// Repair surplus D/E/M placements without disturbing night blocks or daily coverage.
function repairDayTargets(plan,cfg,dates){
 for(let pass=0;pass<16;pass++){
   const gaps=workTargetGaps(plan,cfg),before=gaps.reduce((sum,g)=>sum+g.missing,0);if(!before)break;
   let changed=false;
   outer:for(const g of gaps){
     const st=state.staff.find(s=>s.id===g.id),shifts=allowedShifts(st.category).filter(sh=>work(sh)&&sh!=='N');
     for(const n of g.freeDates)for(const r of dates.filter(d=>Math.abs(n-d)<=7)){
       const rk=isoDay(r)+':'+st.id,old=plan[rk];if(!work(old)||old==='N'||hasWanted(rk))continue;
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
function solveMonth(){
 const cfg=schedulerConfig(),dates=getMonthDates().map(d=>dayNumber(keyFor(d,0).split(':')[0])),start=dates[0],end=dates.at(-1),month=isoDay(start).slice(0,7);
 const current=currentPlan(),baseline={},fixed={};
 for(const [k,v]of Object.entries(current))if(!k.startsWith(month+'-'))fixed[k]=v;
 Object.assign(fixed,state.wanted);
 for(const n of dates)for(const st of state.staff){const k=isoDay(n)+':'+st.id;baseline[k]=state.generationSnapshot?.month===month?state.generationSnapshot.shifts[k]??current[k]:current[k]}
 const nk=state.staff.filter(s=>s.category==='NK');let best=null;
 for(let attempt=0;attempt<36;attempt++){
   let plan={...fixed},seed=731+attempt*7919;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
   // Keep previous valid night blocks first on one third of attempts.
   if(attempt%3===0)for(const st of state.staff)for(const n of dates){
     if(baseline[isoDay(n)+':'+st.id]!=='N'||baseline[isoDay(n-1)+':'+st.id]==='N')continue;
     let len=1;while(n+len<=end&&baseline[isoDay(n+len)+':'+st.id]==='N')len++;
     if(len>=2&&len<=3||st.category==='AN'&&len===1){const trial=addNightBlock(plan,st,n,len,cfg,start,end);if(trial)plan=trial}
   }
   if(nk.length===2){let n=start;for(const block of nkTemplate(dates.length,attempt)){
     const trial=addNightBlock(plan,nk[block.who],n,block.len,cfg,start,end);if(trial)plan=trial;n+=block.len;
   }}
   // Fill night demand with whole blocks; all two-day post-night rest checks include future wanteds.
   for(const n of dates)for(const demand of dayDemands(n,cfg).filter(d=>d.shift==='N')){
     while(countShift(plan,n,'N',demand.roles)<demand.min){
       const options=[];
       for(const st of state.staff.filter(s=>demand.roles.includes(s.category||'RN'))){
         for(const len of (st.category==='AN'?[1,2,3]:[2,3]))for(let offset=0;offset<len;offset++){
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
           options.push({trial,score:stranded*100-gain*20+changes*3+total+random()*5});
         }
       }
       if(!options.length)break;options.sort((a,b)=>a.score-b.score);plan=options[0].trial;
     }
   }
   // HN and MD planned work, then preserve feasible existing day/evening shifts.
   for(const st of state.staff.filter(s=>['HN','MD'].includes(s.category)))for(const n of dates){const sh=st.category==='HN'?'D':'M';if(canPlace(plan,n,st,sh,cfg))plan[isoDay(n)+':'+st.id]=sh}
   if(attempt%3===0)for(const n of dates)for(const st of state.staff){const k=isoDay(n)+':'+st.id,sh=baseline[k];if(work(sh)&&sh!=='N'&&canPlace(plan,n,st,sh,cfg))plan[k]=sh}
   for(const n of dates)for(const d of dayDemands(n,cfg).filter(d=>d.shift!=='N').sort((a,b)=>Number(b.shift==='M')-Number(a.shift==='M'))){
     while(countShift(plan,n,d.shift,d.roles)<d.min){
       const options=state.staff.filter(st=>d.roles.includes(st.category||'RN')&&canPlace(plan,n,st,d.shift,cfg)).map(st=>{
         const k=isoDay(n)+':'+st.id,prev=plan[isoDay(n-1)+':'+st.id];
         return {st,score:(baseline[k]===d.shift?-20:0)+(prev===d.shift?-4:0)+weeklyWorked(plan,n,st.id)*2+random()*8};
       }).sort((a,b)=>a.score-b.score);
       if(!options.length)break;plan[isoDay(n)+':'+options[0].st.id]=d.shift;
     }
   }
   // Minimize unnecessary OFF without introducing surplus N or substituting AN for nurses.
   for(const st of state.staff.filter(s=>s.category!=='NK'))for(let loop=0;loop<dates.length;loop++){
     const options=[];for(const n of dates)for(const sh of allowedShifts(st.category||'RN').filter(s=>work(s)&&s!=='N')){
       if(!canPlace(plan,n,st,sh,cfg))continue;const k=isoDay(n)+':'+st.id;
       options.push({k,sh,score:(baseline[k]===sh?-20:0)+(plan[isoDay(n-1)+':'+st.id]===sh?-4:0)+countShift(plan,n,sh,[st.category])*2+random()*6});
     }
     if(!options.length)break;options.sort((a,b)=>a.score-b.score);plan[options[0].k]=options[0].sh;
   }
   repairDayTargets(plan,cfg,dates);
   let missing=0,changes=0;
   for(const n of dates){for(const d of dayDemands(n,cfg))missing+=Math.max(0,d.min-countShift(plan,n,d.shift,d.roles));for(const st of state.staff){const k=isoDay(n)+':'+st.id;plan[k]??='O';if(baseline[k]!==undefined&&baseline[k]!==plan[k])changes++}}
   const unfilled=workTargetGaps(plan,cfg).reduce((s,g)=>s+g.missing,0),balance=nkBalance(plan).penalty,score=[missing,balance,unfilled,changes];
   const better=!best||score.some((v,i)=>v<best.score[i]&&score.slice(0,i).every((x,j)=>x===best.score[j]));
   if(better)best={plan,missing,changes,unfilled,month,score};
   if(score.every(v=>v===0))break;
 }
 return best;
}
function renderRosterSettings(){
 const settings=rosterSettings();
 weekendSettings.innerHTML=['HN','RN','MD','NK','AN'].map(role=>`<label><input type="checkbox" data-role="${role}" ${role!=='MD'&&settings.weekend[role]?'checked':''} ${role==='MD'?'disabled':''}> ${role} ${role==='MD'?'주말 OFF (고정)':'주말 근무 가능'}</label>`).join('');
 coverageSettings.innerHTML='<table class="coverage-editor"><thead><tr><th>날짜</th><th>D 간호사</th><th>E RN</th><th>N 총원</th><th>D AN</th><th>E AN</th><th>N AN</th></tr></thead><tbody>'+Object.entries(settings.coverage).map(([kind,row])=>`<tr><th>${{weekday:'평일',saturday:'토요일',holiday:'일요일·공휴일'}[kind]}</th>${['D','E','N','AD','AE','AN'].map(key=>`<td><input type="number" min="0" max="30" step="1" data-kind="${kind}" data-field="${key}" value="${row[key]}" aria-label="${kind} ${key}"></td>`).join('')}</tr>`).join('')+'</tbody></table>';
 const year=cursor.getFullYear();holidayYearLabel.textContent=year+'년 공휴일';
 holidayDates.value=Object.entries(holidaysFor(year)).sort().map(([day,name])=>day+' '+name).join('\n');
 confirmHolidayYear.checked=state.holidayYears?.[year]?!!state.holidayYears[year].confirmed:year===2026;
}
function readRosterSettings(){
 const settings=JSON.parse(JSON.stringify(ROSTER_DEFAULTS));
 for(const el of weekendSettings.querySelectorAll('input'))settings.weekend[el.dataset.role]=el.dataset.role==='MD'?false:el.checked;
 for(const el of coverageSettings.querySelectorAll('input')){
   if(el.value===''||!el.checkValidity())throw Error('필요 인원은 0~30의 정수로 입력해주세요.');
   settings.coverage[el.dataset.kind][el.dataset.field]=Number(el.value);
 }
 const dates={},year=cursor.getFullYear();
 for(const line of holidayDates.value.split('\n').map(s=>s.trim()).filter(Boolean)){
   const match=line.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/);
   if(!match||!match[1].startsWith(year+'-')||!Number.isFinite(dayNumber(match[1]))||isoDay(dayNumber(match[1]))!==match[1])throw Error('공휴일은 해당 연도의 YYYY-MM-DD 이름 형식으로 입력해주세요.');
   dates[match[1]]=match[2]||'공휴일';
 }
 return {settings,calendar:{dates,confirmed:confirmHolidayYear.checked}};
}

function generateMonth(){
  const year=cursor.getFullYear();
  if(!(state.holidayYears[year]?state.holidayYears[year].confirmed:year===2026)){
    alert('편성 규칙에서 '+year+'년 공휴일 목록을 입력하고 확인해주세요.');return false;
  }
  const result=solveMonth(),next=JSON.parse(JSON.stringify(state)),shifts={};
  for(const date of getMonthDates())for(const st of state.staff){const k=keyFor(date,st.id);shifts[k]=result.plan[k];next.assignments[k]=1;next.assignments[k+'_type']=shifts[k]}
  next.generationSnapshot={month:result.month,savedAt:new Date().toISOString(),shifts};
  try{localStorage.setItem(KEY,JSON.stringify(next))}catch(error){alert('저장 공간 또는 권한 문제로 생성 결과를 저장하지 못했습니다. 기존 근무표와 스냅샷을 유지합니다.');return false}
  state=next;render();
  const count=Object.keys(analyzeMonth()).length;
  alert(`자동 생성 완료 · 이전 결과 대비 ${result.changes}칸 변경\n개인별 근무 목표 미충족: ${result.unfilled}일\n${count?`확인 필요한 날짜 ${count}일을 옅은 붉은색으로 표시했습니다.\n원티드 직접 배정 또는 조건 조정 후 다시 생성해주세요. 사용자 지정도 위반 사유는 표시됩니다.`:'기본 편성 검사에서 부족·초과가 발견되지 않았습니다.'}\n최신 스냅샷 1개를 저장했습니다. 실제 근무·휴게시간, 주휴·야간근로 조건은 별도 확인이 필요합니다.`);
  return true;
}
autoGenerate.onclick=()=>{
  if(!state.staff.length){alert('먼저 간호사를 등록해주세요.');return}
  if(!confirm('사용자 지정·휴가를 보호하고 직군별/요일별 인원과 N 묶음 규칙으로 생성할까요?\nNK는 월 절반씩 교대, RN은 N 2~3일 뒤 OFF 2일을 적용합니다. AN은 별도 인원입니다. 충족하지 못한 날짜는 붉은색으로 표시합니다.'+(state.shiftTimesConfirmed?'':'\n주의: 시간 설정이 아직 예시입니다. 실제 운영 전에 편성 규칙에서 확인해주세요.')))return;
  autoGenerate.disabled=true;autoGenerate.textContent='편성 중…';
  setTimeout(()=>{try{generateMonth()}finally{autoGenerate.disabled=false;autoGenerate.textContent='자동 생성'}},30);
};
function renderTimeSettings(){
  const times=state.shiftTimes||defaultShiftTimes;
  shiftTimeSettings.innerHTML=['D','E','N','M'].map(sh=>`<div class="time-setting"><b>${sh}</b><label>시작<input type="time" data-code="${sh}" data-field="start" value="${esc(times[sh].start)}"></label><label>종료<input type="time" data-code="${sh}" data-field="end" value="${esc(times[sh].end)}"></label><label>휴게(분)<input type="number" min="0" max="1440" data-code="${sh}" data-field="breakMinutes" value="${times[sh].breakMinutes}"></label></div>`).join('');
  confirmShiftTimes.checked=!!state.shiftTimesConfirmed;
}

render();

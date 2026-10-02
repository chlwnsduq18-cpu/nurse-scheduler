// Read-only roster helpers shared by the page and generation Worker.
const pad=n=>String(n).padStart(2,"0");
const keyFor=(d,id)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}:${id}`;

function rosterMonth(){return `${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`}
function monthStaffIds(month=rosterMonth()){
  const previous=Object.keys(state.monthStaff).filter(k=>k<month).sort().at(-1);
  return state.monthStaff[month]??(previous?state.monthStaff[previous]:state.staff.map(st=>st.id));
}
function activeStaff(month=rosterMonth()){
  const ids=new Set(monthStaffIds(month));return state.staff.filter(st=>ids.has(st.id));
}

function getMonthDates(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),days=getDaysInMonth(y,m);
  return Array.from({length:days},(_,i)=>new Date(y,m,i+1));
}


const hasWanted=k=>Object.prototype.hasOwnProperty.call(state.wanted,k);

function hasManual(k){return Object.hasOwn(state.manual||{},k)}

function hasFixed(k){return hasWanted(k)||hasManual(k)}

function fixedShift(k){return state.wanted[k]??state.manual?.[k]}

function getDaysInMonth(y,m){return new Date(y,m+1,0).getDate()}

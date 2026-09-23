/* Hospital-template XLSX export. JSZip is bundled locally; no server is used.
 * Only the variable staff block, calendar, totals and print extent are changed.
 * Original cell styles, column widths, heading merges and approval boxes survive.
 */
(function (root) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const roles = ['HN', 'RN', 'MD', 'NK'];
  const colors = {D:'EAF0FF', E:'FFF1DF', N:'F1E8FA', M:'E1F3EE', O:'F0F1F3', OFF:'F0F1F3', '휴가':'FBE4ED'};
  const children = (node, name) => Array.from(node.childNodes).filter(n => n.nodeType === 1 && (!name || n.localName === name));
  const first = (node, name) => children(node, name)[0];
  const all = (node, name) => Array.from(node.getElementsByTagNameNS(NS, name));
  const el = (doc, name, attrs = {}) => {
    const node = doc.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k, String(v)));
    return node;
  };
  function xml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('템플릿의 XML 구조를 읽을 수 없습니다.');
    return doc;
  }
  const serialize = doc => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + new XMLSerializer().serializeToString(doc.documentElement);
  const escape = text => String(text).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  function column(n) { let s = ''; for (; n; n = Math.floor((n-1)/26)) s = String.fromCharCode(65+(n-1)%26)+s; return s; }
  function colNumber(ref) { return (ref.match(/[A-Z]+/) || [''])[0].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0); }
  const rowNumber = ref => Number(ref.match(/\d+$/)?.[0]);
  function resolvePath(from, target) {
    const bits = target.startsWith('/') ? [] : from.split('/').slice(0,-1);
    for (const part of target.split('/')) { if(part === '..') bits.pop(); else if(part && part !== '.') bits.push(part); }
    return bits.join('/');
  }
  async function read(zip, path) {
    const file = zip.file(path);
    if (!file) throw new Error('템플릿 필수 구성요소가 없습니다: '+path);
    return file.async('string');
  }
  function clear(cell) {
    children(cell).filter(n=>['v','f','is'].includes(n.localName)).forEach(n=>cell.removeChild(n));
    cell.removeAttribute('t');
  }
  function write(cell, value) {
    clear(cell);
    if (value === '' || value == null) return;
    const doc = cell.ownerDocument;
    if (typeof value === 'number') { const v=el(doc,'v');v.textContent=String(value);cell.appendChild(v); }
    else { cell.setAttribute('t','inlineStr');const is=el(doc,'is'),t=el(doc,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value);is.appendChild(t);cell.appendChild(is); }
  }
  function formula(cell, text, cached) {
    clear(cell);const f=el(cell.ownerDocument,'f');f.textContent=text;cell.appendChild(f);
    if(cached != null) { const v=el(cell.ownerDocument,'v');v.textContent=String(cached);cell.appendChild(v); }
  }
  function textOf(cell, strings) {
    if (!cell) return '';
    if(cell.getAttribute('t')==='s') return strings[Number(first(cell,'v')?.textContent)] || '';
    if(cell.getAttribute('t')==='inlineStr') return all(cell,'t').map(n=>n.textContent).join('');
    return first(cell,'v')?.textContent || '';
  }
  function putOrdered(parent, node, order) {
    const index=order.indexOf(node.localName);
    const next=children(parent).find(n=>order.indexOf(n.localName)>index);
    parent.insertBefore(node,next || null);
  }
  const sheetOrder=['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];

  async function build(template, options) {
    if (!root.JSZip) throw new Error('엑셀 압축 모듈을 불러오지 못했습니다.');
    const {year, month} = options;
    if(!Number.isInteger(year)||year<1900||year>9998||!Number.isInteger(month)||month<1||month>12) throw new Error('출력 연월이 올바르지 않습니다.');
    const days = new Date(Date.UTC(year,month,0)).getUTCDate();
    const staff = (options.staff || []).filter(s=>String(s.category).trim()!=='린넨');
    if(!staff.length) throw new Error('출력할 직원을 먼저 등록해주세요.');
    for(const s of staff) {
      if(![...roles,'AN'].includes(s.category)) throw new Error('출력할 수 없는 직책입니다: '+s.category);
      if(!s.name || !Array.isArray(s.shifts) || s.shifts.length!==days) throw new Error('직원 또는 월별 근무 데이터가 올바르지 않습니다.');
      if(s.shifts.some(v=>!Object.hasOwn(colors,v))) throw new Error(s.name+'의 근무 기호를 확인해주세요.');
    }
    const nurses=roles.flatMap(role=>staff.filter(s=>s.category===role)),assistants=staff.filter(s=>s.category==='AN');
    const extra = Number.isInteger(options.spareRows) ? Math.max(0,Math.min(3,options.spareRows)) : 1;
    // No empty nurse/AN section when that group has no members.
    let nurseSlots=nurses.length+(nurses.length?extra:0),assistantSlots=assistants.length+(assistants.length?extra:0);
    const zip=await root.JSZip.loadAsync(template);
    const wb=xml(await read(zip,'xl/workbook.xml')),rels=xml(await read(zip,'xl/_rels/workbook.xml.rels'));
    const strings=zip.file('xl/sharedStrings.xml')?all(xml(await read(zip,'xl/sharedStrings.xml')),'si').map(n=>all(n,'t').map(t=>t.textContent).join('')):[];
    const sheets=all(wb,'sheet');
    // A template with multiple months uses its leftmost ordinary roster sheet.
    const selected=sheets.find(s=>!s.getAttribute('name').includes('정기')) || sheets[0];
    if(!selected) throw new Error('템플릿에 근무표 시트가 없습니다.');
    const id=selected.getAttributeNS(REL,'id');
    const relationship=children(rels.documentElement).find(n=>n.getAttribute('Id')===id);
    if(!relationship) throw new Error('템플릿 시트 연결 정보를 확인해주세요.');
    const sourcePath=resolvePath('xl/workbook.xml',relationship.getAttribute('Target'));
    const sheet=xml(await read(zip,sourcePath)),sheetRoot=sheet.documentElement;
    if(['drawing','tableParts','oleObjects'].some(n=>all(sheet,n).length)) throw new Error('이 템플릿의 도형 또는 표 개체는 지원하지 않습니다. 원본 근무표 양식을 사용해주세요.');
    const styleRel=children(rels.documentElement).find(n=>n.getAttribute('Type').endsWith('/styles'));
    const styles=xml(await read(zip,styleRel?resolvePath('xl/workbook.xml',styleRel.getAttribute('Target')):'xl/styles.xml'));
    const styleRoot=styles.documentElement,xfs=first(styleRoot,'cellXfs'),borders=first(styleRoot,'borders');
    const data=first(sheetRoot,'sheetData'),originalRows=new Map(children(data,'row').map(r=>[Number(r.getAttribute('r')),r.cloneNode(true)]));
    const originalCell=(r,c)=>children(originalRows.get(r) || el(sheet,'row'),'c').find(n=>n.getAttribute('r')===column(c)+r);
    const value=(r,c)=>textOf(originalCell(r,c),strings).trim();
    if(value(7,4)!=='1'||value(7,5)!=='2'||!originalRows.has(9)) throw new Error('템플릿 구조가 다릅니다. 날짜는 D7부터, 직원은 9행부터 시작하는 원본 양식이 필요합니다.');
    // Some cleared templates also have blank E/N/M labels. The first D total row
    // and its three following rows still locate the fixed four-row totals block.
    const summaryStart=Array.from(originalRows.keys()).find(r=>r>9&&value(r,3)==='D'&&[1,2,3].every(i=>originalRows.has(r+i)));
    if(!summaryStart) throw new Error('D/E/N/M 집계 행을 찾지 못했습니다. 원본의 일반 근무표 시트를 사용해주세요.');
    const oldStaffEnd=summaryStart-2; // original: one spacer row before daily totals
    const borderOf=cell=>children(borders)[Number(children(xfs)[Number(cell?.getAttribute('s')||0)]?.getAttribute('borderId')||0)];
    const doubleBottom=r=>[3,4,5].some(c=>first(borderOf(originalCell(r,c)),'bottom')?.getAttribute('style')==='double');
    const boundary=Array.from(originalRows.keys()).find(r=>r>=9&&r<oldStaffEnd&&doubleBottom(r));
    if(!boundary) throw new Error('간호사·비간호사 사이의 이중선을 찾지 못했습니다. 직책 글자만 지우고 테두리는 유지해주세요.');
    let widthEnd=34;
    for(let c=35;c<=60;c++)if(value(7,c)||value(8,c))widthEnd=c;
    if(widthEnd<40) throw new Error('원본의 우측 집계·기록란이 없습니다.');
    // Keep existing A4 geometry. Above the original capacity, remove spare rows first.
    const hasLinenRow=value(oldStaffEnd,2)==='린넨'||value(oldStaffEnd,39)==='X'||value(oldStaffEnd,40)==='X';
    const capacity=oldStaffEnd-8-(hasLinenRow?1:0);
    if(nurseSlots+assistantSlots>capacity) {nurseSlots=nurses.length;assistantSlots=assistants.length;}
    const start=9,end=start+nurseSlots+assistantSlots-1,delta=end-oldStaffEnd;
    const totals=summaryStart+delta,lastRow=totals+3;
    const block=[...nurses,...Array(nurseSlots-nurses.length).fill(null),...assistants,...Array(assistantSlots-assistants.length).fill(null)];
    const rowNodes=new Map();
    const cloneRow=(source,newIndex)=>{
      const node=(originalRows.get(source)||el(sheet,'row',{ht:24,customHeight:1})).cloneNode(true);
      node.setAttribute('r',newIndex);node.removeAttribute('spans');
      for(const cell of children(node,'c')) {
        const c=colNumber(cell.getAttribute('r'));
        if(c>widthEnd) {node.removeChild(cell);continue;}
        cell.setAttribute('r',column(c)+newIndex);
        // Inline strings avoid carrying any old personal data in sharedStrings.xml.
        if(cell.getAttribute('t')==='s')write(cell,textOf(cell,strings));
      }
      rowNodes.set(newIndex,node);return node;
    };
    while(data.firstChild)data.removeChild(data.firstChild);
    for(let r=1;r<start;r++)if(originalRows.has(r))data.appendChild(cloneRow(r,r));
    // Use a normal interior row; move the double border independently of role text.
    block.forEach((person,i)=>{
      const r=start+i,source=i<nurseSlots?10:Math.min(boundary+2,oldStaffEnd-1),node=cloneRow(source,r);
      for(const cell of children(node,'c'))clear(cell);
      data.appendChild(node);
    });
    for(let r=oldStaffEnd+1;r<=summaryStart+3;r++)data.appendChild(cloneRow(r,r+delta));
    const cellAt=(r,c)=>{
      const row=rowNodes.get(r);if(!row)throw new Error('템플릿 행 생성 오류');
      const addr=column(c)+r;let cell=children(row,'c').find(n=>n.getAttribute('r')===addr);
      if(!cell) {cell=el(sheet,'c',{r:addr});row.insertBefore(cell,children(row,'c').find(n=>colNumber(n.getAttribute('r'))>c)||null);}
      return cell;
    };
    const styleCache=new Map();
    function styled(cell, changes) {
      const base=Number(cell.getAttribute('s')||0),key=base+JSON.stringify(changes);
      if(styleCache.has(key)) {cell.setAttribute('s',styleCache.get(key));return;}
      const xf=children(xfs)[base].cloneNode(true);
      if(changes.borderBottom) {
        const border=children(borders)[Number(xf.getAttribute('borderId')||0)].cloneNode(true);
        const bottom=first(border,'bottom')||el(styles,'bottom');bottom.setAttribute('style',changes.borderBottom);
        if(!bottom.parentNode)border.appendChild(bottom);
        borders.appendChild(border);borders.setAttribute('count',children(borders).length);
        xf.setAttribute('borderId',children(borders).length-1);xf.setAttribute('applyBorder','1');
      }
      if(changes.fillId!=null) {xf.setAttribute('fillId',changes.fillId);xf.setAttribute('applyFill','1');}
      xfs.appendChild(xf);xfs.setAttribute('count',children(xfs).length);
      const n=children(xfs).length-1;styleCache.set(key,n);cell.setAttribute('s',n);
    }
    const fillId=cell=>Number(children(xfs)[Number(cell?.getAttribute('s')||0)]?.getAttribute('fillId')||0);
    const weekdayCol=Array.from({length:31},(_,i)=>i+4).find(c=>value(8,c)&&!['토','일'].includes(value(8,c)))||4;
    const weekendCol=Array.from({length:31},(_,i)=>i+4).find(c=>['토','일'].includes(value(8,c)))||weekdayCol;
    const ordinaryFill=fillId(originalCell(9,weekdayCol));
    for(let i=0;i<block.length;i++) {
      const person=block[i],r=start+i;
      if(person) {
        write(cellAt(r,1),i<nurseSlots?i+1:i-nurseSlots+1);write(cellAt(r,2),person.category);write(cellAt(r,3),person.name);
        person.shifts.forEach((sh,j)=>write(cellAt(r,j+4),sh==='O'?'OFF':sh));
      }
      for(let c=4;c<=34;c++)styled(cellAt(r,c),{fillId:ordinaryFill});
      if(nurseSlots&&assistantSlots&&i===nurseSlots-1)for(let c=2;c<=widthEnd;c++)styled(cellAt(r,c),{borderBottom:'double'});
      const last=column(days+3),span=`D${r}:${last}${r}`;
      const totalFormula=(c,expression,count)=>{
        const cell=cellAt(r,c);formula(cell,`IF(C${r}="","",${expression})`,person?count:null);
        if(!person){cell.setAttribute('t','str');cell.appendChild(el(sheet,'v'));}
      };
      totalFormula(35,`COUNTIF(${span},"N")`,person?.shifts.filter(v=>v==='N').length||0);
      // Generic vacation is deliberately not treated as annual leave.
      totalFormula(36,`COUNTIF(${span},"연")+COUNTIF(${span},"연차")`,0);
      totalFormula(37,`COUNTIF(${span},"OFF")+COUNTIF(${span},"O")`,person?.shifts.filter(v=>v==='O'||v==='OFF').length||0);
    }
    const dateKeys=Array.from({length:days},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
    const holidays=options.holidays||{};
    for(let d=1;d<=31;d++) {
      const c=d+3,active=d<=days,weekday=new Date(Date.UTC(year,month-1,d)).getUTCDay();
      write(cellAt(7,c),active?d:null);write(cellAt(8,c),active?'일월화수목금토'[weekday]:null);
      for(const r of [7,8])styled(cellAt(r,c),{fillId:fillId(originalCell(r,active&&(weekday===0||weekday===6||holidays[dateKeys[d-1]])?weekendCol:weekdayCol))});
      for(let j=0;j<4;j++) {
        const shift=['D','E','N','M'][j],target=cellAt(totals+j,c),rangeEnd=shift==='M'?end:start+nurseSlots-1;
        if(!active){clear(target);continue;}
        const count=(shift==='M'?staff:nurses).reduce((n,p)=>n+(p.shifts[d-1]===shift?1:0),0);
        formula(target,rangeEnd>=start?`COUNTIF(${column(c)}${start}:${column(c)}${rangeEnd},"${shift}")`:'0',count);
      }
    }
    // Clear the unused right-hand cells of summary rows and the spacer.
    for(let r=end+1;r<=lastRow;r++)for(let c=1;c<=widthEnd;c++)if(r<totals||c>34||c<3)clear(cellAt(r,c));
    ['D','E','N','M'].forEach((shift,i)=>write(cellAt(totals+i,3),shift));
    write(cellAt(2,2),value(2,2).replace(/\d{4}년/g,year+'년').replace(/\d+월/g,month+'월'));
    write(cellAt(5,2),`${year}년 ${month}월`);
    // No monthly base-OFF field exists in the application yet: preserve the label, not a stale number.
    write(cellAt(5,8),value(5,8).replace(/\d+(?:\.\d+)?/g,options.baseOff==null?'':String(options.baseOff)));
    const merges=first(sheetRoot,'mergeCells');
    if(merges) {
      for(const merge of children(merges)) {
        const ref=merge.getAttribute('ref'),parts=ref.split(':'),a=rowNumber(parts[0]),b=rowNumber(parts[1]||parts[0]);
        if(a>=start&&b<=oldStaffEnd)merges.removeChild(merge);
        else if(a>oldStaffEnd)merge.setAttribute('ref',ref.replace(/(\$?[A-Z]+\$?)(\d+)/g,(_,c,r)=>c+(Number(r)+delta)));
        else if(a<start&&b>=start)throw new Error('직원 영역을 가로지르는 병합이 있어 출력할 수 없습니다.');
      }
      merges.setAttribute('count',children(merges).length);
    }
    // Future hand edits change shift colors, without replacing the template's fonts/borders.
    children(sheetRoot).filter(n=>['conditionalFormatting','dataValidations','rowBreaks','colBreaks','ignoredErrors','extLst'].includes(n.localName)).forEach(n=>sheetRoot.removeChild(n));
    let dxfs=first(styleRoot,'dxfs');
    if(!dxfs){dxfs=el(styles,'dxfs',{count:0});putOrdered(styleRoot,dxfs,['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','cellStyles','dxfs','tableStyles','colors','extLst']);}
    const cf=el(sheet,'conditionalFormatting',{sqref:`D${start}:${column(days+3)}${end}`});
    Object.entries(colors).forEach(([code,color],i)=>{
      const dxf=el(styles,'dxf'),fill=el(styles,'fill'),pattern=el(styles,'patternFill',{patternType:'solid'});
      pattern.appendChild(el(styles,'fgColor',{rgb:'FF'+color}));pattern.appendChild(el(styles,'bgColor',{indexed:64}));fill.appendChild(pattern);dxf.appendChild(fill);dxfs.appendChild(dxf);
      const rule=el(sheet,'cfRule',{type:'cellIs',operator:'equal',dxfId:children(dxfs).length-1,priority:i+1}),f=el(sheet,'formula');f.textContent='"'+code+'"';rule.appendChild(f);cf.appendChild(rule);
    });
    dxfs.setAttribute('count',children(dxfs).length);putOrdered(sheetRoot,cf,sheetOrder);
    first(sheetRoot,'dimension')?.setAttribute('ref',`A1:${column(widthEnd)}${lastRow}`);
    const cols=first(sheetRoot,'cols');if(cols)for(const c of children(cols)) {if(Number(c.getAttribute('min'))>widthEnd)cols.removeChild(c);else if(Number(c.getAttribute('max'))>widthEnd)c.setAttribute('max',widthEnd);}
    all(sheet,'selection').forEach(n=>{n.setAttribute('activeCell','D9');n.setAttribute('sqref','D9');});
    const printArea=`A2:${column(widthEnd)}${lastRow}`;
    let pr=first(sheetRoot,'sheetPr');if(!pr){pr=el(sheet,'sheetPr');putOrdered(sheetRoot,pr,sheetOrder);}
    let setupPr=first(pr,'pageSetUpPr');if(!setupPr){setupPr=el(sheet,'pageSetUpPr');pr.appendChild(setupPr);}setupPr.setAttribute('fitToPage','1');
    let setup=first(sheetRoot,'pageSetup');if(!setup){setup=el(sheet,'pageSetup');putOrdered(sheetRoot,setup,sheetOrder);}
    setup.setAttribute('paperSize','9');setup.setAttribute('orientation','landscape');setup.setAttribute('fitToWidth','1');
    // Keep row heights readable on larger rosters rather than force every roster onto one page.
    setup.setAttribute('fitToHeight',block.length<=capacity?'1':'0');setup.removeAttribute('scale');setup.removeAttributeNS(REL,'id');
    // Retain the original physical margins. Excel handles a larger roster over multiple pages.
    const sourceSheetName=selected.getAttribute('name'),name=`${year}년 ${month}월`;
    const output=new root.JSZip();
    const issues=options.issues||[];
    const issueSheet=issues.length?'<sheet name="편성 확인" sheetId="2" r:id="rId4"/>':'';
    const workbookText=`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/>${issueSheet}</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${name}'!$A$2:$${column(widthEnd)}$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name}'!$1:$8</definedName></definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
    output.file('xl/workbook.xml',workbookText);output.file('xl/worksheets/sheet1.xml',serialize(sheet));output.file('xl/styles.xml',serialize(styles));
    const themeRel=children(rels.documentElement).find(n=>n.getAttribute('Type').endsWith('/theme'));
    if(themeRel)output.file('xl/theme/theme1.xml',await read(zip,resolvePath('xl/workbook.xml',themeRel.getAttribute('Target'))));
    let workbookRels=`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>`;
    if(themeRel)workbookRels+=`<Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/>`;
    if(issues.length){
      workbookRels+=`<Relationship Id="rId4" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/>`;
      const issueRows=[['날짜','확인 사유'],...issues.map(([date,reasons])=>[date,Array.isArray(reasons)?reasons.join(' / '):String(reasons)])];
      output.file('xl/worksheets/sheet2.xml',`<worksheet xmlns="${NS}"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="100" customWidth="1"/></cols><sheetData>${issueRows.map((row,i)=>`<row r="${i+1}">${row.map((v,c)=>`<c r="${column(c+1)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
    }
    output.file('xl/_rels/workbook.xml.rels',workbookRels+'</Relationships>');
    output.file('_rels/.rels',`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    output.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${themeRel?'<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>':''}${issues.length?'<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>':''}</Types>`);
    return {bytes:await output.generateAsync({type:'uint8array',compression:'DEFLATE'}),mimeType:MIME,filename:`간호사_근무표_${year}-${String(month).padStart(2,'0')}.xlsx`,layout:{sourceSheetName,nurses:nurses.length,assistants:assistants.length,nurseSlots,assistantSlots,start,end,totals,printArea,multiplePages:block.length>capacity}};
  }
  root.NurseSchedulerExcel={build};
})(globalThis);

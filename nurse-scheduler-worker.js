// No persistence or UI side effects: return a proposal to the page for validation/writeback.
let state,cursor;
importScripts('nurse-scheduler-model.js?v=20261002-rules5','nurse-scheduler-rules.js?v=20261002-rules5','nurse-scheduler-engine.js?v=20261002-rules5');
self.onmessage=event=>{
 try{state=event.data.state;cursor=new Date(event.data.year,event.data.month,1);self.postMessage({result:solveMonth()})}
 catch(error){self.postMessage({error:error.message||'자동생성 계산 중 오류가 발생했습니다.'})}
};

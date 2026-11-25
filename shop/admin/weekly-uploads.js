(function(){
const isStaff=()=>!!(window.TKAdmin&&window.TKAdmin.isStaff&&window.TKAdmin.isStaff());
const overview=document.getElementById('overview'),review=document.getElementById('review'),create=document.getElementById('create'),returns=document.getElementById('returns'),shippingPage=document.getElementById('shippingPage'),salesLog=document.getElementById('salesLog'),itemSearch=document.getElementById('itemSearch'),findEdit=document.getElementById('findEdit'),changeMany=document.getElementById('changeMany'),publishSec=document.getElementById('publish'),tasksSec=document.getElementById('tasks');
function show(el){[overview,review,create,returns,shippingPage,salesLog,itemSearch,findEdit,changeMany,publishSec,tasksSec].forEach(x=>x&&(x.hidden=x!==el));const t=document.getElementById('uploadTabs');t.hidden=![overview,create,itemSearch,findEdit,changeMany,publishSec].includes(el);[['tabBatches',overview],['newBatch',create],['openPublish',publishSec],['openItemSearch',itemSearch],['openFindEdit',findEdit],['openChangeMany',changeMany]].forEach(([id,v])=>document.getElementById(id)?.setAttribute('aria-selected',String(v===el)));window.scrollTo(0,0)}
document.getElementById('tabBatches').onclick=()=>show(overview);
document.querySelectorAll('.review-btn').forEach(b=>b.addEventListener('click',()=>{document.getElementById('reviewWeek').textContent='Week '+b.dataset.week;document.getElementById('reviewTitle').textContent=b.dataset.batch+' upload';document.getElementById('result').hidden=true;document.getElementById('approve').hidden=b.dataset.week==='34';show(review)}));
document.getElementById('approve').onclick=()=>document.getElementById('result').hidden=false;
document.getElementById('back').onclick=document.getElementById('returnBatch').onclick=document.getElementById('createBack').onclick=()=>show(overview);
const batchDate=document.getElementById('batchDate'),batchWeek=document.getElementById('batchWeek'),batchDay=document.getElementById('batchDay');
function updateBatchDate(){
  if(!batchDate.value){batchWeek.value='';batchDay.value='';return}
  const [year,month,day]=batchDate.value.split('-').map(Number);
  const date=new Date(year,month-1,day);
  batchDay.value=date.toLocaleDateString(undefined,{weekday:'long'});
  const iso=new Date(Date.UTC(year,month-1,day));
  iso.setUTCDate(iso.getUTCDate()+4-(iso.getUTCDay()||7));
  batchWeek.value=Math.ceil((((iso-new Date(Date.UTC(iso.getUTCFullYear(),0,1)))/86400000)+1)/7);
}
batchDate.addEventListener('change',updateBatchDate);
document.getElementById('newBatch').onclick=()=>{
  const today=new Date();
  batchDate.value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  updateBatchDate();show(create);
};
document.getElementById('openItemSearch').onclick=()=>{if(!document.getElementById('tagDate').value)document.getElementById('tagDate').value=localDateValue(new Date());loadSold();show(itemSearch)};
document.getElementById('itemSearchBack').onclick=()=>show(overview);
// Customer's cut: the consignor gets 40% or 50% of what the item sells for (set per item, editable in the sold item's details).
const splitChoices=['40','50'];
function splitOf(r){const s=String(r.splitPercent??'');return splitChoices.includes(s)?s:'40'}
function customerCutCents(r){if(r.consigned===false)return 0;const a=Number(r.saleAmount);if(r.saleAmount==null||r.saleAmount===''||!Number.isFinite(a)||a<0)return null;return Math.round(Math.round(a*100)*Number(splitOf(r))/100)}
function storeCents(r){const c=customerCutCents(r);if(c==null)return null;return Math.round(Number(r.saleAmount)*100)-c}
function money(cents){return '$'+(cents/100).toFixed(2)}
function cutCell(r){if(r.consigned===false)return 'Store piece';const c=customerCutCents(r);if(c==null)return 'Not entered';const wrap=document.createElement('span'),amount=document.createElement('strong'),pct=document.createElement('span');amount.textContent=money(c);pct.className='pct';pct.textContent=splitOf(r)+'%';wrap.append(amount,pct);return wrap}
const api=(path,opts)=>window.TKAdmin.api(path,opts);
const tagItem=document.getElementById('tagItem'),dayMs=24*60*60*1000;
let soldRecords=[],relistedRecords=[],found=null;
function setState(s){soldRecords=s.sold||[];relistedRecords=s.relisted||[]}
async function loadSold(){try{setState(await api('admin/sold/state'));renderSold()}catch(e){document.getElementById('soldMessage').textContent='Could not load sold items: '+e.message}}
function showPhoto(container,rec){
  container.replaceChildren();
  if(!rec||!rec.image)return;
  const img=document.createElement('img');img.className='sample-product-photo';img.src=photoSrc(rec.image);img.alt=rec.name||rec.item;
  const caption=document.createElement('p');caption.textContent=rec.name||rec.item;
  container.append(img,caption);
}
function photoSrc(p){p=String(p||'');return /^https?:\/\//i.test(p)?p:new URL('../../'+p.replace(/^\/+/,''),location.href).href}
function selectedLocation(){return document.getElementById('tagLocation').value.trim()}
// Item search: look the number up in the real catalog.
async function lookup(){
  const q=tagItem.value.trim(),message=document.getElementById('tagMessage'),list=document.getElementById('tagList'),preview=document.getElementById('sampleProductPreview');
  found=null;list.replaceChildren();preview.replaceChildren();
  if(!q){message.textContent='Enter an item number.';return}
  message.textContent='Searching…';
  let r;try{r=await api('admin/sold/lookup?q='+encodeURIComponent(q))}catch(e){message.textContent='Search failed: '+e.message;return}
  if(!r.found&&r.pending){message.textContent='"'+q+'" is a pending item ('+r.pending+') and is not on the website yet, so it cannot be marked sold.';return}
  if(!r.found){await searchPieces(q,message,list);return}
  found=r;message.textContent='';
  const tag=document.createElement('article');tag.className='product-tag';
  const title=document.createElement('strong');title.textContent='Item '+r.item+' · '+r.name;
  const info=document.createElement('p');info.textContent='Price '+money(r.price_cents)+' · Status: '+r.status+(r.record&&!r.record.relisted?' · Sold '+displayDate(r.record.soldAt)+' ('+r.record.location+')':'');
  const photo=document.createElement('div');showPhoto(photo,r);
  tag.append(title,info,photo);
  if(r.status!=='sold'&&!(r.record&&!r.record.relisted)){found.sell=sellPanel(r);tag.append(found.sell)}
  else if(r.record&&!r.record.relisted)tag.append(soldDone(r));
  list.append(tag);
}
// Not an exact item number: search names, brands, colors and her categories ("dresses", "black gown size 10")
// the same way Find & edit does, and list the matches; tapping one opens it with the selling box.
const SEARCH_LIMIT=60;
async function searchPieces(q,message,list){
  let r;try{r=await api('admin/items/search?limit='+SEARCH_LIMIT+'&q='+encodeURIComponent(q))}catch(e){message.textContent='Search failed: '+e.message;return}
  const items=r.items||[];
  if(!items.length){message.textContent='Nothing matched "'+q+'". Try an item number, a brand, or a word like dresses.';return}
  message.textContent='';
  const head=document.createElement('p');head.className='search-head';
  head.textContent=items.length+(items.length>=SEARCH_LIMIT?'+ pieces':items.length===1?' piece':' pieces')+' match "'+q+'". Tap one to sell it.'+(items.length>=SEARCH_LIMIT?' Add a word (a color, brand or size) to narrow it down.':'');
  const wrap=document.createElement('div');wrap.className='search-results';
  for(const it of items){
    const b=document.createElement('button');b.type='button';b.className='fe-row';
    if(it.image){const im=document.createElement('img');im.src=photoSrc(it.image);im.alt='';im.loading='lazy';b.append(im)}else{const s=document.createElement('span');s.className='fe-noimg';b.append(s)}
    const main=document.createElement('span');main.className='fe-main';const nm=document.createElement('b');nm.textContent=it.name||it.sku;const sm=document.createElement('small');sm.textContent=it.sku+(it.consignor?' · consigned':'')+(it.why?' · '+it.why:'');main.append(nm,sm);
    const side=document.createElement('span');side.className='fe-side';side.append(document.createTextNode(it.price_cents==null?'':money(it.price_cents)));const st=document.createElement('small');st.textContent=it.status||'';side.append(st);
    b.append(main,side);
    b.onclick=()=>{tagItem.value=it.sku;lookup().then(()=>tagItem.scrollIntoView({block:'start',behavior:'smooth'}))};
    wrap.append(b);
  }
  list.append(head,wrap);
}
// After "Mark sold": what it sold for, that it is off the website, and the consignor's share.
function soldDone(r){
  const box=document.createElement('div');box.className='sell-box sell-done';box.setAttribute('role','status');
  const head=document.createElement('p');head.className='sell-head';head.textContent='✓ Sold'+saleWords(r.record)+' · off the website';
  box.append(head);
  const a=Number(r.record.saleAmount);
  if(r.consigned&&r.record.saleAmount!==''&&r.record.saleAmount!=null&&Number.isFinite(a)){
    const c=Math.round(a*100),cut=Math.floor((c*r.consigned.split+50)/100);
    const p=document.createElement('p');p.className='sell-sub';p.textContent='Consignor '+r.consigned.number+' is credited '+money(cut)+' ('+r.consigned.split+'% of '+money(c)+'). Store keeps '+money(c-cut)+'.';
    box.append(p);
  }
  const undo=document.createElement('p');undo.className='cut-empty';undo.textContent='Wrong price? Change it under Sold items below. Not sold after all? Use "Return or relist an item".';
  box.append(undo);
  return box;
}
// Selling in the store: the price, an optional discount (% off) and what it really sold for. The consignor's
// share is worked out from what it sold for, the same way the server does it.
function pctText(p){return String(Math.round(p*10)/10)}
function sellPanel(r){
  const box=document.createElement('div');box.className='sell-box';
  const price=r.price_cents==null?null:Number(r.price_cents);
  const head=document.createElement('p');head.className='sell-head';head.textContent=price!=null?'Selling in the store · price on the site '+money(price):'This piece has no price on the site: enter what it sold for.';
  const seg=document.createElement('div');seg.className='seg sell-quick';seg.setAttribute('role','group');seg.setAttribute('aria-label','Discount');
  const pctLabel=document.createElement('label');pctLabel.textContent='Discount (% off)';
  const pct=document.createElement('input');pct.type='number';pct.min='0';pct.max='100';pct.step='any';pct.inputMode='decimal';pct.placeholder='0';pct.id='sellPct';pctLabel.append(pct);
  const soldLabel=document.createElement('label');soldLabel.textContent='Sold for ($)';
  const sold=document.createElement('input');sold.type='number';sold.min='0';sold.step='0.01';sold.inputMode='decimal';sold.id='sellPrice';sold.value=price!=null?(price/100).toFixed(2):'';soldLabel.append(sold);
  const summary=document.createElement('div');summary.className='cut-box';summary.setAttribute('aria-live','polite');
  const cents=()=>{const v=Number(sold.value);return sold.value.trim()===''||!Number.isFinite(v)||v<0?null:Math.round(v*100)};
  const quick=[0,10,20,25,30,50].map(v=>{const b=document.createElement('button');b.type='button';b.textContent=v?v+'% off':'No discount';b.onclick=()=>{pct.value=v?String(v):'';fromPct()};seg.append(b);return [v,b]});
  const row=(cls,label,value)=>{const d=document.createElement('div'),l=document.createElement('span'),v=document.createElement(cls?'span':'strong');d.className='cut-row'+(cls?' '+cls:'');l.textContent=label;v.textContent=value;d.append(l,v);return d};
  // Where and when it sold (kept in step with the Location / Tag date boxes above), then the button that saves it.
  const locSel=document.getElementById('tagLocation'),dateIn=document.getElementById('tagDate');
  const whereLabel=document.createElement('p');whereLabel.className='sell-sub';whereLabel.textContent='Where did it sell?';
  const locSeg=document.createElement('div');locSeg.className='seg sell-quick sell-loc';locSeg.setAttribute('role','group');locSeg.setAttribute('aria-label','Where it sold');
  const msg=document.createElement('p');msg.className='sell-msg';msg.setAttribute('role','status');
  const syncLoc=()=>{for(const [v,b] of locBtns)b.setAttribute('aria-pressed',String(locSel.value===v))};
  const locBtns=[...locSel.options].filter(o=>o.value).map(o=>{const b=document.createElement('button');b.type='button';b.textContent=o.textContent;b.onclick=()=>{locSel.value=o.value;syncLoc();msg.textContent=''};locSeg.append(b);return [o.value,b]});
  locSel.onchange=syncLoc;
  const dateLabel=document.createElement('label');dateLabel.textContent='Sold on';
  const date=document.createElement('input');date.type='date';if(!dateIn.value)dateIn.value=localDateValue(new Date());date.value=dateIn.value;dateLabel.append(date);
  date.addEventListener('input',()=>{dateIn.value=date.value});dateIn.onchange=()=>{date.value=dateIn.value};
  const go=document.createElement('button');go.type='button';go.className='btn sell-go';go.onclick=()=>markSoldNow(msg,go);
  const show=()=>{
    const c=cents(),p=pct.value.trim()===''?0:Number(pct.value);
    for(const [v,b] of quick)b.setAttribute('aria-pressed',String(Math.abs(v-p)<0.001));
    go.textContent=c==null?'Mark sold':'Mark sold for '+money(c)+' · take it off the website';go.disabled=c==null;
    summary.replaceChildren();
    if(c==null){const e=document.createElement('p');e.className='cut-empty';e.textContent='Enter what it sold for.';summary.append(e);return}
    const off=price!=null&&c<price?price-c:0;
    summary.append(row('small','Sold for',money(c)+(off?' · '+pctText(off*100/price)+'% off '+money(price):'')));
    if(r.consigned){
      const cut=Math.floor((c*r.consigned.split+50)/100);
      const bar=document.createElement('div'),fill=document.createElement('i');bar.className='cut-bar';bar.setAttribute('role','img');bar.setAttribute('aria-label',r.consigned.split+'% to the consignor');fill.style.width=r.consigned.split+'%';bar.append(fill);
      summary.append(row('','Consignor '+r.consigned.number+' gets '+r.consigned.split+'%',money(cut)),bar,row('small','Store keeps',money(c-cut)));
    }else{const n=document.createElement('p');n.className='cut-empty';n.textContent='Not a consigned piece, so there is no consignor share.';summary.append(row('','Store keeps',money(c)),n)}
  };
  const fromPct=()=>{const p=Number(pct.value);if(price!=null){if(pct.value.trim()==='')sold.value=(price/100).toFixed(2);else if(Number.isFinite(p)&&p>=0&&p<=100)sold.value=(Math.round(price*(100-p)/100)/100).toFixed(2)}show()};
  const fromSold=()=>{const c=cents();if(price&&c!=null)pct.value=c<price?pctText((price-c)*100/price):'';show()};
  pct.addEventListener('input',fromPct);sold.addEventListener('input',fromSold);
  box.append(head,seg,pctLabel,soldLabel,summary,whereLabel,locSeg,dateLabel,go,msg);syncLoc();show();
  box.values=()=>({sold_price:sold.value.trim(),discount_pct:pct.value.trim()});
  return box;
}
// "Sold for $80.00 (20% off $100.00)" for a sold record.
function saleWords(r){
  if(r.saleAmount==null||r.saleAmount==='')return '';
  return ' · Sold for $'+Number(r.saleAmount).toFixed(2)+(r.discountPct&&r.listPrice?' ('+r.discountPct+'% off $'+Number(r.listPrice).toFixed(2)+')':'');
}
document.getElementById('createTag').onclick=lookup;
tagItem.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lookup()}});
function displayDate(time){return new Date(time).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
function shipmentStatus(record){return record.completed?'Complete':record.fulfillment==='pickup'?(record.deliveredDate?'Picked up':'Store pickup'):record.deliveredDate?'Delivered':record.mailedDate?'Mailed':'Awaiting shipment'}
function shipmentForm(record){
  const form=document.createElement('form');
  const heading=document.createElement('h3');heading.textContent='Shipment details';form.append(heading);
  const status=document.createElement('p');status.textContent='Status: '+shipmentStatus(record);form.append(status);
  const inputs={};
  for(const [key,label,type,max] of [['saleAmount','Amount sold ($)','number',0],['transactionNumber','Transaction number (optional)','text',100],['mailedDate','Date mailed','date',0],['carrier','Carrier','text',100],['shipperName','Shipper name','text',120],['trackingNumber','Tracking number','text',150],['deliveredDate','Date delivered','date',0]]){
    const wrap=document.createElement('label');wrap.textContent=label;
    const input=document.createElement('input');input.type=type;input.value=record[key]==null?'':String(record[key]);if(type==='number'){input.min='0';input.step='0.01'}if(max)input.maxLength=max;
    wrap.append(input);form.append(wrap);inputs[key]=input;
  }
  const splitField=document.createElement('div'),splitTitle=document.createElement('span'),seg=document.createElement('div'),split=document.createElement('input');
  splitTitle.className='split-title';splitTitle.textContent="Customer's split";seg.className='seg';seg.setAttribute('role','group');seg.setAttribute('aria-label',"Customer's split");
  split.type='hidden';split.value=splitOf(record);inputs.splitPercent=split;
  const cutBox=document.createElement('div');cutBox.className='cut-box';cutBox.setAttribute('aria-live','polite');
  const segButtons=splitChoices.map(p=>{const b=document.createElement('button');b.type='button';b.textContent=p+'%';b.onclick=()=>{split.value=p;showCut()};seg.append(b);return [p,b]});
  const showCut=()=>{
    for(const [p,b] of segButtons)b.setAttribute('aria-pressed',String(p===split.value));
    cutBox.replaceChildren();
    const amountText=inputs.saleAmount.value.trim(),c=customerCutCents({item:record.item,saleAmount:amountText,splitPercent:split.value});
    if(c==null){const p=document.createElement('p');p.className='cut-empty';p.textContent="Enter the amount sold to see the customer's cut.";cutBox.append(p);return}
    const row=(cls,label,value)=>{const d=document.createElement('div'),l=document.createElement('span'),v=document.createElement(cls?'span':'strong');d.className='cut-row'+(cls?' '+cls:'');l.textContent=label;v.textContent=value;d.append(l,v);return d};
    const bar=document.createElement('div'),fill=document.createElement('i');bar.className='cut-bar';bar.setAttribute('role','img');bar.setAttribute('aria-label',split.value+'% to the customer');fill.style.width=split.value+'%';bar.append(fill);
    cutBox.append(row('','Customer gets',money(c)),bar,row('small','Store keeps',money(Math.round(Number(amountText)*100)-c)));
  };
  splitField.append(splitTitle,seg,split);
  // The customer's split is only for consigned pieces: the store keeps everything its own pieces sell for.
  if(record.consigned===false){delete inputs.splitPercent}
  else{inputs.saleAmount.addEventListener('input',showCut);showCut();inputs.saleAmount.parentElement.after(splitField,cutBox)}
  const completeLabel=document.createElement('label'),complete=document.createElement('input');complete.type='checkbox';complete.checked=!!record.completed;completeLabel.append(complete,document.createTextNode(' Mark order complete'));form.append(completeLabel);
  const button=document.createElement('button');button.type='submit';button.className='btn ghost';button.textContent='Save shipment details';
  const message=document.createElement('p');message.setAttribute('role','status');form.append(button,message);
  form.onsubmit=async(event)=>{
    event.preventDefault();
    const mailed=inputs.mailedDate.value,delivered=inputs.deliveredDate.value;
    if(record.fulfillment!=='pickup'&&delivered&&!mailed){message.textContent='Enter the date mailed before the date delivered.';return}
    if(complete.checked&&!delivered){message.textContent='Enter the delivery or pickup date before marking the order complete.';return}
    if(delivered&&delivered<mailed){message.textContent='The delivery date cannot be before the mailing date.';return}
    const body={item:record.item,completed:complete.checked};for(const key of Object.keys(inputs))body[key]=inputs[key].value.trim();
    message.textContent='Saving…';
    try{const s=await api('admin/sold/update',{method:'POST',body});setState(s);Object.assign(record,soldRecords.find(r=>r.item===record.item)||{});status.textContent='Status: '+shipmentStatus(record);message.textContent='Shipment details saved.'}
    catch(e){message.textContent='Could not save: '+e.message}
  };
  return form;
}
function renderSold(){
  const now=Date.now();
  const sold=document.getElementById('soldList'),archive=document.getElementById('archiveList');
  sold.replaceChildren();archive.replaceChildren();
  for(const r of soldRecords){
    if(now>=r.soldAt+44*dayMs)continue;
    const archived=now>=r.soldAt+14*dayMs, card=document.createElement('article');card.className='product-tag';
    const title=document.createElement('strong');title.textContent=r.item+' · '+r.name;
    const info=document.createElement('p');info.textContent=(archived?'Archived':'Sold')+' · '+r.location+' · Sold '+displayDate(r.soldAt)+saleWords(r);
    const deadline=document.createElement('p');deadline.className='muted';deadline.textContent=archived?'Removed from archive on '+displayDate(r.soldAt+44*dayMs):'Moves to archive on '+displayDate(r.soldAt+14*dayMs);
    const photo=document.createElement('div');showPhoto(photo,r);
    card.append(title,info,deadline,photo,shipmentForm(r));(archived?archive:sold).append(card);
  }
  if(!sold.children.length)sold.textContent='No sold items yet.';
  if(!archive.children.length)archive.textContent='The archive is empty.';
  renderReturns();
}
function renderReturns(){
  const list=document.getElementById('returnList'), available=document.getElementById('relistedList');
  list.replaceChildren();available.replaceChildren();
  const q=((document.getElementById('returnSearch')||{}).value||'').trim().toLowerCase();
  const hit=r=>!q||[r.item,r.name,r.location].join(' ').toLowerCase().includes(q);
  for(const r of soldRecords){
    if(Date.now()>=r.soldAt+44*dayMs||!hit(r))continue;
    const card=document.createElement('article');card.className='product-tag';
    const title=document.createElement('strong');title.textContent='Item number: '+r.item+' · '+r.name;
    const info=document.createElement('p');info.textContent=(Date.now()>=r.soldAt+14*dayMs?'Archived':'Sold')+' · '+r.location+' · Sold '+displayDate(r.soldAt)+saleWords(r);
    const photo=document.createElement('div');showPhoto(photo,r);
    const button=document.createElement('button');button.type='button';button.className='btn ghost';button.textContent='Relist this item';
    button.onclick=async()=>{
      const msg=document.getElementById('returnMessage');msg.textContent='Relisting…';
      try{setState(await api('admin/sold/relist',{method:'POST',body:{item:r.item}}));renderSold();document.getElementById('returnMessage').textContent=r.item+' is available on the website again.'}
      catch(e){msg.textContent='Could not relist: '+e.message}
    };
    card.append(title,info,photo,button);list.append(card);
  }
  if(!list.children.length)list.textContent=q?'No sold or archived items match your search.':'No sold or archived items.';
  for(const r of relistedRecords){
    if(!hit(r))continue;
    const card=document.createElement('article');card.className='product-tag';
    const title=document.createElement('strong');title.textContent='Item number: '+r.item+' · '+r.name;
    const info=document.createElement('p');info.textContent='Available · '+r.location;
    const photo=document.createElement('div');showPhoto(photo,r);card.append(title,info,photo);available.append(card);
  }
  if(!available.children.length)available.textContent=q?'No relisted items match your search.':'No items relisted yet.';
}
document.getElementById('returnSearch')?.addEventListener('input',renderReturns);
function localDateValue(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
function isoWeekStart(y,w){const j=new Date(y,0,4);j.setDate(j.getDate()-((j.getDay()+6)%7)+(w-1)*7);return j}
function isoWeekOf(d){const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());t.setDate(t.getDate()+3-((t.getDay()+6)%7));const y=t.getFullYear();return{year:y,week:1+Math.round((t-isoWeekStart(y,1))/6048e5)}}
function isoWeeksIn(y){return isoWeekOf(new Date(y,11,28)).week}
function syncWeekBoxes(dateStr){const p=dateStr?dateStr.split('-').map(Number):null,iw=isoWeekOf(p?new Date(p[0],p[1]-1,p[2]):new Date());document.getElementById('salesWeekNo').value=iw.week;document.getElementById('salesYear').value=iw.year}
function renderSalesLog(){
  const mode=document.getElementById('salesMode').value,loc=document.getElementById('salesLoc').value;
  document.querySelectorAll('#salesFilters [data-sm]').forEach(l=>l.hidden=!l.dataset.sm.split(' ').includes(mode));
  const pd=v=>{const p=v.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
  const mondayOf=d=>{const s=new Date(d.getFullYear(),d.getMonth(),d.getDate());s.setDate(s.getDate()-((s.getDay()+6)%7));return s};
  let start,end,label='';
  if(mode==='all'){start=new Date(0);end=new Date(8.64e15);label='All dates'}
  else if(mode==='day'){const v=document.getElementById('salesWeekDate').value;if(!v)return;start=pd(v);end=new Date(start);end.setDate(end.getDate()+1);label='Day '+displayDate(start)}
  else if(mode==='range'){let a=document.getElementById('salesFrom').value,b=document.getElementById('salesTo').value;if(!a&&!b)return;start=a?pd(a):new Date(0);end=b?pd(b):new Date(8.64e15);if(b)end.setDate(end.getDate()+1);label=(a?displayDate(start):'the beginning')+' through '+(b?displayDate(pd(b)):'today')}
  else if(mode==='weekno'){const wkEl=document.getElementById('salesWeekNo'),yrEl=document.getElementById('salesYear');let wk=Math.trunc(Number(wkEl.value)),yr=Math.trunc(Number(yrEl.value))||isoWeekOf(new Date()).year;if(!wk)return;
    /* line the two boxes up: week 0 / 54+ roll into the neighbouring year, and the year box follows */
    while(wk<1){yr--;wk+=isoWeeksIn(yr)}while(wk>isoWeeksIn(yr)){wk-=isoWeeksIn(yr);yr++}
    if(String(wk)!==wkEl.value&&document.activeElement!==wkEl)wkEl.value=wk;if(String(yr)!==yrEl.value&&document.activeElement!==yrEl)yrEl.value=yr;
    wkEl.max=isoWeeksIn(yr);start=isoWeekStart(yr,wk);end=new Date(start);end.setDate(end.getDate()+7);label='Week '+wk+', '+yr+' ('+displayDate(start)+' through '+displayDate(new Date(end.getFullYear(),end.getMonth(),end.getDate()-1))+')'}
  else{const v=document.getElementById('salesWeekDate').value;if(!v)return;start=mondayOf(pd(v));end=new Date(start);end.setDate(end.getDate()+7);label='Week of '+displayDate(start)+' through '+displayDate(new Date(end.getFullYear(),end.getMonth(),end.getDate()-1))}
  const locOk=r=>{if(!loc)return true;const l=String(r.location||'').toLowerCase();return loc==='online'?/online|web|warehouse/.test(l):/tom\s*-?kat|tomcat/.test(l)};
  const records=soldRecords.filter(r=>r.soldAt>=start.getTime()&&r.soldAt<end.getTime()&&locOk(r));
  const groups=new Map();records.forEach((r,i)=>{const key=r.transactionNumber?.trim()||'__item_'+i;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)});
  const completed=[...groups.values()].filter(items=>items.every(r=>r.completed)).length;
  let cents=0,unknown=0;for(const r of records){if(r.saleAmount==null||r.saleAmount===''||!Number.isFinite(Number(r.saleAmount))||Number(r.saleAmount)<0)unknown++;else cents+=Math.round(Number(r.saleAmount)*100)}
  let cutCents=0;for(const r of records){const c=customerCutCents(r);if(c!=null)cutCents+=c}
  const summary=document.getElementById('salesSummary');summary.replaceChildren();
  for(const [value,label] of [[groups.size,'Sales / transactions'],[records.length,'Items sold'],['$'+(cents/100).toFixed(2),'Known amount sold'],[money(cents-cutCents),'Store commission (we made)'],[records.filter(r=>r.fulfillment==='pickup').length,'Store pickup'],[records.filter(r=>r.fulfillment==='usps'&&r.mailedDate).length,'Shipped'],[completed,'Orders complete'],[groups.size-completed,'Orders in progress']]){const div=document.createElement('div');div.className='fact';const strong=document.createElement('strong');strong.textContent=value;div.append(strong,document.createTextNode(label));summary.append(div)}
  const splitBox=document.getElementById('salesSplit');splitBox.replaceChildren();splitBox.className='';
  if(cents>0){
    splitBox.className='split-card';const custPct=Math.round(cutCents/cents*1000)/10;
    const head=document.createElement('div'),title=document.createElement('strong'),sub=document.createElement('span');head.className='split-head';title.textContent='Where the money goes';sub.textContent=money(cents)+' sold'+(unknown?' (some amounts not entered yet)':'');head.append(title,sub);
    const bar=document.createElement('div');bar.className='split-bar';bar.setAttribute('role','img');bar.setAttribute('aria-label',"Customers' cut "+money(cutCents)+', store keeps '+money(cents-cutCents));
    for(const [cls,w] of [['cust',custPct],['store',100-custPct]]){const part=document.createElement('i');part.className=cls;part.style.width=w+'%';bar.append(part)}
    const legend=document.createElement('div');legend.className='split-legend';
    for(const [cls,label,amount] of [['cust',"Customers' cut",cutCents],['store','Store keeps',cents-cutCents]]){const item=document.createElement('span'),sw=document.createElement('b'),value=document.createElement('strong');sw.className='sw '+cls;value.textContent=money(amount);item.append(sw,document.createTextNode(label),value);legend.append(item)}
    splitBox.append(head,bar,legend);
  }
  document.getElementById('salesNote').textContent=label+(loc?' · '+(loc==='online'?'Online':'Tomcat')+' only':'')+'. '+(unknown?unknown+' item(s) have no sale amount; the total is incomplete.':'Amounts are item prices before any taxes, shipping or fees.');
  const body=document.getElementById('salesRows');body.replaceChildren();
  records.map((r,i)=>({r,key:r.transactionNumber?.trim()||'__item_'+i})).sort((a,b)=>Number(groups.get(a.key).every(x=>x.completed))-Number(groups.get(b.key).every(x=>x.completed))).forEach(({r,key})=>{const row=document.createElement('tr'), complete=groups.get(key).every(x=>x.completed);if(!complete)row.className='in-progress';for(const value of [complete?'Complete':'In progress',displayDate(r.soldAt),r.transactionNumber?.trim()||'Not entered',r.item+' · '+r.name,r.location,r.fulfillment==='pickup'?(r.deliveredDate?'Picked up':'Store pickup'):r.fulfillment==='usps'&&r.mailedDate?(r.deliveredDate?'Shipped · delivered':'Shipped'):r.fulfillment==='usps'?'Shipping (not mailed)':'Not set',r.saleAmount==null||r.saleAmount===''?'Not entered':'$'+Number(r.saleAmount).toFixed(2)+(r.discountPct?' ('+r.discountPct+'% off)':''),cutCell(r),storeCents(r)==null?'Not entered':money(storeCents(r)),groups.get(key).length]){const cell=document.createElement('td');if(value instanceof Node)cell.append(value);else if(value==='Complete'||value==='In progress'){const pill=document.createElement('span');pill.className='st-pill '+(complete?'ok':'wip');pill.textContent=value;cell.append(pill)}else cell.textContent=value;row.append(cell)}body.append(row)});
  if(!records.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=10;cell.className='empty';cell.textContent='No saved sales match these filters.';row.append(cell);body.append(row)}
}
document.getElementById('openSalesLog').onclick=async()=>{document.getElementById('salesWeekDate').value=localDateValue(new Date());syncWeekBoxes(document.getElementById('salesWeekDate').value);show(salesLog);try{setState(await api('admin/sold/state'))}catch(e){}renderSalesLog()};
document.getElementById('salesLogBack').onclick=()=>show(overview);
['salesMode','salesWeekDate','salesFrom','salesTo','salesWeekNo','salesYear','salesLoc'].forEach(id=>{const e=document.getElementById(id);e.onchange=e.oninput=renderSalesLog});
document.getElementById('salesMode').addEventListener('change',()=>{if(document.getElementById('salesMode').value==='weekno')syncWeekBoxes(document.getElementById('salesWeekDate').value)});
document.getElementById('salesWeekDate').addEventListener('change',()=>syncWeekBoxes(document.getElementById('salesWeekDate').value));
document.getElementById('openReturns').onclick=document.getElementById('openReturnsFromBatch').onclick=()=>{loadSold();show(returns)};
document.getElementById('returnsBack').onclick=()=>show(overview);
// Saves the sale. Used by the "Mark sold for $…" button in the selling box (and the older Sold button, now hidden).
async function markSoldNow(inBox,btn){
  const location=selectedLocation(),message=document.getElementById('soldMessage'),date=document.getElementById('tagDate').value;
  const say=t=>{message.textContent=t;if(inBox)inBox.textContent=t};
  if(!found){say('Search for an item number first.');return}
  if(!location){say('Choose where it sold first.');return}
  const sale=found.sell?found.sell.values():{};
  if(found.sell&&sale.sold_price===''){say('Enter what it sold for first.');return}
  say('Saving…');if(btn)btn.disabled=true;
  try{setState(await api('admin/sold/mark',{method:'POST',body:{item:found.item,location,date,...sale}}));const rec=soldRecords.find(x=>x.item===found.item)||{};message.textContent=found.item+' marked sold'+saleWords(rec)+' and removed from the website.';renderSold();await lookup()}
  catch(e){say('Could not mark sold: '+e.message);if(btn)btn.disabled=false}
}
document.getElementById('markSold').onclick=()=>markSoldNow(null,null);
const labelButton=document.getElementById('openShippingLabel');
let labelRecord=null;
const fulfillmentFields=document.querySelectorAll('input[name="fulfillment"]');
function updateFulfillment(){
  const usps=document.querySelector('input[name="fulfillment"]:checked').value==='usps';
  document.getElementById('uspsFields').hidden=!usps;document.getElementById('pickupFields').hidden=usps;
  for(const id of ['labelSize','labelRecipient','labelAddress'])document.getElementById(id).required=usps;
  document.getElementById('labelMessage').textContent='';
}
fulfillmentFields.forEach(input=>input.addEventListener('change',updateFulfillment));
document.getElementById('shippingBack').onclick=()=>{renderSold();show(itemSearch)};
function openFulfillment(forcePickup){
  const location=selectedLocation(),message=document.getElementById('soldMessage');
  if(!found){message.textContent='Search for an item number first.';return}
  const record=soldRecords.find(r=>r.item===found.item);
  if(!record){message.textContent='Mark this item sold before opening shipping and pickup.';return}
  labelRecord=record;message.textContent='';
  document.getElementById('labelItem').textContent=record.item+' · '+record.name+' · '+record.location;
  showPhoto(document.getElementById('labelPhoto'),record);
  for(const [id,key] of [['labelSize','packageSize'],['labelRecipient','recipient'],['labelAddress','address'],['labelTracking','trackingNumber'],['labelMailed','mailedDate'],['labelShipper','shipperName']]) document.getElementById(id).value=record[key]||'';
  document.getElementById('labelDelivered').value=record.deliveredDate||'';document.getElementById('labelComplete').checked=!!record.completed;
  document.querySelector('input[name="fulfillment"][value="'+(record.fulfillment==='pickup'?'pickup':'usps')+'"]').checked=true;
  if(forcePickup)document.querySelector('input[name="fulfillment"][value="pickup"]').checked=true;
  updateFulfillment();show(shippingPage);
}
labelButton.onclick=()=>openFulfillment(false);
document.getElementById('openStorePickup').onclick=()=>openFulfillment(true);
document.getElementById('labelForm').onsubmit=async(event)=>{
  event.preventDefault();const message=document.getElementById('labelMessage');
  if(!labelRecord||!soldRecords.some(r=>r.item===labelRecord.item)){message.textContent='This item is no longer in sold items or the archive. Search for it again.';return}
  const method=document.querySelector('input[name="fulfillment"]:checked').value,mailed=document.getElementById('labelMailed').value;
  const delivered=document.getElementById('labelDelivered').value,complete=document.getElementById('labelComplete').checked;
  if(method==='usps'&&delivered&&(!mailed||mailed>delivered)){message.textContent='The mailing date must be on or before the delivery date.';return}
  if(complete&&!delivered){message.textContent='Enter the delivery or pickup date before marking the order complete.';return}
  const body={item:labelRecord.item,deliveredDate:delivered,completed:complete,fulfillment:method};
  if(method==='usps'){
    for(const [id,key] of [['labelSize','packageSize'],['labelRecipient','recipient'],['labelAddress','address'],['labelTracking','trackingNumber'],['labelMailed','mailedDate'],['labelShipper','shipperName']]) body[key]=document.getElementById(id).value.trim();
    body.carrier='USPS';
  }
  message.textContent='Saving…';
  try{setState(await api('admin/sold/update',{method:'POST',body}));labelRecord=soldRecords.find(r=>r.item===body.item)||labelRecord;message.textContent=method==='usps'?'USPS shipping details saved. No label has been purchased or printed.':'Store pickup saved.'}
  catch(e){message.textContent='Could not save: '+e.message}
};
const photoFiles=document.getElementById('photoFiles'),csvFile=document.getElementById('csvFile');
document.getElementById('choosePhotos').onclick=()=>photoFiles.click();
document.getElementById('chooseCsv').onclick=()=>csvFile.click();
let photoUrls=[],photoList=[];
const IMGRE=/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
const isImg=f=>(f.type||'').startsWith('image/')||IMGRE.test(f.name);
function syncPhotoInput(){const dt=new DataTransfer();photoList.forEach(f=>dt.items.add(f));photoFiles.files=dt.files}
function renderPhotos(){
  const preview=document.getElementById('photoPreview');
  photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];preview.replaceChildren();
  document.getElementById('photoStatus').textContent=photoList.length?`${photoList.length} photo${photoList.length===1?'':'s'} selected — click a photo to remove it`:'No photos selected';
  photoList.forEach(file=>{
    const figure=document.createElement('figure');figure.style.cssText='margin:0;width:100px;position:relative;cursor:pointer';figure.title='Click to remove';
    const img=document.createElement('img');const url=URL.createObjectURL(file);photoUrls.push(url);
    img.src=url;img.alt=file.name;img.style.cssText='width:100px;height:100px;object-fit:cover;border-radius:8px';img.onerror=()=>{const ph=document.createElement('div');ph.style.cssText='width:100px;height:100px;border-radius:8px;background:#f3e9ee;color:#8a6b78;font-size:11px;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;box-sizing:border-box';ph.textContent='No preview here';img.replaceWith(ph)};
    const x=document.createElement('span');x.textContent='×';x.style.cssText='position:absolute;top:4px;right:4px;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font-size:16px';
    const caption=document.createElement('figcaption');caption.style.cssText='font-size:12px;overflow-wrap:anywhere';caption.textContent=file.name;
    figure.onclick=()=>{photoList=photoList.filter(f=>f!==file);syncPhotoInput();renderPhotos()};
    figure.append(img,x,caption);preview.append(figure);
  });
}
function addPhotos(files){
  const key=f=>(f.webkitRelativePath||f.name)+'|'+f.size+'|'+f.lastModified;
  const have=new Set(photoList.map(key));
  for(const f of files){if(isImg(f)&&!have.has(key(f))){have.add(key(f));photoList.push(f);try{uploadPhoto(f).catch(()=>{})}catch{}}}   /* start sending right away, so Upload only has the final step left */
  syncPhotoInput();renderPhotos();
}
photoFiles.onchange=()=>addPhotos([...photoFiles.files]);
const photoDir=document.getElementById('photoFolder');
if(photoDir)photoDir.onchange=()=>{addPhotos([...photoDir.files]);photoDir.value=''};
document.getElementById('choosePhotosFolder')?.addEventListener('click',()=>photoDir.click());
(function(){const anchor=document.getElementById('choosePhotosFolder')||document.getElementById('choosePhotos');if(!anchor||document.getElementById('removeAllPhotos'))return;
  const b=document.createElement('button');b.type='button';b.id='removeAllPhotos';b.className='btn ghost';b.textContent='Remove all photos';
  b.onclick=()=>{if(!photoList.length)return;if(!confirm('Remove all '+photoList.length+' photos from this batch?'))return;photoList=[];syncPhotoInput();renderPhotos()};
  anchor.insertAdjacentElement('afterend',b);b.before(' ')})();
window.TKPhotoAdd=addPhotos;
/* ---- spreadsheet drop box: her consignor workbook -> Consignors import, any other sheet -> spreadsheet add ---- */
const SHEETRE=/\.(xlsx|xlsm|xls|csv|tsv|txt)$/i;
const b64=file=>new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>bad(r.error);r.readAsDataURL(file)});
/* ---- consignor workbook: built-in preview + import (staff page has no Consignors tab) ---- */
async function consignorImport(name,data,route){
  const run=async apply=>{
    route.replaceChildren(note(apply?'Importing consignors…':'Reading the consignor workbook…'));
    try{
      const {result}=await window.TKAdmin.api('admin/consignors/import',{method:'POST',body:{name,data,apply}});
      const nums=result.consignors.map(c=>c.number);
      const table=h('table',{class:'table'},h('thead',{},h('tr',{},['Number','Name','','Pieces','Sold'].map(t=>h('th',{},t)))),h('tbody',{},result.consignors.map(c=>h('tr',{},h('td',{},c.number),h('td',{},c.name),h('td',{},c.new?'new':'update'),h('td',{},c.items_new+' new, '+c.items_known+' known'),h('td',{},String(c.sales))))));
      const warn=(result.warnings||[]).length?h('details',{},h('summary',{},result.warnings.length+' note(s)'),h('ul',{},result.warnings.map(w=>h('li',{},w)))):null;
      if(!apply){
        route.replaceChildren(...[note('✓ Consignor workbook: '+result.consignors.length+' consignor(s). Nothing is saved until you press Import.'),h('div',{style:'overflow-x:auto'},table),warn,h('button',{type:'button',class:'btn small',onclick:()=>run(true)},'Import '+result.consignors.length+' consignor(s)')].filter(Boolean));
      }else{
        route.replaceChildren(...[note('✓ Imported '+result.consignors.length+' consignor(s). Their pieces are saved; next, add photos and put them on the website.'),warn,h('button',{type:'button',class:'btn small',onclick:()=>putOnWebsite({consignors:nums})},'Next: put their pieces on the website →')].filter(Boolean));
      }
    }catch(e){route.replaceChildren(note(name+': '+e.message,'bad'))}
  };
  return run(false);
}
const importConsignors=(name,data,route)=>window.TKConsignors?.importData&&!isStaff()?window.TKConsignors.importData(name,data):consignorImport(name,data,route);
csvFile.onchange=async()=>{
  const preview=document.getElementById('csvPreview'),status=document.getElementById('csvStatus'),route=document.getElementById('csvRoute'),file=csvFile.files[0];
  route.replaceChildren();preview.hidden=true;preview.textContent='';
  status.textContent=file?file.name:'No spreadsheet selected';
  if(!file)return;
  if(!window.TKAdmin){route.textContent='Still signing in — pick the file again in a moment.';return}
  if(!SHEETRE.test(file.name)){route.textContent='That is not a spreadsheet (.xlsx or .csv).';return}
  route.textContent='Reading it…';
  try{
    const data=await b64(file);
    const r=await window.TKAdmin.api('admin/pieces/sheet',{method:'POST',body:{name:file.name,data}});
    const go=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent=label;b.onclick=fn;return b};
    if(r.kind==='consignors'){
      consignorImport(file.name,data,route);
    }else{
      const bad=r.rows.filter(x=>x.problems&&x.problems.length).length;
      route.replaceChildren(`✓ ${r.rows.length} piece(s) found in this spreadsheet`+(bad?` (${bad} with problems that will be skipped)`:'')+'. Press Next.',window.TKEbay?.bulkAdd?document.createTextNode(' '):'',window.TKEbay?.bulkAdd?go('Open the spreadsheet add',()=>window.TKEbay.bulkAdd()):'');
      if(/\.(csv|tsv)$/i.test(file.name)){preview.hidden=false;preview.textContent=await file.slice(0,16384).text()}
    }
  }catch(e){route.textContent=file.name+': '+e.message}
};

/* ---- Put on website: review table -> photos -> admin/consignors/publish ---- */
const pubSec=document.getElementById('publish'),pubBody=document.getElementById('publishBody'),pubMsg=document.getElementById('publishMsg');
document.getElementById('publishBack').onclick=()=>show(overview);
const PHOTORE=/\.(jpe?g|png|webp|heic|heif|gif)$/i;
const pk=name=>{const base=name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9]/g,'');const m=base.match(/^(.*\d)([a-z])(\d?)$/);return m?{key:m[1],order:m[2]+m[3]}:{key:base,order:''}};
const keyOf=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function h(tag,attrs,...kids){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='class')n.className=v;else n.setAttribute(k,v===true?'':v)}for(const c of kids.flat()){if(c==null||c===false)continue;n.append(c instanceof Node?c:document.createTextNode(String(c)))}return n}
const note=(text,kind)=>h('p',{class:'pub-msg '+(kind||'')},text);
window.TKWU={h,note,b64,uploadPhoto:f=>uploadPhoto(f)};
const blobB64=blob=>new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=bad;r.readAsDataURL(blob)});
async function photoSizes(file){
  let bm;try{bm=await createImageBitmap(file,{imageOrientation:'from-image'})}catch{bm=await createImageBitmap(file)}
  const out={};let src=bm,sw=bm.width,sh=bm.height;
  /* shrink step by step: each size is made from the previous (smaller) one, not from the full photo */
  for(const[name,side,q]of[['lg',1600,.8],['card',800,.8],['thumb',240,.78]]){
    const sc=Math.min(1,side/Math.max(bm.width,bm.height)),c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(bm.width*sc));c.height=Math.max(1,Math.round(bm.height*sc));
    const x=c.getContext('2d');x.imageSmoothingQuality='medium';x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(src,0,0,sw,sh,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));out[name]=await blobB64(blob);
    src=c;sw=c.width;sh=c.height;
  }
  bm.close&&bm.close();return out;
}
/* up to 6 photos prepared and sent at once; the same photo file is only sent once */
let _act=0;const _q=[];const _cache=new Map();
const _slot=()=>new Promise(r=>{if(_act<8){_act++;r()}else _q.push(r)});
const _free=()=>{const n=_q.shift();if(n)n();else _act--};
function uploadPhoto(file){
  const k=file.name+'|'+file.size+'|'+file.lastModified;
  if(_cache.has(k))return _cache.get(k);
  const p=(async()=>{
    await _slot();
    try{
      let sizes;try{sizes=await photoSizes(file)}catch{throw new Error(file.name+' could not be read by this browser'+(/\.hei[cf]$/i.test(file.name)?' (HEIC photo: save it as JPG first).':'.'))}
      return(await window.TKAdmin.api('admin/pieces/photo',{method:'POST',body:sizes})).photo.id;
    }finally{_free()}
  })();
  _cache.set(k,p);p.catch(()=>_cache.delete(k));return p;
}
async function filesFromDrop(dt){
  const out=[];
  const walk=async entry=>{
    if(entry.isFile)out.push(await new Promise((ok,bad)=>entry.file(ok,bad)));
    else if(entry.isDirectory){const rd=entry.createReader();let batch;do{batch=await new Promise((ok,bad)=>rd.readEntries(ok,bad));for(const e of batch)await walk(e)}while(batch.length)}
  };
  const entries=[...(dt.items||[])].map(i=>i.webkitGetAsEntry&&i.webkitGetAsEntry()).filter(Boolean);
  if(entries.length)for(const e of entries)await walk(e);else out.push(...dt.files);
  return out;
}
let pub={pieces:[],already:0,photos:new Map(),query:null};
function photosFor(p){return[...(pub.photos.get(keyOf(p.photo_key||p.item_no))||[])].sort((a,b)=>a.order.localeCompare(b.order)).slice(0,12)}
async function loadReview(query){
  pub.query=query;pubMsg.replaceChildren();pubBody.replaceChildren(note('Loading the pieces…'));
  try{
    const body={apply:false};if(query?.consignors?.length)body.consignors=query.consignors;if(query?.items?.length)body.items=query.items;
    const r=await window.TKAdmin.api('admin/consignors/publish',{method:'POST',body});
    pub.pieces=(r.pieces||[]).map(p=>({...p,include:null,_edit:{}}));pub.already=Array.isArray(r.already_on_website)?r.already_on_website.length:(r.already_on_website||0);
    try{pub.held=(await window.TKAdmin.api('admin/pieces/hold')).held||[]}catch{pub.held=[]}
    // "Also list on eBay": which store the eBay queue posts to (owner only; null = the checkboxes stay hidden)
    pub.ebay=null;if(!isStaff()){try{const q=await window.TKAdmin.api('admin/ebay/queue');pub.ebay={store:q.store||null,reason:q.reason||null}}catch{pub.ebay=null}}
    // photos already picked in "Create a batch" count too
    for(const f of document.getElementById('photoFiles').files)addPhoto(f);
    render();
  }catch(e){pubBody.replaceChildren(note(e.message,'error'))}
}
function addPhoto(f){
  if(!PHOTORE.test(f.name))return;
  const k=pk(f.name),key=keyOf(k.key);
  if(!pub.photos.has(key))pub.photos.set(key,[]);
  const list=pub.photos.get(key);if(!list.some(x=>x.file.name===f.name))list.push({file:f,order:k.order});
}
function holdRow(row,needs){const{sheet,include,ok,problems,photos_named,...f}=row;return{item_number:f.item_number||f.sku||'',name:f.name||'',price:f.price??'',main_category:f.main_category||'',sub_category:f.sub_category||'',size:f.size||'',color:f.color||'',brand:f.brand||'',condition:f.condition||'',photo_key:f.photo_key||'',details:f.details||'',needs:needs.map(x=>x==='photos'?'photos':String(x).replace(/\.$/,'').replace(/^no (price|name|category)\b.*$/i,'a $1').replace(/^Pick a category.*$/i,'a category'))}}
function heldNeeds(r){const o=[];if(!photosFor({photo_key:r.photo_key,item_no:r.item_number}).length)o.push('photos');if(!(Number(r.price)>0))o.push('a price');if(!r.name||String(r.name).trim().length<3)o.push('a name');if(!r.main_category)o.push('a category');return o}
function problemsOf(p){const out=[...(p.problems||[])];if(!p.name||!String(p.name).trim())out.push('no name');if(!(Number(p.price)>0)&&!out.some(x=>/price/i.test(x)))out.push('no price');if(!photosFor(p).length)out.push('no photos found for '+p.item_no);return[...new Set(out)]}
function render(){
  for(const p of pub.pieces){const ok=!problemsOf(p).length;if(!p.touched)p.include=ok;if(!ok)p.include=false}
  const ready=pub.pieces.filter(p=>p.include&&!problemsOf(p).length).length;
  const ebayOn=!isStaff()&&!!(pub.ebay&&pub.ebay.store);
  const goingLive=pub.pieces.filter(p=>p.include&&!problemsOf(p).length);
  const ebayBar=!pub.pieces.length||isStaff()||!pub.ebay?null:(ebayOn
    ?h('div',{class:'eq-bar'},h('strong',{},'Also list on eBay'),h('span',{class:'eq-count',role:'status'},`${goingLive.filter(p=>p.ebay).length} of ${goingLive.length} will also go on eBay (store ${pub.ebay.store})`),
      h('button',{type:'button',class:'btn small ghost',onclick:()=>{goingLive.forEach(p=>{p.ebay=true});render()}},'Select all'),
      h('button',{type:'button',class:'btn small ghost',onclick:()=>{pub.pieces.forEach(p=>{p.ebay=false});render()}},'Select none'))
    :h('p',{class:'muted eq-why'},'Also list on eBay is not available: '+(pub.ebay.reason||'no eBay store can take new listings.')));
  const photoCount=[...pub.photos.values()].reduce((n,g)=>n+g.length,0);
  const zone=h('div',{class:'pub-drop',tabindex:'0',role:'button'},'Drop the photos here (or a whole folder) – or click to choose');
  const pick=h('input',{type:'file',accept:'image/*',multiple:true,hidden:true});
  const take=files=>{files.forEach(addPhoto);render()};
  pick.onchange=()=>take([...pick.files]);zone.onclick=()=>pick.click();
  zone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick.click()}};
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('over')};zone.ondragleave=()=>zone.classList.remove('over');
  zone.ondrop=async e=>{e.preventDefault();zone.classList.remove('over');take(await filesFromDrop(e.dataTransfer))};
  const rows=pub.pieces.map(p=>{
    const probs=problemsOf(p);const ok=!probs.length;
    if(!p.touched)p.include=ok;
    if(!ok)p.include=false;
    const pics=photosFor(p);
    const box=h('input',{type:'checkbox',checked:p.include,disabled:!ok,'aria-label':'Put '+(p.name||p.item_no)+' on the website'});
    box.onchange=()=>{p.include=box.checked;p.touched=true;render()};
    const ebx=ebayOn?h('input',{type:'checkbox',class:'eq-box',checked:!!p.ebay&&!!p.include,disabled:!p.include,'aria-label':'Also list '+(p.name||p.item_no)+' on eBay'}):null;
    if(ebx)ebx.onchange=()=>{p.ebay=ebx.checked;render()};
    const inp=(field,attrs)=>{const i=h('input',{value:p[field]??'','aria-label':field+' for '+p.item_no,...attrs});i.oninput=()=>{p[field]=i.value;p._edit[field]=true};i.onchange=render;return i};
    const thumb=pics[0]?h('img',{class:'pub-thumb',alt:'',src:URL.createObjectURL(pics[0].file),onload:e=>URL.revokeObjectURL(e.target.src)}):h('span',{class:'muted'},'—');
    return h('tr',{class:ok?'':'dim'},h('td',{},box),ebayOn?h('td',{class:'eq-cell'},h('label',{class:'eq-label'},ebx,' eBay')):null,h('td',{},thumb),
      h('td',{},h('strong',{},p.item_no),h('div',{class:'muted'},isStaff()?'':(p.consignor_name||p.consignor||'')),h('div',{class:'muted'},pics.length+' photo(s)')),
      h('td',{},inp('name',{class:'pub-name',maxlength:'120'}),h('div',{class:'muted'},p.description&&p.description!==p.name?p.description:'')),
      h('td',{},inp('price',{type:'number',step:'0.01',min:'0',class:'pub-num',readonly:isStaff()})),
      h('td',{},inp('size',{class:'pub-num'})),
      h('td',{},inp('main_category'),inp('sub_category'),p.category_note?h('div',{class:'muted'},p.category_note):null),
      h('td',{},ok?h('span',{class:'badge ok'},'ready'):pendingChips(probs.map(x=>x.replace(/^no photos found for.*$/,'photos').replace(/\.$/,'')))));
  });
  const go=h('button',{type:'button',class:'btn',disabled:!ready},`Put ${ready} piece(s) on the website`);
  go.onclick=()=>publish(go);
  pubBody.replaceChildren(
    h('p',{class:'muted'},`${pub.pieces.length} piece(s) waiting${pub.already?` · ${pub.already} already on the website`:''} · ${photoCount} photo(s) dropped. Pieces missing key info are marked PENDING and cannot go live until it is added.`),
    zone,pick,ebayBar||'',
    pub.pieces.length?h('div',{class:'pub-scroll'},h('table',{class:'pub-table'},h('thead',{},h('tr',{},['',...(ebayOn?['eBay']:[]),'','Item','Name','Price','Size','Category',''].map(t=>h('th',{},t)))),h('tbody',{},rows))):note('Nothing is waiting to go on the website.'),
    heldSection()||'',
    h('div',{class:'pub-actions'},go),h('div',{id:'publishResult'}));
}
/* A worker's cheap pieces (or all of them, if the owner wants to check everything) are saved but hidden until the owner says OK. */
const heldSet=r=>new Set(((r&&r.held)||[]).map(x=>keyOf(typeof x==='object'?x.sku:x)));
const WAITING='Added. Waiting for the owner’s OK';
function pendingChips(list){return h('span',{},h('span',{class:'badge pending'},'PENDING'),' ',h('span',{class:'pending-needs'},'Missing: '+list.join(', ')))}
function heldSection(){
  const held=pub.held||[];if(!held.length)return null;
  const rows=held.map(r=>{
    const needs=heldNeeds(r);
    const inp=(f,attrs)=>{const i=h('input',{value:r[f]??'','aria-label':f+' for '+r.item_number,...attrs});i.oninput=()=>{r[f]=i.value};i.onchange=()=>render();return i};
    const btn=h('button',{type:'button',class:'btn',disabled:!!needs.length},'Put on website');
    btn.onclick=async()=>{btn.disabled=true;const out=document.getElementById('publishResult');
      try{const ids=await Promise.all(photosFor({photo_key:r.photo_key,item_no:r.item_number}).map(ph=>uploadPhoto(ph.file)));
        const piece={item_number:r.item_number,name:r.name,price:r.price,photos:ids};for(const f of['main_category','sub_category','size','color','brand','condition','details'])if(r[f]!=null&&r[f]!=='')piece[f]=r[f];
        const b=await window.TKAdmin.api('admin/pieces/batch',{method:'POST',body:{pieces:[piece]}});
        if(b.errors&&b.errors.length)throw new Error(b.errors[0].error);
        await window.TKAdmin.api('admin/pieces/hold',{method:'POST',body:{remove:[r.item_number]}});
        const waits=heldSet(b).has(keyOf(r.item_number));
        pub.held=pub.held.filter(x=>x!==r);try{window.TKAdmin.reloadPieces()}catch{}render();
        document.getElementById('publishResult')?.replaceChildren(note(waits?r.item_number+': '+WAITING+'.':r.item_number+' is on the website now.','ok'))}
      catch(e){btn.disabled=false;out.replaceChildren(note(r.item_number+': '+e.message,'error'))}};
    return h('tr',{},h('td',{},h('strong',{},r.item_number)),h('td',{},inp('name',{class:'pub-name'})),h('td',{},inp('price',{type:'number',step:'0.01',min:'0',class:'pub-num'})),
      h('td',{},inp('main_category'),inp('sub_category')),h('td',{},needs.length?pendingChips(needs):h('span',{class:'badge ok'},'complete')),h('td',{},btn))});
  return h('div',{class:'pub-held'},h('h3',{},`Pending items (${held.length}) – missing key info, not on the website yet`),
    h('p',{class:'muted'},'These pieces are saved but stay OFF the website until every missing item below is filled in. Drop the photos above or fill in the blanks; the button turns on when nothing is missing.'),
    h('div',{class:'pub-scroll'},h('table',{class:'pub-table'},h('thead',{},h('tr',{},['Item','Name','Price','Category','Status',''].map(t=>h('th',{},t)))),h('tbody',{},rows))))}
async function publish(btn){
  btn.disabled=true;const out=document.getElementById('publishResult');
  const chosen=pub.pieces.filter(p=>p.include&&!problemsOf(p).length);
  const ready=[],failed=[];let done=0;const total=chosen.reduce((n,p)=>n+photosFor(p).length,0);
  await Promise.all(chosen.map(async p=>{
    try{
      const ids=await Promise.all(photosFor(p).map(async ph=>{const id=await uploadPhoto(ph.file);out.replaceChildren(note(`Sending photos… ${++done} of ${total}`));return id}));
      const piece={item_no:p.item_no,photos:ids,name:p.name,price:Number(p.price)};
      if(p.ebay&&!isStaff()&&pub.ebay&&pub.ebay.store)piece.ebay=true;
      for(const f of['main_category','sub_category','size','color','brand','condition','details'])if(p[f]!=null&&p[f]!=='')piece[f]=p[f];
      ready.push(piece);
    }catch(e){failed.push(`${p.item_no}: ${e.message}`)}
  }));
  const added=[],heldNow=[],ebayQ={queued:0,skipped:[],store:pub.ebay&&pub.ebay.store};
  for(let i=0;i<ready.length;i+=20){
    out.replaceChildren(note(`Putting pieces on the website… ${Math.min(i+20,ready.length)} of ${ready.length}`));
    try{
      const r=await window.TKAdmin.api('admin/consignors/publish',{method:'POST',body:{apply:true,pieces:ready.slice(i,i+20)}});
      added.push(...(r.added||[]));heldNow.push(...heldSet(r));
      if(r.ebay_queue){ebayQ.queued+=(r.ebay_queue.queued||[]).length;ebayQ.skipped.push(...(r.ebay_queue.skipped||[]));if(r.ebay_queue.store)ebayQ.store=r.ebay_queue.store}failed.push(...(r.errors||[]).map(e=>`${e.item||'row '+e.row}: ${e.error}`));
    }catch(e){failed.push(e.message)}
  }
  const live=new Set(added.map(a=>keyOf(a.sku)));
  pub.pieces=pub.pieces.filter(p=>!live.has(keyOf(p.item_no)));
  try{window.TKAdmin.reloadPieces()}catch{}
  render();
  const res=document.getElementById('publishResult');
  res.replaceChildren(...[
    note(heldNow.length?`${added.length-heldNow.length} on the website, ${heldNow.length} waiting for the owner’s OK`:`${added.length} piece(s) are on the website now.`,added.length?'ok':''),
    ebayQ.queued?note(`${ebayQ.queued} piece(s) will also be posted to eBay${ebayQ.store?' (store '+ebayQ.store+')':''} in the next few minutes. Watch Pieces & eBay → eBay queue.`,'ok'):null,
    ebayQ.skipped.length?h('details',{},h('summary',{},`${ebayQ.skipped.length} not queued for eBay`),h('ul',{},ebayQ.skipped.map(x=>h('li',{},x.sku+': '+x.why)))):null,
    added.length?h('ul',{},added.map(a=>h('li',{},a.name||a.sku,' (',a.sku,') ',heldNow.includes(keyOf(a.sku))?h('span',{class:'fe-held'},WAITING):(a.url?h('a',{href:'../../'+a.url,target:'_blank',rel:'noopener'},'see it ↗'):null)))):null,
    failed.length?h('details',{open:true},h('summary',{},`${failed.length} not put on the website`),h('ul',{},failed.map(f=>h('li',{class:'bad-text'},f)))):null].filter(Boolean));
}
function putOnWebsite(query){
  document.querySelector('[data-tab="weekly"]')?.click();
  show(pubSec);pub.photos=pub.photos||new Map();
  return loadReview(query||{});
}
window.TKWeekly=Object.assign(window.TKWeekly||{},{putOnWebsite});
const pubLink=h('button',{type:'button',id:'openPublish','aria-selected':'false'},'Pending info');
pubLink.onclick=()=>putOnWebsite({});
document.getElementById('uploadTabs').insertBefore(pubLink,document.getElementById('openItemSearch'));

/* ---- Import button: sheet + photos -> pieces on the website ---- */
document.getElementById('importBtn').onclick=async function(){
  const btn=this,out=document.getElementById('importOut'),file=csvFile.files[0],pics=[...photoFiles.files];
  const say=(t,k)=>out.replaceChildren(note(t,k));
  if(!file){say('Choose the spreadsheet first.','bad');return}
  btn.disabled=true;
  try{
    say('Reading the spreadsheet…');
    const data=await b64(file);
    /* the answers given under "Categories in this batch" go with the read (the owner's are remembered on the server too) */
    const r=await window.TKAdmin.api('admin/pieces/sheet',{method:'POST',body:{name:file.name,data,category_answers:Object.fromEntries(window.TKCatAnswers||[])}});
    if(r.kind==='consignors'){
      importConsignors(file.name,data,out);
      return}
    /* 11-18: photos are optional here: every row without photos is kept in Pending info (not on the website) until they are added */
    const groups=new Map();for(const f of pics){const k=pk(f.name);if(!groups.has(k.key))groups.set(k.key,[]);groups.get(k.key).push({f,order:k.order})}
    const nameKey=n=>String(n||'').replace(/^.*[\\/]/,'').replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const byName=new Map();for(const list of groups.values())for(const p of list)byName.set(nameKey(p.f.name),p);
    const used=new Set(),missing=[];
    const ready=[],failed=[],tasks=[],toHold=[];let n=0;
    for(const row of r.rows){
      const label=row.item_number||row.name||'row';
      const ed=(window.TKBatchEdits||new Map()).get(keyOf(row.item_number||row.name));
      if(ed&&ed.fields){Object.assign(row,ed.fields);row.problems=(row.problems||[]).filter(x=>!Object.keys(ed.fields).some(k=>new RegExp(k==='main_category'?'categor':k,'i').test(x)));if(ed.fields.main_category!==undefined||ed.fields.sub_category!==undefined)delete row.new_category}
      if(row.problems&&row.problems.length){if(row.item_number)toHold.push(holdRow(row,row.problems));else failed.push(label+': '+row.problems.join('; '));continue}
      let list=[];
      if(row.photos_named&&row.photos_named.length){
        /* the spreadsheet names the photos for this item (many photos per item; one photo may serve several items) */
        const want=row.photos_named.map(nameKey);
        for(const w of want){const hit=byName.get(w);if(hit){used.add(w);if(!list.includes(hit))list.push(hit)}else missing.push(label+': photo "'+w+'" listed in the sheet was not among the uploaded photos')}
      }
      if(ed&&ed.files&&ed.files.length)list=ed.files.map(f=>({f,order:''}));
      if(!list.length)list=[...(groups.get(keyOf(row.photo_key||row.item_number))||[])].sort((a,b)=>a.order.localeCompare(b.order));
      list=list.slice(0,12);
      if(!list.length){toHold.push(holdRow(row,['photos']));continue}
      list.forEach(p=>used.add(nameKey(p.f.name)));
      tasks.push((async()=>{try{
        const ids=await Promise.all(list.map(async p=>{const id=await uploadPhoto(p.f);say(`Sending photos… ${++n} done`);return id}));
        const{sheet,include,ok,problems,photo_key,photos_named,...fields}=row;ready.push({...fields,photos:ids});
      }catch(e){failed.push(label+': '+e.message)}})());
    }
    await Promise.all(tasks);
    let held=0;
    if(toHold.length){try{await window.TKAdmin.api('admin/pieces/hold',{method:'POST',body:{rows:toHold}});held=toHold.length}catch(e){failed.push('Could not keep '+toHold.length+' unfinished piece(s): '+e.message)}}
    let added=[];const heldNow=[];
    for(let i=0;i<ready.length;i+=20){
      say(`Adding pieces to the website… ${Math.min(i+20,ready.length)} of ${ready.length}`);
      try{const b=await window.TKAdmin.api('admin/pieces/batch',{method:'POST',body:{pieces:ready.slice(i,i+20)}});added.push(...b.added);heldNow.push(...heldSet(b));failed.push(...b.errors.map(e=>`${e.item||'row '+e.row}: ${e.error}`))}catch(e){failed.push(e.message)}
    }
    out.replaceChildren(...[note(heldNow.length?`${added.length-heldNow.length} on the website, ${heldNow.length} waiting for the owner’s OK`:`${added.length} piece(s) added to the website.`,added.length?'ok':'bad'),
      heldNow.length?h('div',{class:'note'},h('b',{},WAITING+': '),`${heldNow.length} piece(s) stay hidden until the owner says OK: `,h('ul',{},added.filter(a=>heldNow.includes(keyOf(a.sku))).map(a=>h('li',{},(a.name||a.sku)+' ('+a.sku+')')))):null,
      held?h('div',{class:'note'},`${held} piece(s) are PENDING (saved, not on the website) because key info is missing: `,h('ul',{},toHold.map(r=>h('li',{},r.item_number+' – needs '+r.needs.join(', ')))),'Add what is missing under "Pending info".'):null,
      (()=>{const spare=[...byName.keys()].filter(k=>!used.has(k));return spare.length?note(spare.length+' uploaded photo(s) were not matched to any item: '+spare.slice(0,15).join(', ')+(spare.length>15?'…':''),'bad'):null})(),
      missing.length?h('details',{},h('summary',{},`${missing.length} photo name(s) in the sheet were not uploaded`),h('ul',{},missing.map(f=>h('li',{class:'bad-text'},f)))):null,
      failed.length?h('details',{open:true},h('summary',{},`${failed.length} not added`),h('ul',{},failed.map(f=>h('li',{class:'bad-text'},f)))):null].filter(Boolean));
    /* 11-18: a finished upload clears its photos and spreadsheet, so the same batch can't be uploaded twice by accident
       (kept when nothing went through, so she can fix and try again) */
    if(added.length||held){photoList=[];syncPhotoInput();renderPhotos();csvFile.value='';csvFile.dispatchEvent(new Event('change',{bubbles:true}));
      out.append(note('Done: the photos and the spreadsheet were cleared for the next upload.','ok'))}
  }catch(e){say(e.message,'bad')}
  finally{btn.disabled=false}
};

if(window.TKAdmin){window.TKAdmin.tabs.weekly=function(){show(overview)};}
window.TKFE={show,overview,findEdit,changeMany,photoSizes};
})();
/* drag & drop onto the photo and CSV boxes */
(function(){
  const st=document.createElement('style');
  st.textContent='.dz{position:relative;text-align:center;background:#fff!important;border:2px dashed #d9b3c4;border-radius:14px!important;padding:22px 16px 18px!important;transition:background .15s,border-color .15s,box-shadow .15s}\n.dz::before{content:\'\';display:block;width:44px;height:44px;margin:0 auto 8px;border-radius:50%;background:#fde8f1 url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23d63a78\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M12 16V5M7 9l5-5 5 5M5 19h14\'/%3E%3C/svg%3E") center/22px no-repeat}\n.dz:hover{border-color:#e07aa3}\n.dz.over{background:#fff5f9!important;border-color:#f04e8a;border-style:solid;box-shadow:0 0 0 4px rgba(240,78,138,.15)}\n.dz #csvPreview{text-align:left;background:#f9f3f5;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}\n.dz .dz-hint{font-size:13px;color:#8a6b78;margin:8px 0 0}\n.dz.over .dz-hint{color:#d63a78;font-weight:600}';
  document.head.appendChild(st);
  function wire(input,btnId,accept,hint){
    const box=document.getElementById(btnId).closest('.demo-box');
    box.classList.add('dz');
    const p=document.createElement('p');p.className='dz-hint';p.textContent=hint;
    document.getElementById(btnId).after(p);
    ['dragenter','dragover'].forEach(e=>box.addEventListener(e,ev=>{ev.preventDefault();box.classList.add('over');}));
    ['dragleave','dragend'].forEach(e=>box.addEventListener(e,()=>box.classList.remove('over')));
    box.addEventListener('drop',ev=>{
      ev.preventDefault();box.classList.remove('over');
      if(input.multiple){
        // grab every entry SYNCHRONOUSLY (the drop data vanishes after the first await), then walk folders + files together
        const dt=ev.dataTransfer,items=[...(dt.items||[])].filter(i=>i.kind==='file');
        const ents=items.map(i=>({entry:i.webkitGetAsEntry?i.webkitGetAsEntry():null,file:i.getAsFile()}));
        const plain=[...dt.files];
        (async()=>{
          const got=[];
          const readAll=rd=>new Promise((ok,bad)=>{const acc=[];const go=()=>rd.readEntries(b=>{if(!b.length)ok(acc);else{acc.push(...b);go()}},bad);go()});
          const walk=async en=>{if(en.isFile)got.push(await new Promise((ok,bad)=>en.file(ok,bad)));else if(en.isDirectory){for(const e of await readAll(en.createReader()))await walk(e)}};
          p.textContent='Reading dropped items…';
          try{
            if(ents.length){for(const x of ents){if(x.entry)await walk(x.entry);else if(x.file)got.push(x.file)}}
            else got.push(...plain);
          }catch(e){p.textContent='Could not read that folder: '+e.message;return}
          const imgs=got.filter(accept);
          if(!imgs.length){p.textContent=got.length?'No photos found in what you dropped ('+got.length+' file(s), none are images).':'Nothing readable came through from that drop. Use the Upload a folder button instead.';return}
          window.TKPhotoAdd(imgs);p.textContent=hint;
        })();
        return;
      }
      let all=[...ev.dataTransfer.files];if(!all.length)all=[...(ev.dataTransfer.items||[])].map(i=>i.kind==='file'?i.getAsFile():null).filter(Boolean);
      const files=all.filter(accept);
      if(!files.length){if(!all.length){p.textContent='Nothing came through from that drop (files that only live online, e.g. in OneDrive, can’t be dragged). Download the file to this device first, or press the Upload button and choose it.';return;}p.textContent='"'+all.map(f=>f.name).join(', ')+'" isn’t a '+(input.multiple?'photo':'spreadsheet')+' file. Photos go in the Photos step, the .xlsx/.csv in the Spreadsheet step.';return;}
      if(input.multiple){window.TKPhotoAdd(files);p.textContent=hint;return}
      const dt=new DataTransfer();[files[0]].forEach(f=>dt.items.add(f));
      input.files=dt.files;input.dispatchEvent(new Event('change'));p.textContent=hint;
    });
  }
  wire(document.getElementById('photoFiles'),'choosePhotos',f=>f.type.startsWith('image/')||/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(f.name),'or drag and drop photos here');
  wire(document.getElementById('csvFile'),'chooseCsv',f=>/\.(xlsx|xlsm|xls|csv|tsv|txt)$/i.test(f.name)||/csv|spreadsheet|excel|ms-excel|text\/plain/i.test(f.type),'or drag and drop your spreadsheet (.xlsx or .csv) here');
  window.addEventListener('dragover',e=>e.preventDefault());
  window.addEventListener('drop',e=>e.preventDefault());
})();
/* step-by-step wizard for Create a batch: Details -> Photos -> Spreadsheet -> Review & upload */
(function(){
  const create=document.getElementById('create');if(!create||!window.TKWU)return;
  const {h,note,b64,uploadPhoto}=window.TKWU;
  const wrap=create.querySelector('div[style*="max-width"]');
  const labels=[...create.querySelectorAll('label')];
  const boxes=[...create.querySelectorAll('.demo-box')];
  if(boxes.length<2||!document.getElementById('importBtn'))return;
  const importBtn=document.getElementById('importBtn'),importOut=document.getElementById('importOut');
  const photoFiles=document.getElementById('photoFiles'),csvFile=document.getElementById('csvFile');
  const st=document.createElement('style');
  st.textContent='.wiz-bar{display:flex;gap:6px;margin:14px 0 18px}.wiz-bar span{flex:1;text-align:center;font-size:12px;padding:8px 4px;border-radius:999px;background:#f3e9ee;color:#8a6b78}.wiz-bar span.on{background:#f04e8a;color:#fff;font-weight:700}.wiz-bar span.done{background:#fde8f1;color:#d63a78}.wiz-nav{display:flex;gap:10px;margin-top:16px}.wiz-nav .btn{flex:1}.wiz-sum{background:#fff5f9;border-radius:12px;padding:12px 14px;margin-bottom:6px}.wiz-sum p{margin:4px 0}';
  document.head.appendChild(st);
  const names=['Photo and spreadsheet','Validation','Upload'];
  const bar=document.createElement('div');bar.className='wiz-bar';
  const head=document.createElement('h3');head.style.margin='0 0 8px';
  const sum=document.createElement('div');sum.className='wiz-sum';
  const err=document.createElement('p');err.className='pub-msg bad';err.hidden=true;
  const back=document.createElement('button');back.type='button';back.className='btn ghost';back.textContent='← Back';
  const next=document.createElement('button');next.type='button';next.className='btn';next.textContent='Next →';
  const nav=document.createElement('div');nav.className='wiz-nav';nav.append(back,next);nav.hidden=true;
  wrap.prepend(bar,head);
  importBtn.before(sum);wrap.append(err,nav);
  importBtn.style.marginTop='0';
  const spans=names.map((n,i)=>{const s=document.createElement('span');s.textContent=(i+1)+'. '+n;s.tabIndex=0;s.setAttribute('role','button');s.style.cursor='pointer';s.onclick=()=>{step=i;render();window.scrollTo(0,0)};s.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();s.click()}};bar.append(s);return s});
  const tip=document.createElement('p');tip.className='dz-hint';tip.textContent='Tip: add a "Photos" column listing each item\'s photo file names, separated by commas (e.g. front.jpg, back.jpg). One photo can be listed for several items. Without that column, photos are matched by item number (T2261100a.jpg).';
  wrap.append(tip);
  const titles=['Step 1: Add the photos and the spreadsheet, then check they match','Step 2: Validation. Look over each item, fix anything, then approve','Step 3: Review and upload'];

  /* ---- Check match: compares the spreadsheet with the photos ---- */
  const grid=boxes[0].parentElement;grid.classList.add('cm-grid');
  const mid=document.createElement('div');mid.className='cm-mid';
  const checkBtn=document.createElement('button');checkBtn.type='button';checkBtn.className='btn';checkBtn.id='checkMatch';checkBtn.textContent='⇄ Check match';
  const midNote=document.createElement('p');midNote.className='muted';midNote.textContent='Do the photos and spreadsheet match?';
  const infoBtn=document.createElement('button');infoBtn.type='button';infoBtn.className='btn cm-info';infoBtn.textContent='Info Missing';infoBtn.onclick=()=>checkOut.scrollIntoView({behavior:'smooth',block:'start'});
  const midCore=document.createElement('div');midCore.className='cm-core';midCore.append(midNote,checkBtn);mid.append(infoBtn,midCore);boxes[0].after(mid);
  const checkOut=document.createElement('div');checkOut.id='checkOut';checkOut.setAttribute('role','status');checkOut.setAttribute('aria-live','polite');grid.after(checkOut);
  const anywayBtn=document.createElement('button');anywayBtn.type='button';anywayBtn.className='btn ghost';anywayBtn.style.cssText='width:100%;max-width:440px;margin-top:8px';
  anywayBtn.textContent='Import anyway: problem items stay pending (not on the website)';importBtn.after(anywayBtn);
  const cmAct=document.createElement('div');cmAct.className='cm-actions';
  const issueBtn=document.createElement('button');issueBtn.type='button';issueBtn.className='btn cm-issue';issueBtn.hidden=true;
  const approveBtn=document.createElement('button');approveBtn.type='button';approveBtn.className='btn cm-approve';approveBtn.textContent='Approve';approveBtn.disabled=true;
  cmAct.append(issueBtn,approveBtn);mid.append(cmAct);
  let checkProblems=false,checkClean=false,checkSeq=0,issueCount=0;
  const nk=s=>String(s||'').replace(/^.*[\\/]/,'').replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const keyOf2=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const pkey=n=>{const m=nk(n).match(/^(.*\d)([a-z])(\d?)$/);return m?m[1]:nk(n)};
  function lock(){importBtn.disabled=!checkClean;infoBtn.disabled=!checkProblems;infoBtn.title=checkProblems?'Jump to what is missing':'Nothing missing so far';
    issueBtn.hidden=!checkProblems;issueBtn.textContent='⚠ Data issue: '+issueCount+' thing'+(issueCount===1?'':'s')+' not matching';
    approveBtn.disabled=!checkClean;approveBtn.textContent=checkClean?'✓ Approve':'Approve';anywayBtn.hidden=step!==2||!checkProblems}
  function resetCheck(){lastRows=[];checkSeq++;checkClean=false;checkProblems=false;issueCount=0;checkOut.replaceChildren();catBox.replaceChildren();catBox.hidden=true;lock()}
  const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';

  /* ---- Categories in this batch (11-18): each category name from the sheet that isn't an exact match to the website's
     categories is asked ONCE: use an existing category, make a new sub-category, or make a new main category. Its pieces
     wait until it is answered. The owner's answer is remembered on the server (admin/pieces/category-names); a worker's
     answer (existing categories only) is kept for this batch and sent with each read of the sheet. ---- */
  const staffNow=()=>!!(window.TKAdmin&&window.TKAdmin.isStaff&&window.TKAdmin.isStaff());
  const catAnswers=window.TKCatAnswers=window.TKCatAnswers||new Map();
  const catBox=h('div',{id:'catQs',class:'catq-box',role:'region','aria-label':'Categories in this batch'});catBox.hidden=true;
  checkOut.before(catBox);
  let cqSeq=0;
  const opt=(o,label,sel)=>{const e=h('option',{value:o},label??o);if(sel)e.selected=true;return e};
  /* q = {text, guess:{main,sub}, new_sub, new_main, action?}: the three choices; onUse({action, main, sub}) */
  function catChoices(q,tree,canMake,onUse,label){
    const name='catq'+(++cqSeq),mains=Object.keys(tree||{}),g=q.guess||{};
    const radio=v=>h('input',{type:'radio',name,value:v,class:'catq-radio'});
    const rEx=radio('existing'),rSub=radio('new_sub'),rMain=radio('new_main'),radios=[rEx,rSub,rMain];
    const pick=v=>radios.forEach(r=>{r.checked=r.value===v});
    const mainSel=h('select',{class:'catq-main','aria-label':'Main category'},opt('','Pick a main category…'),mains.map(m=>opt(m,m,m===g.main)));
    const subSel=h('select',{class:'catq-sub','aria-label':'Sub-category'});
    const fillSubs=keep=>subSel.replaceChildren(opt('','(no sub-category)'),...((tree||{})[mainSel.value]||[]).map(s=>opt(s,s,s===keep)));
    fillSubs(g.sub||'');
    mainSel.onchange=()=>{fillSubs('');pick('existing')};subSel.onchange=()=>pick('existing');
    const underSel=h('select',{class:'catq-under','aria-label':'Main category for the new sub-category'},mains.map(m=>opt(m,m,m===(g.main||mains[0]))));
    underSel.onchange=()=>pick('new_sub');
    const line=(r,...kids)=>h('div',{class:'catq-opt'},h('label',{class:'catq-lab'},r,h('span',{},kids[0])),...kids.slice(1));
    const lines=[line(rEx,'Use an existing category',h('div',{class:'catq-sels'},mainSel,subSel))];
    if(canMake){
      lines.push(line(rSub,`Make a new sub-category “${q.new_sub}” under`,h('div',{class:'catq-sels'},underSel)));
      lines.push(line(rMain,`Make a new main category “${q.new_main}”`));
    }else lines.push(h('p',{class:'muted catq-small'},'Only the owner can make a new category: pick one of the website’s categories.'));
    pick(canMake&&(q.action==='new_sub'||q.action==='new_main')?q.action:'existing');
    const msg=h('span',{class:'catq-msg',role:'status','aria-live':'polite'});
    const go=h('button',{type:'button',class:'btn small catq-use'},label||'Use this for all of them');
    go.onclick=async()=>{
      const v=(radios.find(r=>r.checked)||rEx).value;
      const a=v==='existing'?{action:v,main:mainSel.value,sub:subSel.value}:v==='new_sub'?{action:v,main:underSel.value,sub:q.new_sub}:{action:v,main:q.new_main,sub:''};
      if(!a.main){msg.textContent='Pick a main category first.';mainSel.focus();return}
      go.disabled=true;msg.textContent='Saving…';
      try{await onUse(a)}catch(e){msg.textContent=e.message;go.disabled=false}};
    return h('div',{class:'catq-choices'},lines,h('div',{class:'catq-go'},go,msg));
  }
  const whereTo=c=>c.action==='new_main'?`a new main category “${c.main}”`:(c.main+(c.sub?' / '+c.sub:'')+(c.action==='new_sub'?' (new sub-category)':''));
  async function answerCat(q,a){
    if(!staffNow()){await window.TKAdmin.api('admin/pieces/category-names',{method:'POST',body:{text:q.text,...a}});loadNames()}
    catAnswers.set(q.key,a);await runCheck();
  }
  function renderCats(r){
    const qs=r.category_questions||[],done=r.category_choices||[],tree=r.site_categories||{},can=!!r.can_make_categories;
    if(!qs.length&&!done.length){catBox.replaceChildren();catBox.hidden=true;return}
    const kids=[h('h3',{class:'catq-title'},'Categories in this batch')];
    if(qs.length)kids.push(h('p',{class:'muted catq-lead'},`Your sheet uses ${qs.length===1?'a category name':qs.length+' category names'} the website doesn’t have. Choose where ${qs.length===1?'it goes':'each one goes'}: those pieces wait until you answer.`+(can?' Your answer is remembered for next time.':'')));
    for(const q of qs)kids.push(h('div',{class:'catq','data-key':q.key},h('p',{class:'catq-q'},h('b',{},`Your sheet says “${q.text}”: ${q.count} piece${q.count===1?'':'s'}`)),catChoices(q,tree,can,a=>answerCat(q,a))));
    for(const c of done){
      const row=h('div',{class:'catq catq-done','data-key':c.key});
      const show=()=>row.replaceChildren(h('p',{class:'catq-q'},'✓ “'+c.text+'” ('+c.count+' piece'+(c.count===1?'':'s')+') → ',h('b',{},whereTo(c)),h('span',{class:'muted'},c.remembered?' · remembered':' · this batch'),' ',
        h('button',{type:'button',class:'link catq-change',onclick:()=>row.replaceChildren(h('p',{class:'catq-q'},h('b',{},`Your sheet says “${c.text}”: ${c.count} piece${c.count===1?'':'s'}`)),
          catChoices({...c,guess:{main:c.main,sub:c.sub}},tree,can,a=>answerCat(c,a)),h('button',{type:'button',class:'link',onclick:show},'Keep it as it was'))},'Change')));
      show();kids.push(row);
    }
    catBox.replaceChildren(...kids);catBox.hidden=step!==0;
  }
  /* "Category names remembered": the owner's answers, with Change / Forget */
  const namesBox=h('details',{id:'catNames',class:'catn-box'},h('summary',{},'Category names remembered'));
  const namesBody=h('div',{class:'catn-body'});namesBox.append(namesBody);
  catBox.after(namesBox);
  namesBox.addEventListener('toggle',()=>{if(namesBox.open)loadNames()});
  async function loadNames(){
    if(staffNow()||!namesBox.open)return;
    namesBody.replaceChildren(note('Loading…'));
    try{
      const d=await window.TKAdmin.api('admin/pieces/category-names');
      const list=d.names||[],tree=d.site_categories||{};
      if(!list.length){namesBody.replaceChildren(h('p',{class:'muted'},'None yet. When a sheet’s category name isn’t on the website, your answer to it is kept here.'));return}
      const again=()=>{loadNames();if(csvFile.files[0]&&photoFiles.files.length)runCheck()};
      namesBody.replaceChildren(h('ul',{class:'catn-list'},list.map(n=>{
        const li=h('li',{class:'catn','data-key':n.key});
        const show=()=>li.replaceChildren(h('span',{class:'catn-text'},'“'+n.text+'” → ',h('b',{},whereTo(n)),n.on_site?'':h('span',{class:'muted'},' (not on the website yet)')),
          h('span',{class:'catn-acts'},h('button',{type:'button',class:'link catn-change',onclick:()=>li.replaceChildren(h('p',{class:'catq-q'},h('b',{},'“'+n.text+'”')),
              catChoices({...n,guess:{main:n.main,sub:n.sub}},tree,true,async a=>{await window.TKAdmin.api('admin/pieces/category-names',{method:'POST',body:{text:n.text,...a}});catAnswers.delete(n.key);again()},'Save'),
              h('button',{type:'button',class:'link',onclick:show},'Cancel'))},'Change'),
            h('button',{type:'button',class:'link catn-forget',onclick:async e=>{e.target.disabled=true;try{await window.TKAdmin.api('admin/pieces/category-names',{method:'POST',body:{text:n.text,forget:true}});catAnswers.delete(n.key);again()}catch(x){e.target.disabled=false;li.append(h('span',{class:'bad-text'},' '+x.message))}}},'Forget')));
        show();return li})));
    }catch(e){namesBody.replaceChildren(note('Could not load them: '+e.message,'bad'))}
  }

  async function runCheck(){
    const my=++checkSeq,file=csvFile.files[0],pics=[...photoFiles.files];
    checkClean=false;checkProblems=false;lock();
    if(!file){checkOut.replaceChildren(note('Add the spreadsheet first, then check (photos can come later).','bad'));return}
    if(!window.TKAdmin){checkOut.replaceChildren(note('Still signing in. Try again in a moment.','bad'));return}
    checkBtn.disabled=true;checkOut.replaceChildren(note('Checking…'));
    try{
      const r=await window.TKAdmin.api('admin/pieces/sheet',{method:'POST',body:{name:file.name,data:await b64(file),category_answers:Object.fromEntries(catAnswers)}});
      if(my!==checkSeq)return;
      if(r.kind==='consignors'){checkClean=true;checkOut.replaceChildren(note('This is a consignor workbook: there are no photos to match here. Go ahead and import.','ok'));lock();return}
      renderCats(r);
      const groups=new Map(),byName=new Map();
      for(const f of pics){const k=pkey(f.name);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);byName.set(nk(f.name),f)}
      const used=new Set(),issues=[],rowsOut=[],seen=new Map();let ready=0,blockers=0;lastRows=[];   // 11-18: only a duplicate item number or a missing category blocks; missing photos/details are warnings (those rows wait in Pending info)
      for(const row of r.rows){
        const id=row.item_number||row.name||'(row)',probs=[];
        if(row.item_number){const k=keyOf2(row.item_number);if(seen.has(k)){probs.push('duplicate item number (also used by '+seen.get(k)+')');blockers++}else seen.set(k,id)}
        for(const x of (row.problems||[]))probs.push(String(x).replace(/\.$/,''));
        if(!row.name||String(row.name).trim().length<3)probs.push('missing name');
        if(!(Number(row.price)>0)&&!probs.some(x=>/price/i.test(x)))probs.push('missing or bad price');
        if(!row.main_category&&!row.category_question){probs.push('missing category');blockers++}
        let list=[];
        if(row.photos_named&&row.photos_named.length){
          for(const w of row.photos_named){const k=nk(w),hit=byName.get(k);if(hit){used.add(k);list.push(hit)}else probs.push('photo "'+w+'" listed in the sheet was not uploaded')}
        }
        if(!list.length)list=groups.get(keyOf2(row.photo_key||row.item_number))||[];
        list.forEach(f=>used.add(nk(f.name)));
        if(!list.length&&!probs.some(x=>/photo/.test(x)))probs.push('no photo');
        const note1=list.length===1?'only 1 photo':'';
        if(!probs.length)ready++;
        rowsOut.push({id,name:row.name||'',probs,photos:list.length,note1});lastRows.push({row,id,probs,files:list});
        probs.forEach(x=>issues.push({kind:'Row without photo or details',who:id,what:x}));
      }
      const spare=[...byName.keys()].filter(k=>!used.has(k));
      spare.forEach(k=>issues.push({kind:'Photo with no row',who:byName.get(k).name,what:'not in the spreadsheet'}));
      const total=rowsOut.length,bad=total-ready,single=rowsOut.filter(x=>x.note1&&!x.probs.length).length;
      const nq=(r.category_questions||[]).length;
      checkProblems=issues.length>0;checkClean=!blockers&&!nq;issueCount=issues.length;
      const waiting=total-ready,noPics=!pics.length;
      const sumEl=note(!issues.length?`✓ All ${total} products have details and photos, and every photo is used. Good to import.`
        :checkClean?`✓ You can continue. ${ready} of ${total} product${total===1?'':'s'} go on the website now; ${waiting} will wait in Pending info until ${noPics?'their photos are added':'what is missing below is added'} (nothing is lost).${noPics?' No photos were added.':''}`
        :`${ready} of ${total} products ready. ${blockers?blockers+' item'+(blockers===1?'':'s')+' must be fixed first (duplicate item number or no category).':''}`,!issues.length?'ok':checkClean?'warn':'bad');
      const kids=[sumEl];
      if(nq)kids.push(note(`Answer the ${nq===1?'category question':nq+' category questions'} under “Categories in this batch” first: ${rowsOut.filter((x,i)=>lastRows[i].row.category_question).length} piece(s) wait for ${nq===1?'it':'them'}.`,'bad'));
      if(issues.length){
        const rows=issues.map(i=>h('tr',{},h('td',{},i.who),h('td',{},i.what)));
        kids.push(h('div',{style:'overflow-x:auto;max-height:300px;overflow:auto;margin-top:8px'},h('table',{class:'table'},h('thead',{},h('tr',{},h('th',{},'Item / photo'),h('th',{},'Problem'))),h('tbody',{},rows))));
        kids.push(h('button',{type:'button',class:'btn ghost small',style:'margin-top:8px',onclick:()=>{
          const csv=['Type,Item or photo,Problem',...issues.map(i=>[i.kind,i.who,i.what].map(csvCell).join(','))].join('\r\n');
          const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='match-problems.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}},'Download problem list (CSV)'));
      }
      if(single)kids.push(h('p',{class:'muted'},`${single} product${single===1?' has':'s have'} only 1 photo (not a problem, just so you know).`));
      /* the server filed a category or picked an item number for these (e.g. "Jacket/ Casual" -> Coats and Jackets / Others): not problems, worth a look */
      const sorted=(r.rows||[]).filter(x=>x.notes&&x.notes.length);
      if(sorted.length)kids.push(h('details',{style:'margin-top:8px'},h('summary',{},`${sorted.length} item${sorted.length===1?'':'s'}: category or item number sorted out from the sheet (not a problem, check if you like)`),
        h('ul',{},sorted.map(x=>h('li',{},(x.item_number||x.name||'(row)')+(x.site_category?' → '+x.site_category:'')+': '+x.notes.join(' '))))));
      checkOut.replaceChildren(...kids);lock();
    }catch(e){if(my===checkSeq)checkOut.replaceChildren(note('Could not check: '+e.message,'bad'))}
    finally{checkBtn.disabled=false}
  }
  checkBtn.onclick=runCheck;
  issueBtn.onclick=()=>checkOut.scrollIntoView({behavior:'smooth',block:'start'});
  approveBtn.onclick=()=>{if(!checkClean)return;step=1;render();importBtn.disabled=false;importBtn.hidden=false;window.scrollTo(0,0)};
  anywayBtn.onclick=()=>{importBtn.disabled=false;importBtn.click()};
  let autoT;const autoCheck=()=>{resetCheck();clearTimeout(autoT);autoT=setTimeout(()=>{if(csvFile.files[0])runCheck()},900)};   // photos are optional (11-18)
  csvFile.addEventListener('change',autoCheck);photoFiles.addEventListener('change',autoCheck);
  document.getElementById('photoFolder')?.addEventListener('change',autoCheck);
  new MutationObserver(autoCheck).observe(document.getElementById('photoPreview'),{childList:true});
  /* ---- Validation step: every item in the batch with its photos; edit price/name/etc. and change photos ---- */
  let lastRows=[];
  const edits=window.TKBatchEdits=new Map();
  const valSec=document.createElement('div');valSec.id='valSec';valSec.hidden=true;
  grid.after(valSec);
  const ek=r=>keyOf2(r.item_number||r.name);
  function renderVal(){
    if(!lastRows.length){valSec.replaceChildren(note(csvFile.files[0]?'Press Check match on step 1 first so the items can be read.':'Add the photos and the spreadsheet on step 1 first.','bad'));return}
    const rows=lastRows.map(x=>{
      const r=x.row,k=ek(r),ed=edits.get(k)||{fields:{},files:null};edits.set(k,ed);
      const val=f=>ed.fields[f]!==undefined?ed.fields[f]:(r[f]??'');
      const files=ed.files&&ed.files.length?ed.files:x.files;
      const th=h('div',{class:'val-thumbs'},files.slice(0,4).map(f=>h('img',{class:'pub-thumb',alt:'',src:URL.createObjectURL(f)})),files.length>4?h('span',{class:'muted'},'+'+(files.length-4)):null,!files.length?h('span',{class:'muted'},'no photo'):null);
      const pick=h('input',{type:'file',accept:'image/*',multiple:true,hidden:true});
      pick.onchange=()=>{const fs=[...pick.files];if(!fs.length)return;ed.files=fs;fs.forEach(f=>{try{uploadPhoto(f).catch(()=>{})}catch{}});renderVal()};
      const inp=(f,w,type)=>{const i=h('input',{type:type||'text',value:val(f),style:'width:'+w});i.oninput=()=>{ed.fields[f]=type==='number'?(i.value===''?'':Number(i.value)):i.value;stat()};return i};
      const chip=h('span',{class:'pub-chip'});
      const stat=()=>{const miss=[];if(String(val('name')).trim().length<3)miss.push('name');if(!(Number(val('price'))>0))miss.push('price');if(!val('main_category'))miss.push('category');if(!files.length)miss.push('photo');chip.textContent=miss.length?'Missing: '+miss.join(', '):'Ready';chip.className='pub-chip '+(miss.length?'bad':'ok')};
      stat();
      const asSheet=ed.fields.main_category===undefined,small=t=>h('div',{class:'muted',style:'font-size:12px;max-width:220px'},t);
      return h('tr',{},h('td',{},th,h('button',{type:'button',class:'btn ghost small',onclick:()=>pick.click()},'Change photos'),pick),h('td',{},x.id),h('td',{},inp('name','180px')),h('td',{},inp('price','80px','number')),h('td',{},inp('size','60px')),
        h('td',{},inp('main_category','120px'),asSheet&&r.site_category?small('On the site: '+r.site_category):null,asSheet&&r.category_note?small(r.category_note):null),h('td',{},chip));
    });
    const nEd=[...edits.values()].filter(e=>Object.keys(e.fields).length||(e.files&&e.files.length)).length;
    valSec.replaceChildren(note(`${lastRows.length} item${lastRows.length===1?'':'s'} in this batch.`+(nEd?` ${nEd} edited here; edits are used when you upload.`:' Change a photo, price, name, size or category here if needed.')),
      h('div',{style:'overflow-x:auto;margin-top:8px'},h('table',{class:'table'},h('thead',{},h('tr',{},['Photos','Item','Name','Price','Size','Category','Status'].map(t=>h('th',{},t)))),h('tbody',{},rows))),
      h('button',{type:'button',class:'btn',style:'margin-top:12px',onclick:()=>{step=2;render();window.scrollTo(0,0)}},'Continue to Upload →'));
  }
  let step=0;
  function render(){
    labels.forEach(l=>l.hidden=true);
    boxes[0].hidden=boxes[1].hidden=mid.hidden=checkOut.hidden=cmAct.hidden=step!==0;valSec.hidden=step!==1;if(step===1)renderVal();
    catBox.hidden=step!==0||!catBox.childElementCount;namesBox.hidden=step!==0||staffNow();
    sum.hidden=importBtn.hidden=step!==2;anywayBtn.hidden=step!==2||!checkProblems;
    importOut.hidden=step!==2;
    importBtn.disabled=!checkClean;
    head.textContent=titles[step];tip.hidden=step!==0;
    spans.forEach((s,i)=>s.className=i===step?'on':i<step?'done':'');
    back.hidden=step===0;next.hidden=step===2;err.hidden=true;
    if(step===2){
      const np=photoFiles.files.length;
      sum.replaceChildren(...[`Week ${document.getElementById('batchWeek').value} · ${document.getElementById('batchDay').value} · ${document.getElementById('batchDate').value}`,`${np} photo${np===1?'':'s'}`,csvFile.files[0]?csvFile.files[0].name:''].map(t=>{const p=document.createElement('p');p.textContent=t;return p}));
    }
  }
  next.onclick=()=>{
    if(step===1&&!photoFiles.files.length){err.textContent='Add at least one photo to continue.';err.hidden=false;return}
    if(step===1&&!csvFile.files[0]){err.textContent='Add the spreadsheet to continue.';err.hidden=false;return}
    step++;render();window.scrollTo(0,0);
  };
  back.onclick=()=>{step--;render()};
  document.getElementById('newBatch').addEventListener('click',()=>{step=0;catAnswers.clear();importOut.replaceChildren();resetCheck();render()});
  importBtn.textContent='Upload to web';
  resetCheck();render();
})();

/* ---- Hub cards: one card per task ---- */
(function(){
const ov=document.getElementById('overview');if(!ov||document.getElementById('hubCards'))return;
const cards=[['➕','Upload','Add photos and a spreadsheet','newBatch'],['🛍️','Pending info','Fill in missing info, then publish','openPublish'],['✏️','Find & edit','Search items and orders, change prices, photos, consignment and shipping','openFindEdit'],['🧺','Change many','Look at many pieces as photos and fix their categories, sizes and more at once','openChangeMany'],['↩️','Return an item','Relist a sold or returned piece','openReturns'],['🔎','Item search','Find an item by number and mark it sold','openItemSearch'],['🗂️','Weeks','See each week\'s uploads and approve them','tabBatches'],['📊','Weekly sales','Sold items, amounts and customer cuts','openSalesLog'],['✅','Task list','Memos and what needs doing, with checkpoints','openTasks'],['🗑️','Recently deleted','Deleted pieces wait 30 days: put one back or delete it for good','openTrash']];
const grid=document.createElement('div');grid.id='hubCards';grid.className='hub-cards';
cards.forEach(([ico,t,sub,target])=>{const b=document.createElement('button');b.type='button';b.className='hub-card';b.dataset.target=target;
b.innerHTML='<span class="hub-ico" aria-hidden="true">'+ico+'</span><strong>'+t+'</strong><span class="hub-sub">'+sub+'</span><span class="hub-go">Open →</span>';
b.onclick=()=>{if(target==='openTrash'){window.TKWU?.openTrash?.();return}if(target==='tabBatches'){const pw=document.getElementById('pastWeeks');if(pw){pw.hidden=!pw.hidden;b.querySelector('.hub-go').textContent=pw.hidden?'Open →':'Close ↑';if(!pw.hidden)pw.scrollIntoView({behavior:'smooth',block:'nearest'})}return}document.getElementById(target)?.click()};grid.appendChild(b)});
const intro=ov.querySelector('.intro');intro?intro.after(grid):ov.prepend(grid);
/* A worker's Find & edit card says only what their switches allow. */
const feSub=()=>{const sub=grid.querySelector('[data-target="openFindEdit"] .hub-sub');if(!sub)return;if(sub.dataset.owner==null)sub.dataset.owner=sub.textContent;const W=window.TKAdmin;
  sub.textContent=W&&W.isStaff()?'Find a piece and fix its '+(W.can('price')?'details, photos and price':'details and photos'):sub.dataset.owner};
document.addEventListener('tk-role',feSub);feSub();
/* Past weeks (every week heading after the first, with its batch cards) live inside the Weeks card's panel. */
(function(){const heads=[...ov.querySelectorAll('.weekhead')];
const pw=document.createElement('div');pw.id='pastWeeks';pw.hidden=true;pw.style.cssText='margin:0 0 18px';
const t=document.createElement('p');t.className='eyebrow';t.textContent='Past weeks';pw.appendChild(t);
heads.slice(1).forEach(h=>{let el=h;const group=[h];while((el=el.nextElementSibling)&&el.classList.contains('batch'))group.push(el);group.forEach(n=>pw.appendChild(n))});
if(heads.length<2){const e=document.createElement('p');e.className='muted';e.textContent='No earlier weeks yet.';pw.appendChild(e)}
grid.after(pw)})();
})();

/* Week number + running count of pieces uploaded this week, shown next to the "Weekly uploads" heading. */
(function(){
  function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));return [t.getUTCFullYear(),Math.ceil((((t-new Date(Date.UTC(t.getUTCFullYear(),0,1)))/86400000)+1)/7)]}
  /* Keep the current-week section (heading, card labels, review buttons) on today's calendar week. */
  (function(){const wk=isoWeek(new Date())[1],h=[...document.querySelectorAll('#overview .weekhead h2')].find(x=>!x.closest('#pastWeeks'));if(!h)return;h.textContent='Week '+wk;
    {const mon=new Date();mon.setHours(12,0,0,0);mon.setDate(mon.getDate()-((mon.getDay()+6)%7));const di={Monday:0,Tuesday:1,Wednesday:2};
      document.querySelectorAll('#overview .batch:not(#pastWeeks .batch) .day-row').forEach(row=>{const st=row.firstElementChild,o=di[st.textContent.trim()];if(o===undefined||row.querySelector('.day-date'))return;const d=new Date(mon);d.setDate(mon.getDate()+o);
        const em=document.createElement('em');em.className='day-date';em.textContent=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});st.after(em)})}
    let el=h.closest('.weekhead').nextElementSibling;
    while(el&&el.classList.contains('batch')){const e=el.querySelector('.eyebrow');if(e)e.textContent='Week '+wk;const r=el.querySelector('.review-btn');if(r)r.dataset.week=wk;el=el.nextElementSibling}})();
  const h1=document.querySelector('.intro h1');if(!h1)return;
  const tag=document.createElement('span');tag.id='weekCount';tag.className='muted';tag.style.cssText='font-size:.5em;font-weight:600;margin-left:14px;vertical-align:middle;white-space:nowrap';h1.appendChild(tag);
  const may=()=>{const W=window.TKAdmin;return !!(W&&W.session&&(!W.isStaff()||W.can('post')))};   /* a worker without Add pieces has no week counts; nobody has them before sign-in */
  async function refresh(){
    if(!may())return;
    const now=new Date(),[yr,wk]=isoWeek(now);let n=null;
    try{const r=await window.TKAdmin.api('admin/pieces/uploaded');n=(r.added||[]).filter(t=>{const d=new Date(t);if(isNaN(d))return false;const [y,w]=isoWeek(d);return y===yr&&w===wk}).length}catch(e){}
    try{let r={items:[]};try{r=await window.TKAdmin.api('admin/pieces/uploaded')||r}catch(e){}const days={};
      (r.items||[]).forEach(i=>{const d=new Date(i.t);if(isNaN(d))return;const [y,w]=isoWeek(d);if(y!==yr||w!==wk)return;const k=d.getDay();(days[k]=days[k]||{p:0,i:0});days[k].p++;days[k].i+=i.images||0;(days[k].items=days[k].items||[]).push(i)});
      const idx={Monday:1,Tuesday:2,Wednesday:3};
      document.querySelectorAll('#overview .batch:not(#pastWeeks .batch) .day-row').forEach(row=>{const k=idx[row.firstElementChild.textContent.trim()];if(!k)return;const v=days[k]||{p:0,i:0},sp=row.querySelectorAll('span');
        sp[0].innerHTML='<b>'+v.p+'</b> product'+(v.p===1?'':'s');sp[1].innerHTML='<b>'+v.i+'</b> image'+(v.i===1?'':'s')});
      document.querySelectorAll('#overview .batch:not(#pastWeeks .batch) .day-row').forEach(row=>{const k=idx[row.firstElementChild.textContent.trim()];if(!k||row.classList.contains('week-total'))return;
        const open=row.classList.contains('open'),old=row.nextElementSibling;if(old&&old.classList.contains('day-items'))old.remove();
        row.classList.add('clickable');row.tabIndex=0;row.setAttribute('role','button');
        const box=document.createElement('div');box.className='day-items';box.hidden=!open;const its=(days[k]||{}).items||[];
        if(!its.length)box.innerHTML='<p class="muted">Nothing uploaded this day.</p>';
        else{const g=document.createElement('div');g.className='day-grid';its.forEach(it=>{const c=document.createElement('div');c.className='day-item';
          const src=it.image?(it.local?it.image:'../../'+String(it.image).replace(/^\/+/,'')):'';
          if(src){const im=document.createElement('img');im.loading='lazy';im.alt='';im.src=src;c.appendChild(im)}
          const n=document.createElement('span');n.textContent=it.name||it.sku||'Product';c.appendChild(n);if(it.sku&&!it.local){const sk=document.createElement('small');sk.textContent=it.sku+(it.price?' · '+it.price:'');c.appendChild(sk)}g.appendChild(c)});box.appendChild(g)}
        row.after(box);
        if(!row.dataset.wired){row.dataset.wired=1;const tog=()=>{const o=row.classList.toggle('open');row.nextElementSibling.hidden=!o};row.addEventListener('click',tog);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();tog()}})}});
      let tp=0,ti=0;Object.values(days).forEach(v=>{tp+=v.p;ti+=v.i});
      const rows=document.querySelectorAll('#overview .batch:not(#pastWeeks .batch) .day-row'),last=rows[rows.length-1];
      if(last){let tr=document.getElementById('weekTotalRow');if(!tr){tr=document.createElement('div');tr.id='weekTotalRow';tr.className='day-row week-total';tr.innerHTML='<strong>Week total</strong><em class="day-date">All days</em><span></span><span></span>';last.after(tr)}
        const h3=document.querySelector('#overview .batch:not(#pastWeeks .batch) h3');if(h3){let ht=document.getElementById('weekHeadTotal');if(!ht){ht=document.createElement('span');ht.id='weekHeadTotal';ht.className='head-total';h3.appendChild(ht)}ht.textContent=tp+' product'+(tp===1?'':'s')+' · '+ti+' image'+(ti===1?'':'s')}
        const ts=tr.querySelectorAll('span');ts[0].innerHTML='<b>'+tp+'</b> product'+(tp===1?'':'s');ts[1].innerHTML='<b>'+ti+'</b> image'+(ti===1?'':'s')}}catch(e){}
    tag.textContent='Week '+wk+(n===null?'':' · '+n+' item'+(n===1?'':'s')+' uploaded so far')}
  window.TKWeekly=Object.assign(window.TKWeekly||{},{refreshWeekCount:refresh});
  refresh();document.addEventListener('tk-role',refresh);
  const prev=window.TKAdmin&&window.TKAdmin.tabs&&window.TKAdmin.tabs.weekly;if(prev)window.TKAdmin.tabs.weekly=function(){refresh();return prev.apply(this,arguments)};
  document.addEventListener('click',e=>{if(e.target.closest('#importBtn,.btn'))setTimeout(refresh,2500)});

/* ===== Find & edit: search items / orders and change them ===== */
(function(){
const $=id=>document.getElementById(id),api=(p,o)=>window.TKAdmin.api(p,o);
const isStaff=()=>window.TKAdmin.isStaff(),can=p=>window.TKAdmin.can(p),who=a=>window.TKAdmin.who(a);
const {show,overview,findEdit,photoSizes}=window.TKFE;
let mode='items';
const el=(t,a,...k)=>{const e=document.createElement(t);for(const[x,v]of Object.entries(a||{})){if(x==='class')e.className=v;else if(x.startsWith('on'))e[x]=v;else if(v!==false&&v!=null)e.setAttribute(x,v===true?'':v)}k.flat().forEach(c=>e.append(c instanceof Node?c:String(c??'')));return e};
const img=p=>{p=String(p||'');return /^https?:\/\//i.test(p)?p:new URL('../../'+p.replace(/^\/+/,''),location.href).href};
const $c=c=>c==null?'':'$'+(c/100).toFixed(2);
const msg=(t,bad)=>{const m=$('feMsg');if(m){m.textContent=t;m.className='fe-msg '+(bad?'bad':'ok')}};
$('openFindEdit').onclick=()=>{show(findEdit);if(mode==='trash')setMode('items');$('feQuery').focus();trashCount()};
$('findEditBack').onclick=()=>show(overview);
function setMode(m){mode=m;[['feModeItems','items'],['feModeOrders','orders'],['feModeTrash','trash']].forEach(([id,v])=>{const b=$(id);if(b){b.setAttribute('aria-pressed',m===v);b.classList.toggle('ghost',m!==v)}});
  $('feForm').hidden=m==='trash';
  $('feQuery').placeholder=m==='items'?'Item number, name, or something close to it':'Order number, customer name, email, phone or tracking number';
  $('feHint').textContent=m==='items'?'Type a product ID / tag, part of a name, or a rough guess. Typos are fine.':m==='orders'?'Find an order by its number, the customer, email, phone, or tracking number.':'Deleted pieces wait here for 30 days, then they are deleted for good. Put one back on the website, or keep it so it is never deleted automatically.';
  $('feResults').replaceChildren();$('feEditor').replaceChildren();if(m==='trash')loadTrash()}
$('feModeItems').onclick=()=>setMode('items');$('feModeOrders').onclick=()=>setMode('orders');if($('feModeTrash'))$('feModeTrash').onclick=()=>setMode('trash');
$('feForm').onsubmit=async e=>{e.preventDefault();const q=$('feQuery').value.trim(),box=$('feResults');$('feEditor').replaceChildren();
  if(!q){box.replaceChildren(el('p',{class:'muted'},'Type something to search.'));return}
  box.replaceChildren(el('p',{class:'muted'},'Searching…'));
  try{
    if(mode==='items'){const r=await api('admin/items/search?q='+encodeURIComponent(q));
      box.replaceChildren(...(r.items.length?r.items.map(it=>el('button',{type:'button',class:'fe-row','data-sku':it.sku,onclick:()=>openItem(it.sku)},
        it.image?el('img',{src:img(it.image),alt:'',loading:'lazy'}):el('span',{class:'fe-noimg'}),
        el('span',{class:'fe-main'},el('b',{},it.name||it.sku),el('small',{},it.sku+(!isStaff()&&it.consignor?' · '+it.consignor:'')+(it.why?' · '+it.why:''))),
        el('span',{class:'fe-side'},$c(it.price_cents),el('small',{},it.status||'')))):[el('p',{class:'muted'},'No items matched “'+q+'”. Try fewer letters.')]))}
    else{const r=await api('admin/orders/search?q='+encodeURIComponent(q));
      box.replaceChildren(...(r.orders.length?r.orders.map(o=>el('button',{type:'button',class:'fe-row',onclick:()=>openOrder(o.id)},
        el('span',{class:'fe-main'},el('b',{},o.number+' · '+(o.name||'')),el('small',{},(o.email||'')+' · '+String(o.created_at||'').slice(0,10))),
        el('span',{class:'fe-side'},$c(o.total_cents),el('small',{},o.fulfillment_status||o.status||'')))):[el('p',{class:'muted'},'No orders matched “'+q+'”.')]))}
  }catch(err){box.replaceChildren(el('p',{class:'fe-msg bad'},err.message))}};
const field=(label,name,val,o={})=>el('label',{},label,o.area?el('textarea',{name,rows:o.rows||4,maxlength:o.max},val??''):el('input',{name,type:o.type||'text',value:val??'',maxlength:o.max||200,step:o.step,min:o.min,placeholder:o.ph}));
const g=(f,n)=>f.elements[n]?f.elements[n].value.trim():'';   /* a worker's form has no price/stock boxes */
const num=(f,n)=>g(f,n)===''?null:Number(g(f,n));
async function openItem(sku){
  const ed=$('feEditor');ed.replaceChildren(el('p',{class:'muted'},'Loading '+sku+'…'));
  let it;try{it=(await api('admin/items/'+encodeURIComponent(sku))).item}catch(e){ed.replaceChildren(el('p',{class:'fe-msg bad'},e.message));return}
  const order=it.images.map(i=>i.lg).filter(Boolean),removed=new Set(),added=[];
  const f=el('form',{class:'fe-form'});
  const grid=el('div',{class:'fe-imgs'});
  const draw=()=>{grid.replaceChildren();
    order.filter(p=>!removed.has(p)).forEach((p,i,arr)=>{const th=(it.images.find(x=>x.lg===p)||{}).thumb||p;
      grid.append(el('figure',{},el('img',{src:img(th),alt:'Photo '+(i+1)}),el('figcaption',{},i===0?'Main photo':'',
        el('button',{type:'button',class:'link',disabled:i===0,'aria-label':'Move earlier',onclick:()=>{const a=order.indexOf(arr[i-1]),b=order.indexOf(p);[order[a],order[b]]=[order[b],order[a]];draw()}},'◀'),
        el('button',{type:'button',class:'link',disabled:i===arr.length-1,'aria-label':'Move later',onclick:()=>{const a=order.indexOf(arr[i+1]),b=order.indexOf(p);[order[a],order[b]]=[order[b],order[a]];draw()}},'▶'),
        el('button',{type:'button',class:'link bad',onclick:()=>{removed.add(p);draw()}},'Remove'))))});
    added.forEach((a,i)=>grid.append(el('figure',{class:'new'},el('img',{src:a.url,alt:'New photo'}),el('figcaption',{},'New',el('button',{type:'button',class:'link bad',onclick:()=>{added.splice(i,1);draw()}},'Remove')))));
    if(!grid.children.length)grid.append(el('p',{class:'muted'},'No photos.'))};
  const pick=el('input',{type:'file',accept:'image/*',multiple:true,hidden:true});
  pick.onchange=async()=>{for(const file of [...pick.files]){try{msg('Preparing '+file.name+'…');const id=(await api('admin/pieces/photo',{method:'POST',body:await photoSizes(file)})).photo.id;added.push({id,url:URL.createObjectURL(file)});draw();msg('')}catch(e){msg(file.name+': '+e.message,true)}}pick.value=''};
  const c=it.consignment,stf=isStaff(),own=stf&&!can('price')&&it.own_held===true,roPrice=stf&&!can('price')&&!own;
  const ro=(label,val)=>el('label',{},label,el('div',{class:'fe-ro'},val));
  const usd=v=>v==null||v===''?'none':'$'+Number(v).toFixed(2);
  f.append(el('div',{class:'fe-head'},el('h3',{},it.name),el('p',{class:'muted'},it.sku+' · '+it.status+' · ',el('a',{href:'../../'+it.url,target:'_blank',rel:'noopener'},'view on site'))),
    el('div',{class:'fe-grid'},field('Name','name',it.name,{max:200}),roPrice?ro('Price',usd(it.regular_price)):field('Price ($)','regular_price',it.regular_price,{type:'number',step:'0.01',min:'0'}),roPrice?ro('Sale price',usd(it.sale_price)):field('Sale price ($, blank for none)','sale_price',it.sale_price,{type:'number',step:'0.01',min:'0'}),
      field('Size','size',it.size,{max:40}),field('Color','color',it.color,{max:60}),field('Category','main_category',it.main_category,{max:80}),field('Sub-category','sub_category',it.sub_category,{max:80}),
      stf?ro('Stock',it.stock==null?'—':String(it.stock)):field('Stock','stock',it.stock,{type:'number',step:'1',min:'0'}),field('Location','location',it.location,{max:30}),field('Weight (lb)','weight_lb',it.weight_lb,{type:'number',step:'0.01',min:'0'}),
      field('Length (in)','length_in',it.length_in,{type:'number',step:'0.1',min:'0'}),field('Width (in)','width_in',it.width_in,{type:'number',step:'0.1',min:'0'}),field('Height (in)','height_in',it.height_in,{type:'number',step:'0.1',min:'0'})),
    own?el('p',{class:'muted fe-ownheld'},'You can fix the price until the owner OKs it.'):null,
    field('Details (one per line)','details',it.details,{area:true,rows:5,max:3000}));
  if(c)f.append(el('fieldset',{class:'fe-cons'},el('legend',{},'Consignment — '+(c.consignor||'consignor')+(c.consignor_number?' #'+c.consignor_number:'')),
    el('div',{class:'fe-grid'},el('label',{},'Consignor’s share (%) — blank uses their default ('+c.consignor_split+'%)',el('input',{name:'c_split',type:'number',min:'0',max:'100',step:'1',value:c.split_pct??''})),
      el('label',{},'Consignment price ($)',el('input',{name:'c_price',type:'number',min:'0',step:'0.01',value:c.price_cents==null?'':(c.price_cents/100).toFixed(2)})),
      el('label',{},'We pay the consignor ($)',el('input',{name:'c_payout',type:'number',min:'0',step:'0.01',value:c.payout_cents==null?'':(c.payout_cents/100).toFixed(2)}))),
    el('p',{class:'muted',id:'fePayHint'},'Price, share and payout work each other out: change the price or share and the payout updates; type a payout and the share updates (rounded to a whole %).'),
    field('Consignment notes','c_notes',c.notes,{area:true,rows:2,max:500}),el('p',{class:'muted'},'Currently paying '+c.effective_split+'% to the consignor. Status: '+c.status+'.')));
  else if(stf){if(it.consigned)f.append(el('p',{class:'muted'},'This piece is consigned. The owner handles its price and payout.'))}
  else f.append(el('p',{class:'muted'},'Not a consigned item, so there is no commission to set.'));
  let lastEdited='split';
  if(c){const S=f.elements.c_split,P=f.elements.c_price,Y=f.elements.c_payout,eff=()=>S.value===''?c.consignor_split:Number(S.value);
    const calcPayout=()=>{const pr=parseFloat(P.value);Y.value=isNaN(pr)?'':(Math.floor(pr*100*eff()/100+0.5+1e-9)/100).toFixed(2)};
    S.addEventListener('input',()=>{lastEdited='split';calcPayout()});P.addEventListener('input',()=>{if(lastEdited==='payout'&&Y.value!==''&&!isNaN(parseFloat(P.value))&&parseFloat(P.value)>0){const pct=Math.round(parseFloat(Y.value)/parseFloat(P.value)*100);S.value=Math.min(100,Math.max(0,pct))}else calcPayout()});
    Y.addEventListener('input',()=>{lastEdited='payout';const pr=parseFloat(P.value),py=parseFloat(Y.value);if(!isNaN(pr)&&pr>0&&!isNaN(py))S.value=Math.min(100,Math.max(0,Math.round(py/pr*100)))})}
  f.append(historyBox(it.history,'This piece has not been edited since tracking started.'));
  f.append(el('h4',{},'Photos'),grid,el('button',{type:'button',class:'btn ghost small',onclick:()=>pick.click()},'Add photos'),pick,
    el('div',{class:'review-actions'},el('button',{type:'submit',class:'btn'},'Save changes'),el('button',{type:'button',class:'btn ghost',onclick:()=>openItem(sku)},'Undo changes')),el('p',{id:'feMsg',class:'fe-msg',role:'status'}));
  if(!stf||can('delete'))f.append(deleteBox(it,c));
  draw();ed.replaceChildren(f);f.scrollIntoView({block:'start'});
  f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;msg('Saving…');
    const body={name:g(f,'name'),regular_price:num(f,'regular_price'),sale_price:num(f,'sale_price'),size:g(f,'size'),color:g(f,'color'),main_category:g(f,'main_category'),sub_category:g(f,'sub_category'),details:g(f,'details'),stock:num(f,'stock'),location:g(f,'location'),weight_lb:num(f,'weight_lb'),length_in:num(f,'length_in'),width_in:num(f,'width_in'),height_in:num(f,'height_in'),remove_images:[...removed],image_order:order.filter(p=>!removed.has(p)),add_photos:added.map(a=>a.id)};
    if(roPrice){delete body.regular_price;delete body.sale_price}if(stf)delete body.stock;
    if(c&&!stf){body.consign={price:g(f,'c_price')===''?null:Number(g(f,'c_price')),notes:g(f,'c_notes')};
      if(lastEdited==='payout'&&g(f,'c_payout')!=='')body.consign.payout=Number(g(f,'c_payout'));else body.consign.split_pct=g(f,'c_split')===''?null:Number(g(f,'c_split'))}
    try{await api('admin/items/'+encodeURIComponent(sku),{method:'POST',body});await openItem(sku);msg('Saved. The site now shows your changes.');try{window.TKAdmin.reloadPieces()}catch{}}catch(err){msg(err.message,true);b.disabled=false}}
}
/* ---- Delete from the website → Recently deleted (30 days), then deleted for good ---- */
const day=t=>t?new Date(t).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}):'';
const reloadPieces=()=>{try{window.TKAdmin.reloadPieces()}catch{}};
function deleteBox(it,c){
  const box=el('div',{class:'fe-delete'});
  if(it.status==='on_hold'){box.append(el('h4',{},'Delete'),el('p',{class:'muted'},'A customer is checking out with this piece right now, so it cannot be deleted yet.'));return box}
  const btn=el('button',{type:'button',class:'btn ghost fe-del-btn',onclick:()=>{btn.hidden=true;sure.hidden=false;sure.scrollIntoView({block:'nearest'})}},'Delete from website…');
  const yes=el('button',{type:'button',class:'btn danger',onclick:async()=>{yes.disabled=true;msg('Deleting…');
    try{const d=(await api('admin/items/'+encodeURIComponent(it.sku)+'/delete',{method:'POST',body:{}})).deleted;deleted(d)}catch(err){msg(err.message,true);yes.disabled=false}}},'Yes, delete it');
  const sure=el('div',{class:'fe-sure-box',hidden:true},
    el('p',{},el('b',{},'Delete “'+it.name+'” from the website?'),' It goes to Recently deleted for 30 days, and you can put it back any time before then. After that it is deleted for good.'
      +(it.source==='ebay'?' It stays listed on eBay; this only takes it off the website.':'')+(c?' The consignor’s record keeps the piece; it just won’t be on the website.':'')),
    el('div',{class:'review-actions'},yes,el('button',{type:'button',class:'btn ghost',onclick:()=>{sure.hidden=true;btn.hidden=false}},'Cancel')));
  box.append(el('h4',{},'Delete'),btn,sure);return box}
function deleted(d){
  const ed=$('feEditor'),undo=el('button',{type:'button',class:'btn',onclick:async()=>{undo.disabled=true;msg('Putting it back…');
    try{await api('admin/trash/'+d.id+'/restore',{method:'POST',body:{}});await openItem(d.sku);msg('Put back on the website.');trashCount();reloadPieces()}catch(err){msg(err.message,true);undo.disabled=false}}},'Undo: put it back');
  ed.replaceChildren(el('div',{class:'fe-form fe-deleted'},el('h3',{},'Deleted: '+d.name),
    el('p',{},'It is off the website now and waits in Recently deleted until '+day(d.purge_after)+'. Put it back any time before then.'),
    el('div',{class:'review-actions'},undo,el('button',{type:'button',class:'btn ghost',onclick:()=>setMode('trash')},'Open Recently deleted')),el('p',{id:'feMsg',class:'fe-msg',role:'status'})));
  $('feResults').querySelectorAll('.fe-row').forEach(x=>{if(x.dataset.sku===d.sku)x.remove()});
  trashCount();reloadPieces()}
async function trashCount(n){const b=$('feModeTrash');if(!b||(isStaff()&&!can('delete')))return;
  if(n==null){try{n=(await api('admin/trash')).items.length}catch{return}}
  b.textContent='Recently deleted'+(n?' ('+n+')':'')}
async function loadTrash(note,bad){const box=$('feResults');if(mode!=='trash')return;
  if(!box.children.length)box.replaceChildren(el('p',{class:'muted'},'Loading…'));
  let r;try{r=await api('admin/trash')}catch(e){box.replaceChildren(el('p',{class:'fe-msg bad'},e.message));return}
  if(mode!=='trash')return;
  trashCount(r.items.length);
  box.replaceChildren(el('p',{id:'feMsg',class:'fe-msg',role:'status'}),...(r.items.length?r.items.map(trashRow):[el('p',{class:'muted'},'Nothing in Recently deleted.')]));
  if(note)msg(note,bad)}
function trashRow(t){
  const act=async(btn,path,body,done)=>{btn.disabled=true;try{await api('admin/trash/'+t.id+'/'+path,{method:'POST',body});loadTrash(done)}catch(e){msg(e.message,true);btn.disabled=false}};
  const put=el('button',{type:'button',class:'btn small',onclick:()=>act(put,'restore',{},'“'+t.name+'” is back on the website.').then(reloadPieces)},'Put back on website');
  const keep=el('button',{type:'button',class:'btn small ghost',onclick:()=>act(keep,'keep',{keep:!t.keep},t.keep?'It will be deleted for good on its date.':'Kept: it stays here until you put it back or delete it for good.')},t.keep?'Stop keeping':'Keep (don’t auto-delete)');
  const del=el('button',{type:'button',class:'link bad',onclick:()=>{del.hidden=true;sure.hidden=false}},'Delete for good…');
  const gone=el('button',{type:'button',class:'btn small danger',onclick:()=>act(gone,'purge',{},'“'+t.name+'” was deleted for good.')},'Yes, delete for good');
  const sure=el('span',{class:'fe-sure',hidden:true},'This can’t be undone.',gone,el('button',{type:'button',class:'link',onclick:()=>{sure.hidden=true;del.hidden=false}},'Cancel'));
  const when=t.keep?'Kept: won’t be deleted automatically':t.days_left<=0?'Deleted for good today':'Deleted for good on '+day(t.purge_after)+' ('+t.days_left+' day'+(t.days_left===1?'':'s')+' left)';
  return el('div',{class:'fe-row fe-trash','data-sku':t.sku},
    t.image?el('img',{src:img(t.image),alt:'',loading:'lazy'}):el('span',{class:'fe-noimg'}),
    el('span',{class:'fe-main'},el('b',{},t.name),el('small',{},t.sku+(t.price_text?' · '+t.price_text:'')+' · deleted '+day(t.deleted_at)+(t.from_ebay?' · still on eBay':'')+(t.consigned?' · consigned':'')),
      el('small',{class:t.keep?'fe-kept':'fe-when'},when)),
    el('span',{class:'fe-actions'},isStaff()?put:[put,keep,del,sure]))}
function openTrash(){show(findEdit);setMode('trash')}
const FIELD_LABELS={name:'Name',regular_price:'Regular price',sale_price:'Sale price',size:'Size',color:'Color',main_category:'Category',sub_category:'Sub-category',details:'Details',stock:'Stock',location:'Location',weight_lb:'Weight (lb)',length_in:'Length (in)',width_in:'Width (in)',height_in:'Height (in)',photos:'Photos',consign_price:'Consignment price',consign_split_pct:'Consignor share %',consign_payout:'We pay consignor',consign_notes:'Consignment notes',email:'Email',phone:'Phone',notes:'Notes',fulfillment_status:'Status',carrier:'Carrier',service:'Service',tracking_number:'Tracking number',tracking_url:'Tracking link',address_name:'Ship-to name',address_street1:'Street',address_street2:'Apt / suite',address_city:'City',address_state:'State',address_zip:'ZIP'};
function historyBox(h,empty){if(isStaff())h=(h||[]).filter(r=>!/^consign_/.test(r.field||''));const box=el('details',{class:'fe-history'},el('summary',{},'Change history'+(h&&h.length?' ('+h.length+')':'')));
  if(!h||!h.length){box.append(el('p',{class:'muted'},empty));return box}
  const ul=el('ul',{});h.forEach(r=>{const when=r.at?new Date(r.at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'';
    ul.append(el('li',{},el('b',{},FIELD_LABELS[r.field]||r.field),' ',el('span',{class:'fe-old'},r.old||'(blank)'),' → ',el('span',{class:'fe-new'},r.new||'(blank)'),el('small',{},' · '+when+(who(r.actor)?' · '+who(r.actor):''))))});
  box.append(ul);return box}
const STATUSES=['new','processing','shipped','delivered','ready','picked_up','cancelled'];
async function openOrder(id){
  const ed=$('feEditor');ed.replaceChildren(el('p',{class:'muted'},'Loading order…'));
  let o;try{o=(await api('admin/orders/'+id+'/details')).order}catch(e){ed.replaceChildren(el('p',{class:'fe-msg bad'},e.message));return}
  const a=o.address||{},sh=o.shipping||{},f=el('form',{class:'fe-form'});
  const st=el('select',{name:'fulfillment_status'},[...new Set([...STATUSES,o.fulfillment_status].filter(Boolean))].map(s=>el('option',{value:s,selected:s===o.fulfillment_status},s)));
  f.append(el('div',{class:'fe-head'},el('h3',{},'Order '+o.number),el('p',{class:'muted'},(o.items||[]).map(i=>i.name).join(', ')+' · '+$c(o.total_cents)+' · '+(o.fulfillment==='pickup'?'store pickup':'shipping'))),
    el('div',{class:'fe-grid'},field('Customer name','name',o.name,{max:120}),field('Email','email',o.email,{type:'email',max:160}),field('Phone','phone',o.phone,{max:40}),el('label',{},'Status',st)),
    el('fieldset',{},el('legend',{},'Shipping address'),el('div',{class:'fe-grid'},field('Name on package','a_name',a.name,{max:120}),field('Street','a_street1',a.street1,{max:120}),field('Apt / suite','a_street2',a.street2,{max:120}),field('City','a_city',a.city,{max:80}),field('State (2 letters)','a_state',a.state,{max:2}),field('ZIP','a_zip',a.zip,{max:10}))),
    el('fieldset',{},el('legend',{},'Carrier & tracking'),el('div',{class:'fe-grid'},field('Carrier','carrier',sh.carrier,{max:40}),field('Service','service',sh.service,{max:60}),field('Tracking number','tracking_number',sh.tracking_number,{max:60}),field('Tracking link','tracking_url',sh.tracking_url,{max:300,ph:'https://…'}))),
    field('Notes','notes',o.notes,{area:true,rows:3,max:1000}),
    el('div',{class:'review-actions'},el('button',{type:'submit',class:'btn'},'Save order'),el('button',{type:'button',class:'btn ghost',onclick:()=>openOrder(id)},'Undo changes'),
      window.TKAdmin?.showOrder&&document.querySelector('[data-tab="orders"]')?el('button',{type:'button',class:'btn ghost',onclick:()=>window.TKAdmin.showOrder(o.id)},'Refund, label & payment →'):null),el('p',{id:'feMsg',class:'fe-msg',role:'status'}));
  f.append(historyBox(o.history,'This order has not been edited since tracking started.'));
  ed.replaceChildren(f);f.scrollIntoView({block:'start'});
  f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;msg('Saving…');
    const body={name:g(f,'name'),email:g(f,'email'),phone:g(f,'phone'),fulfillment_status:g(f,'fulfillment_status'),carrier:g(f,'carrier'),service:g(f,'service'),tracking_number:g(f,'tracking_number'),tracking_url:g(f,'tracking_url'),notes:g(f,'notes')};
    if(o.fulfillment!=='pickup'||g(f,'a_street1'))body.address={name:g(f,'a_name'),street1:g(f,'a_street1'),street2:g(f,'a_street2'),city:g(f,'a_city'),state:g(f,'a_state').toUpperCase(),zip:g(f,'a_zip'),country:'US'};
    try{await api('admin/orders/'+id+'/details',{method:'POST',body});await openOrder(id);msg('Saved.')}catch(err){msg(err.message,true);b.disabled=false}}
}
window.TKWU=Object.assign(window.TKWU||{},{openItem,openOrder,openTrash});
})();
})();

/* ---- Task list: memos with checkpoints, shared by everyone who signs in (server: admin/tasks, lib/tasks.php).
   Each task shows when it was added and by whom, and can carry a reminder time: the shop emails its own inbox then.
   Tasks a browser kept on its own before 2026-11-15 (localStorage tk_tasklist_v1) are moved into the shared list once. ---- */
(function(){
const OLD_KEY='tk_tasklist_v1',MOVED_KEY='tk_tasklist_v1_moved';
const list=document.getElementById('taskList'),form=document.getElementById('taskForm');if(!list||!form)return;
const msgBox=document.getElementById('taskMsg'),emailBox=document.getElementById('taskEmail');
let tasks=[],email=null,canSummary=false,loaded=false,busy=false;
const api=(path,body)=>window.TKAdmin.api(path,body===undefined?{}:{method:'POST',body});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function btn(cls,txt,fn){const b=el('button',cls,txt);b.type='button';b.onclick=fn;return b}
const fmt=(iso,o)=>{if(!iso)return '';const d=new Date(iso);return d.toLocaleString('en-US',o||Object.assign({weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'},d.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{}))};
const who=w=>window.TKAdmin.who(w),staffUser=()=>window.TKAdmin.isStaff();
function say(text,kind){if(!msgBox)return;msgBox.className='msg '+(kind||'info');msgBox.textContent=text||'';msgBox.hidden=!text}
/* <input type=datetime-local> works in the viewer's own clock; the server stores UTC. */
const pad=n=>String(n).padStart(2,'0');
const toLocalInput=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
const fromLocalInput=v=>{if(!v)return null;const d=new Date(v);return isNaN(d)?undefined:d.toISOString()};
function quickTimes(){const at=(days,h)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(h,0,0,0);return d};
  const out=[];const now=new Date();if(now.getHours()<16)out.push(['This afternoon',at(0,17)]);
  out.push(['Tomorrow 9 AM',at(1,9)]);const mon=at(((8-now.getDay())%7)||7,9);out.push(['Monday 9 AM',mon]);out.push(['In a week',at(7,9)]);return out}
function remindPicker(value,onSave,onCancel){
  const box=el('div','task-remind-edit');const inp=document.createElement('input');inp.type='datetime-local';inp.value=value?toLocalInput(new Date(value)):'';
  inp.setAttribute('aria-label','Reminder date and time');box.appendChild(inp);
  const q=el('div','task-quick');quickTimes().forEach(([t,d])=>q.appendChild(btn('chip',t,()=>{inp.value=toLocalInput(d)})));box.appendChild(q);
  if(onSave){const row=el('div','task-remind-actions');row.appendChild(btn('btn small','Save reminder',()=>{const iso=fromLocalInput(inp.value);if(!iso){say('Pick a date and time first.','error');return}onSave(iso)}));
    row.appendChild(btn('btn small ghost','Cancel',onCancel));box.appendChild(row)}
  box.input=inp;return box}

async function load(){
  try{
    const d=await api('admin/tasks');apply(d);
    let old=[];try{old=JSON.parse(localStorage.getItem(OLD_KEY)||'[]')}catch(e){}
    if(staffUser())old=[];   /* tasks/import is the owner's */
    let moved=null;try{moved=localStorage.getItem(MOVED_KEY)}catch(e){}
    if(Array.isArray(old)&&old.length&&!moved){
      const r=await api('admin/tasks/import',{tasks:old});apply(r);
      try{localStorage.setItem(MOVED_KEY,new Date().toISOString())}catch(e){}
      if(r.imported)say('Moved '+r.imported+' task'+(r.imported===1?'':'s')+' from this browser into the shared list. Everyone who signs in now sees the same list.','ok');
    }
  }catch(e){say(e.message,'error')}
  loaded=true;render()}
function apply(d){if(Array.isArray(d.tasks))tasks=d.tasks;if(d.email)email=d.email;if('can_change_summary' in d)canSummary=!!d.can_change_summary}
function replace(t){const i=tasks.findIndex(x=>x.id===t.id);if(i>=0)tasks[i]=t;else tasks.unshift(t)}
async function save(t,body,rerender=true){
  try{const d=await api('admin/tasks/'+t.id,body);replace(d.task);if(rerender)render();return d.task}
  catch(e){say(e.message,'error');if(e.code==='not_found')load();return null}}

function emailNote(){
  if(!emailBox)return;emailBox.textContent='';if(!email||staffUser())return;
  const p=el('p','muted');
  if(!email.to)p.textContent='Reminders show here, but they can’t be emailed until the shop’s email address is set (keys page: “New-order alerts go to”).';
  else if(!email.on)p.textContent='Emails are switched off right now, so reminders show here but are not emailed.';
  else{p.append('Reminders are emailed to ');p.appendChild(el('strong',null,email.to));p.append(' at the time you pick.')}
  emailBox.appendChild(p);
  const s=el('div','task-summary');
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!email.summary;cb.disabled=!canSummary;cb.id='taskSummaryOn';
  const lab=el('label');lab.htmlFor='taskSummaryOn';lab.appendChild(cb);lab.append(' Morning summary email at ');
  const sel=document.createElement('select');sel.disabled=!canSummary;sel.setAttribute('aria-label','Morning summary time');
  for(let h=5;h<=12;h++){const o=document.createElement('option');o.value=h;o.textContent=h===12?'12 PM':h+' AM';if(h===email.summary_hour)o.selected=true;sel.appendChild(o)}
  s.appendChild(lab);s.appendChild(sel);
  s.appendChild(el('p','muted','Yesterday’s sales, orders to ship or pick up, today’s reminders, consignor agreements ending this week and deleted pieces about to go for good. Skipped on days with nothing to report.'+(canSummary?'':' Only the owner can change this.')));
  const change=async body=>{try{const d=await api('admin/tasks/summary',body);email=d.email;say(email.summary?'Morning summary is on: it comes around '+(email.summary_hour===12?'12 PM':email.summary_hour+' AM')+'.':'Morning summary is off.','ok');emailNote()}catch(e){say(e.message,'error');emailNote()}};
  cb.onchange=()=>change({on:cb.checked});sel.onchange=()=>change({hour:Number(sel.value)});
  emailBox.appendChild(s)}

function remindLine(t){
  const row=el('div','task-remind');if(staffUser())return row;const now=Date.now(),at=t.remind_at?Date.parse(t.remind_at):0;
  if(!t.remind_at){if(!t.done_at)row.appendChild(btn('link','+ Add a reminder',()=>{row.replaceWith(remindPicker(null,iso=>save(t,{remind_at:iso}),render))}));return row}
  let text,cls='';
  if(t.done_at&&t.remind_status==='pending'){text='Reminder off (task is done) · was '+fmt(t.remind_at)}
  else if(t.remind_status==='sent'){text='✓ Reminder emailed '+fmt(t.reminded_at||t.remind_at)}
  else if(t.remind_status==='failed'){text='⚠ The reminder email for '+fmt(t.remind_at)+' could not be sent. Pick a time to try again.';cls=' bad'}
  else if(t.remind_status==='missed'){text='Reminder time ('+fmt(t.remind_at)+') passed while emails were off.';cls=' bad'}
  else if(at<=now){text='⏰ Sending the reminder for '+fmt(t.remind_at)+'…';cls=' due'}
  else{text='⏰ Reminder '+fmt(t.remind_at)+(email&&(!email.on||!email.to)?' (shows here only: emails are off)':'')}
  row.className+=cls;row.appendChild(el('span',null,text));
  if(!t.done_at){row.appendChild(btn('link',t.remind_status==='pending'?'Change':'Remind again',()=>{row.replaceWith(remindPicker(t.remind_status==='pending'?t.remind_at:null,iso=>save(t,{remind_at:iso}),render))}));
    if(t.remind_status==='pending')row.appendChild(btn('link','Remove',()=>save(t,{remind_at:null})))}
  return row}

function card(t){
  const steps=t.steps||[],n=steps.filter(s=>s.done).length,due=!t.done_at&&t.remind_status==='pending'&&t.remind_at&&Date.parse(t.remind_at)<=Date.now();
  const c=el('div','task-card'+(t.done_at?' done':'')+(due?' due':''));c.dataset.id=t.id;
  const head=el('div','task-head');
  const done=document.createElement('input');done.type='checkbox';done.checked=!!t.done_at;done.title=t.done_at?'Mark not done':'Mark done';done.setAttribute('aria-label',done.title);
  done.onchange=()=>save(t,{done:done.checked});head.appendChild(done);
  head.appendChild(el('strong',null,t.title));
  if(steps.length)head.appendChild(el('span','task-prog',n+' / '+steps.length+' done'));
  if(!staffUser())head.appendChild(btn('link','Delete',async()=>{if(!confirm('Delete “'+t.title+'”? This cannot be undone.'))return;
    try{await api('admin/tasks/'+t.id+'/delete',{});tasks=tasks.filter(x=>x.id!==t.id);render()}catch(e){say(e.message,'error')}}));
  c.appendChild(head);
  const meta=el('p','task-meta','Added '+fmt(t.created_at)+(who(t.created_by)?' by '+who(t.created_by):'')
    +(t.done_at?' · done '+fmt(t.done_at)+(who(t.done_by)?' by '+who(t.done_by):''):'')
    +(!t.done_at&&t.updated_at&&t.updated_at!==t.created_at?' · changed '+fmt(t.updated_at):''));
  c.appendChild(meta);
  c.appendChild(remindLine(t));
  if(steps.length){const bar=el('div','task-bar');const f=el('span');f.style.width=Math.round(n/steps.length*100)+'%';bar.appendChild(f);c.appendChild(bar)}
  if(staffUser()){if(t.memo)c.appendChild(el('p','task-memo-ro',t.memo))}else{
  const memo=el('textarea','task-memo');memo.rows=2;memo.maxLength=4000;memo.placeholder='Memo';memo.value=t.memo||'';
  const saved=el('span','task-saved');let timer=null;
  const flush=async()=>{clearTimeout(timer);timer=null;if(memo.value===(t.memo||''))return;saved.textContent='Saving…';const r=await save(t,{memo:memo.value},false);if(r){t=r;saved.textContent='Saved '+fmt(r.updated_at,{hour:'numeric',minute:'2-digit'})}else saved.textContent=''};
  memo.oninput=()=>{saved.textContent='';clearTimeout(timer);timer=setTimeout(flush,900)};memo.onblur=()=>{if(timer)flush()};
  c.appendChild(memo);c.appendChild(saved);}
  const setSteps=next=>save(t,{steps:next});
  steps.forEach(s=>{const row=el('label','task-step'+(s.done?' on':''));const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!s.done;
    cb.onchange=()=>setSteps(steps.map(q=>q===s?{...q,done:cb.checked}:q));
    row.appendChild(cb);row.appendChild(el('span',null,s.text));
    const x=btn('task-x','×',e=>{e.preventDefault();setSteps(steps.filter(q=>q!==s))});x.title='Remove checkpoint';row.appendChild(x);c.appendChild(row)});
  if(!t.done_at){const add=el('div','task-add');const inp=document.createElement('input');inp.placeholder='Add a checkpoint';inp.maxLength=200;
    const go=()=>{const v=inp.value.trim();if(!v)return;setSteps([...steps,{id:uid(),text:v,done:false}])};
    add.appendChild(inp);add.appendChild(btn('btn ghost','Add',go));inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go()}};c.appendChild(add)}
  return c}

function render(){
  emailNote();list.textContent='';
  if(!loaded){list.appendChild(el('p','muted','Loading tasks…'));return}
  const open=tasks.filter(t=>!t.done_at),finished=tasks.filter(t=>t.done_at);
  if(!tasks.length){list.appendChild(el('p','muted','No tasks yet. Add one above.'));return}
  if(!open.length)list.appendChild(el('p','muted','Everything is done. Nice!'));
  open.forEach(t=>list.appendChild(card(t)));
  if(finished.length){const d=el('details','task-finished');d.appendChild(el('summary',null,'Finished ('+finished.length+')'));finished.forEach(t=>d.appendChild(card(t)));list.appendChild(d)}}

/* The add form: title, memo, optional reminder. */
const remindSlot=document.getElementById('taskRemindSlot');let addPicker=null;
if(remindSlot){addPicker=remindPicker(null,null,null);remindSlot.appendChild(addPicker)}
form.onsubmit=async e=>{e.preventDefault();if(busy)return;
  const title=document.getElementById('taskTitle').value.trim();if(!title)return;
  const remind=addPicker&&!staffUser()?fromLocalInput(addPicker.input.value):null;if(remind===undefined){say('That reminder time is not a date and time.','error');return}
  busy=true;const b=form.querySelector('button[type=submit]');if(b)b.disabled=true;
  try{const d=await api('admin/tasks',{title,memo:document.getElementById('taskMemo').value,remind_at:remind});replace(d.task);form.reset();say(remind?'Task added. The reminder will be emailed '+fmt(remind)+'.':'Task added.','ok');render()}
  catch(err){say(err.message,'error')}finally{busy=false;if(b)b.disabled=false}};

const IDS=['overview','review','create','returns','shippingPage','salesLog','itemSearch','findEdit','changeMany','publish','tasks'];
function showSec(id){IDS.forEach(i=>{const x=document.getElementById(i);if(x)x.hidden=i!==id});const t=document.getElementById('uploadTabs');if(t)t.hidden=true;window.scrollTo(0,0)}
function open(){say('');loaded=false;render();showSec('tasks');load()}
document.getElementById('openTasks').onclick=open;
document.getElementById('tasksBack').onclick=()=>{showSec('overview');const t=document.getElementById('uploadTabs');if(t)t.hidden=false};
/* Reminder emails link to ?open=tasks#weekly: open the list once the admin has signed in and shown Weekly uploads. */
if(new URLSearchParams(location.search).get('open')==='tasks'){
  const started=Date.now();const iv=setInterval(()=>{
    const app=document.getElementById('app'),panel=document.getElementById('weeklyPanel');
    if(app&&!app.hidden&&panel&&!panel.hidden&&window.TKAdmin){clearInterval(iv);history.replaceState(null,'',location.pathname+location.hash);open()}
    else if(Date.now()-started>600000)clearInterval(iv)},400)}
window.TKWU=Object.assign(window.TKWU||{},{openTasks:open});
})();

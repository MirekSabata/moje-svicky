const db = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabasePublishableKey);
let materials=[],rows=0,workshopId=null;

async function loadWorkshop(){
  const {data:{user},error:userError}=await db.auth.getUser();
  if(userError) throw userError;
  if(!user) throw new Error('Nejsi přihlášený.');
  const {data,error}=await db.from('workshop_members')
    .select('workshop_id').eq('user_id',user.id).limit(1).single();
  if(error) throw error;
  workshopId=data.workshop_id;
}

const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('cs-CZ',{style:'currency',currency:'CZK'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function msg(t){$('notice').textContent=t;$('notice').classList.remove('hidden')}
function clearMsg(){$('notice').classList.add('hidden')}

async function login(){
 const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
 if(error){alert('Přihlášení se nezdařilo: '+error.message);return}
 await init();
}
async function logout(){await db.auth.signOut();location.reload()}

function addRow(){
 const id=++rows;
 const row=document.createElement('div');
 row.className='row';row.dataset.row=id;
 row.innerHTML=`
 <div class="material"><label>Materiál</label><select class="mat" required></select></div>
 <div><label>Množství</label><input class="qty" type="number" min="0.001" step="any" value="1" required></div>
 <div><label>Jednotková cena Kč</label><input class="price" type="number" min="0" step="any" value="0" required></div>
 <div><label>Celkem Kč</label><input class="line" type="number" readonly value="0"></div>
 <div><button type="button" class="secondary remove">×</button></div>`;
 $('items').appendChild(row);
 const sel=row.querySelector('.mat');
 sel.innerHTML='<option value="">Vyber materiál</option>'+materials.map(m=>`<option value="${m.id}" data-unit="${esc(m.unit)}" data-price="${m.price_per_unit}">${esc(m.name)} (${esc(m.unit)})</option>`).join('');
 sel.addEventListener('change',()=>{
  const opt=sel.selectedOptions[0];
  row.querySelector('.price').value=opt?.dataset.price||0;
  updateRow(row);
 });
 row.querySelector('.qty').addEventListener('input',()=>updateRow(row));
 row.querySelector('.price').addEventListener('input',()=>updateRow(row));
 row.querySelector('.remove').addEventListener('click',()=>{row.remove();updateTotal()});
 updateTotal();
}
function updateRow(row){
 row.querySelector('.line').value=(Number(row.querySelector('.qty').value)||0)*(Number(row.querySelector('.price').value)||0);
 updateTotal();
}
function updateTotal(){
 let sum=0;
 document.querySelectorAll('.line').forEach(x=>sum+=Number(x.value)||0);
 $('total').textContent=money(sum);
}
async function loadMaterials(){
 const {data,error}=await db.from('materials').select('*').order('name');
 if(error)throw error;
 materials=data||[];
}
async function addMaterial(){
 clearMsg();
 const name=$('newName').value.trim(),unit=$('newUnit').value,price=Number($('newPrice').value);
 if(!name||price<0){msg('Vyplň název a platnou cenu.');return}
 const {error}=await db.from('materials').insert({workshop_id:workshopId,name,unit,price_per_unit:price});
 if(error){msg('Materiál se nepodařilo uložit: '+error.message);return}
 $('newName').value='';$('newPrice').value='0';
 await refresh();msg('Materiál byl uložen.');
}
async function savePurchase(){
 clearMsg();
 const lines=[...document.querySelectorAll('#items .row')];
 if(!lines.length){msg('Přidej alespoň jednu položku.');return}
 const entries=[];
 for(const row of lines){
  const materialId=row.querySelector('.mat').value;
  const opt=row.querySelector('.mat').selectedOptions[0];
  const qty=Number(row.querySelector('.qty').value);
  const price=Number(row.querySelector('.price').value);
  if(!materialId||!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0){
   msg('Zkontroluj materiál, množství a jednotkovou cenu u všech položek.');return
  }
  entries.push({material_id:materialId,quantity:qty,unit:opt.dataset.unit,unit_price:price,total_price:Math.round(qty*price*100)/100});
 }
 const {data:p,error:pe}=await db.from('purchases').insert({
  workshop_id:workshopId,
  purchased_at:$('purchaseDate').value||new Date().toISOString().slice(0,10),
  supplier:$('supplier').value.trim()||null,
  document_number:$('documentNo').value.trim()||null,
  notes:$('purchaseNote').value.trim()||null
 }).select().single();
 if(pe){msg('Nákup se nepodařilo uložit: '+pe.message);return}
 const itemRows=entries.map(x=>({...x,purchase_id:p.id,workshop_id:workshopId}));
 const {data:saved,error:ie}=await db.from('purchase_items').insert(itemRows).select();
 if(ie){msg('Doklad byl vytvořen, ale položky se nepodařilo uložit. Nemaž ho; pošli mi tuto chybu: '+ie.message);return}
 const moves=saved.map(x=>({
  material_id:x.material_id,purchase_item_id:x.id,
  movement_type:'purchase',quantity_delta:x.quantity,unit:x.unit,unit_cost:x.unit_price
 }));
 const {error:me}=await db.from('stock_movements').insert(moves);
 if(me){msg('Položky nákupu jsou uloženy, ale příjem na sklad se nepodařil. Nákup neopakuj. Pošli mi chybu: '+me.message);return}
 $('items').innerHTML='';rows=0;addRow();
 $('supplier').value='';$('documentNo').value='';$('purchaseNote').value='';
 await refresh();msg('Nákup byl uložen a materiál přijat na sklad.');
}
async function refresh(){
 await loadMaterials();
 $('materialCount').textContent=materials.length;
 const {data:ps,error:pe}=await db.from('purchases').select('*,purchase_items(id,total_price)').order('purchased_at',{ascending:false});
 if(pe)throw pe;
 $('purchaseCount').textContent=ps.length;
 $('purchaseValue').textContent=money(ps.reduce((s,p)=>s+(p.purchase_items||[]).reduce((a,i)=>a+Number(i.total_price||0),0),0));
 $('history').innerHTML=ps.map(p=>{
  const items=p.purchase_items||[];
  const total=items.reduce((s,i)=>s+Number(i.total_price||0),0);
  return `<tr><td>${esc(p.purchased_at)}</td><td>${esc(p.supplier||'—')}</td><td>${esc(p.document_number||'—')}</td><td>${items.length}</td><td>${money(total)}</td></tr>`;
 }).join('')||'<tr><td colspan="5">Zatím žádné nákupy.</td></tr>';
 const {data:ms,error:me}=await db.from('stock_movements').select('material_id,quantity_delta,unit_cost');
 if(me)throw me;
 $('stock').innerHTML=materials.map(m=>{
  const moves=ms.filter(x=>x.material_id===m.id);
  const qty=moves.reduce((s,x)=>s+Number(x.quantity_delta),0);
  const purchases=moves.filter(x=>x.quantity_delta>0);
  const last=purchases.length?purchases[purchases.length-1].unit_cost:m.price_per_unit;
  return `<tr><td>${esc(m.name)}</td><td>${esc(m.unit)}</td><td>${qty.toLocaleString('cs-CZ',{maximumFractionDigits:3})} ${esc(m.unit)}</td><td>${money(last)} / ${esc(m.unit)}</td></tr>`;
 }).join('')||'<tr><td colspan="4">Zatím nejsou evidované materiály.</td></tr>';
}
async function init(){
 const {data:{session}}=await db.auth.getSession();
 if(!session){$('login').classList.remove('hidden');$('content').classList.add('hidden');return}
 $('login').classList.add('hidden');$('content').classList.remove('hidden');
 $('purchaseDate').value=new Date().toISOString().slice(0,10);
 try{await refresh();if(!document.querySelector('#items .row'))addRow()}
 catch(e){msg('Chyba při načítání: '+e.message)}
}
db.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(()=>init(),0)});
init();

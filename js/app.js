const db = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabasePublishableKey);
let currentUser = null, workshopId = null;
let candles = [], materials = [], batches = [], recipes = [], stockMovements = [];
const $ = id => document.getElementById(id);
const money = v => Number(v || 0).toLocaleString('cs-CZ', {style:'currency', currency:'CZK'});
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(id, text) { $(id).textContent = text; $(id).classList.remove('hidden'); }
function notice(text) { message('notice', text); }
function hideMessage(id) { $(id).classList.add('hidden'); }

async function loadWorkshop() {
  const {data:{user}, error:userError} = await db.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Nejsi přihlášený.');
  const {data, error} = await db.from('workshop_members').select('workshop_id').eq('user_id', user.id).limit(1).single();
  if (error) throw error;
  workshopId = data.workshop_id;
}
function showTab(tab) {
  ['home','candles','materials','recipes','batches'].forEach(t => $('tab-'+t).classList.toggle('hidden', t !== tab));
  if (tab === 'recipes') renderRecipeEditor();
  if (tab === 'batches') renderProductionRecipe();
}
async function signIn() {
  hideMessage('loginMsg');
  const email = $('email').value.trim(), password = $('password').value;
  const {error} = await db.auth.signInWithPassword({email,password});
  if (error) { message('loginMsg','Přihlášení se nepodařilo: '+error.message); return; }
  await init();
}
async function signOut() { await db.auth.signOut(); location.reload(); }

async function loadAll() {
  const results = await Promise.all([
    db.from('candles').select('*').order('created_at',{ascending:false}),
    db.from('materials').select('*').order('name'),
    db.from('batches').select('*,candles(name,weight_g,suggested_price)').order('created_at',{ascending:false}),
    db.from('recipes').select('*'),
    db.from('stock_movements').select('material_id,quantity_delta,unit_cost,movement_type,created_at'),
  ]);
  for (const r of results) if (r.error) throw r.error;
  [candles, materials, batches, recipes, stockMovements] = results.map(r => r.data || []);
  render();
}
function stockFor(materialId) {
  return stockMovements.filter(m => m.material_id === materialId).reduce((sum,m) => sum + Number(m.quantity_delta || 0), 0);
}
function render() {
  $('countCandles').textContent = candles.length;
  $('countBatches').textContent = batches.length;
  $('stock').textContent = batches.reduce((s,b) => s + Number(b.quantity || 0), 0);
  $('candlesList').innerHTML = candles.length ? '<div class="tablewrap"><table><tr><th>Název</th><th>Hmotnost</th><th>Doporučená cena</th></tr>'+candles.map(c=>`<tr><td>${safe(c.name)}</td><td>${c.weight_g} g</td><td>${money(c.suggested_price)}</td></tr>`).join('')+'</table></div>' : '<p class="muted">Zatím tu nejsou žádné svíčky.</p>';
  $('materialsList').innerHTML = materials.length ? '<div class="tablewrap"><table><tr><th>Materiál</th><th>Jednotka</th><th>Cena/jednotku</th><th>Stav podle pohybů</th></tr>'+materials.map(m=>`<tr><td>${safe(m.name)}</td><td>${safe(m.unit)}</td><td>${money(m.price_per_unit)}</td><td>${stockFor(m.id).toLocaleString('cs-CZ')} ${safe(m.unit)}</td></tr>`).join('')+'</table></div>' : '<p class="muted">Zatím tu nejsou žádné materiály.</p>';
  const options = '<option value="">Vyber svíčku</option>'+candles.map(c=>`<option value="${c.id}">${safe(c.name)} (${c.weight_g} g)</option>`).join('');
  $('candleSelect').innerHTML = options;
  $('recipeCandleSelect').innerHTML = options;
  $('batchesList').innerHTML = batches.length ? '<div class="tablewrap"><table><tr><th>Datum</th><th>Svíčka</th><th>Barva</th><th>Kusy</th><th>Náklad/kus</th><th>Prodejní cena</th></tr>'+batches.map(b=>{
    const labor=Number(b.labor_minutes)*Number(b.hourly_rate)/60;
    const overhead=Number(b.labor_minutes)*Number(b.overhead_per_hour)/60;
    const unitCost=(Number(b.material_cost_total)+labor+overhead)/Math.max(1,Number(b.quantity));
    return `<tr><td>${safe(b.produced_at)}</td><td>${safe(b.candles?.name||'')}</td><td>${safe(b.color)}</td><td>${b.quantity}</td><td>${money(unitCost)}</td><td>${money(b.candles?.suggested_price||0)}</td></tr>`;
  }).join('')+'</table></div>' : '<p class="muted">Zatím tu nejsou žádné dávky.</p>';
  if (!$('recipeCandleSelect').value && candles.length) $('recipeCandleSelect').value = candles[0].id;
  if (!$('candleSelect').value && candles.length) $('candleSelect').value = candles[0].id;
  renderRecipeEditor();
  renderProductionRecipe();
}
function recipeRowsFor(candleId) { return recipes.filter(r => r.candle_id === candleId); }
function recipeRowHtml(materialId='', qty='', unit='') {
  return `<div class="recipe-row">
    <select class="recipe-material" aria-label="Materiál"><option value="">Vyber materiál</option>${materials.map(m=>`<option value="${m.id}" ${m.id===materialId?'selected':''}>${safe(m.name)} (${safe(m.unit)})</option>`).join('')}</select>
    <input class="recipe-quantity" type="number" min="0.0001" step="any" value="${qty === '' ? '' : safe(qty)}" placeholder="Množství na 1 kus" aria-label="Množství na kus">
    <span class="recipe-unit">${safe(unit)}</span>
    <button type="button" class="remove-recipe-row secondary">Odebrat</button>
  </div>`;
}
function renderRecipeEditor() {
  const host = $('recipeEditor');
  if (!host) return;
  const candleId = $('recipeCandleSelect').value || candles[0]?.id;
  if (!candleId) { host.innerHTML = '<p>Nejprve přidej alespoň jednu svíčku.</p>'; return; }
  const rows = recipeRowsFor(candleId);
  host.innerHTML = rows.length ? rows.map(r=>recipeRowHtml(r.material_id, r.quantity_per_candle, r.unit)).join('') : '<p class="muted">Tato svíčka zatím nemá recepturu. Přidej materiál níže.</p>';
  bindRecipeRows(host);
}
function bindRecipeRows(host) {
  host.querySelectorAll('.remove-recipe-row').forEach(btn=>btn.addEventListener('click',()=>{btn.closest('.recipe-row').remove();}));
  host.querySelectorAll('.recipe-material').forEach(sel=>sel.addEventListener('change',()=>{
    const m=materials.find(x=>x.id===sel.value);
    sel.closest('.recipe-row').querySelector('.recipe-unit').textContent=m?.unit||'';
  }));
}
function collectRecipeRows(host) {
  const rows = [];
  for (const row of host.querySelectorAll('.recipe-row')) {
    const materialId = row.querySelector('.recipe-material').value;
    const quantity = Number(row.querySelector('.recipe-quantity').value);
    if (!materialId && !row.querySelector('.recipe-quantity').value) continue;
    if (!materialId || !(quantity > 0)) throw new Error('U každého řádku vyber materiál a zadej množství větší než nula.');
    if (rows.some(r=>r.material_id===materialId)) throw new Error('Stejný materiál je v receptuře dvakrát. Slouč ho do jednoho řádku.');
    const material = materials.find(m=>m.id===materialId);
    rows.push({material_id:materialId, material_name:material.name, quantity_per_candle:quantity, unit:material.unit, notes:null});
  }
  return rows;
}
async function saveRecipe() {
  hideMessage('recipeMsg');
  const candleId = $('recipeCandleSelect').value;
  if (!candleId) { message('recipeMsg','Nejprve vyber svíčku.'); return; }
  let rows;
  try { rows = collectRecipeRows($('recipeEditor')); }
  catch(e) { message('recipeMsg',e.message); return; }
  if (!rows.length && !confirm('Receptura bude prázdná. Opravdu chceš odstranit všechny její položky?')) return;
  const existing = recipeRowsFor(candleId);
  const keepIds = new Set();
  // Update matching materials first, and insert new rows before deleting removed rows.
  // This reduces the chance of losing the existing recipe if a write fails.
  for (const item of rows) {
    const old = existing.find(r => r.material_id === item.material_id);
    if (old) {
      const {error} = await db.from('recipes').update({quantity_per_candle:item.quantity_per_candle,unit:item.unit,notes:item.notes}).eq('id',old.id).eq('workshop_id',workshopId);
      if (error) { message('recipeMsg','Nepodařilo se upravit recepturu: '+error.message+'. Zkontroluj ji prosím znovu.'); await loadAll(); return; }
      keepIds.add(old.id);
    } else {
      const {data,error} = await db.from('recipes').insert({...item,workshop_id:workshopId,candle_id:candleId}).select('id').single();
      if (error) { message('recipeMsg','Nepodařilo se přidat položku receptury: '+error.message+'. Stávající položky nebyly záměrně hromadně smazány.'); await loadAll(); return; }
      keepIds.add(data.id);
    }
  }
  for (const old of existing) {
    if (!keepIds.has(old.id)) {
      const {error} = await db.from('recipes').delete().eq('id',old.id).eq('workshop_id',workshopId);
      if (error) { message('recipeMsg','Receptura je částečně uložena, ale nepodařilo se odstranit odebranou položku: '+error.message); await loadAll(); return; }
    }
  }
  await loadAll();
  message('recipeMsg','Receptura byla uložena. Sklad se tím nezměnil.');
}
function renderProductionRecipe() {
  const host = $('productionRecipe');
  if (!host) return;
  const candleId = $('candleSelect').value;
  const rows = recipeRowsFor(candleId);
  if (!candleId) { host.innerHTML='<p class="muted">Nejprve přidej a vyber svíčku.</p>'; updateProductionCost(); return; }
  if (!rows.length) { host.innerHTML='<p class="muted">Tato svíčka nemá uloženou recepturu. Nejdříve ji nastav v záložce Receptury.</p>'; updateProductionCost(); return; }
  const qty = Math.max(1, Number($('batchQuantity').value||1));
  host.innerHTML = '<h3>Spotřeba pro tuto várku</h3>'+rows.map(r=>{
    const m=materials.find(x=>x.id===r.material_id);
    return `<div class="production-row" data-material-id="${r.material_id}" data-unit-cost="${m?Number(m.price_per_unit):0}" data-base-qty="${Number(r.quantity_per_candle)}">
      <div><strong>${safe(m?.name||'Neznámý materiál')}</strong><div class="muted">${safe(r.quantity_per_candle)} ${safe(r.unit)} / kus · ${money(m?.price_per_unit)} / ${safe(r.unit)}</div></div>
      <label>Na celou várku <input class="production-qty" type="number" min="0.0001" step="any" value="${Number(r.quantity_per_candle)*qty}"></label>
      <span class="production-line-cost">${money(Number(r.quantity_per_candle)*qty*Number(m?.price_per_unit||0))}</span>
    </div>`;
  }).join('');
  host.querySelectorAll('.production-qty').forEach(input=>input.addEventListener('input',updateProductionCost));
  updateProductionCost();
}
function updateProductionCost() {
  const host=$('productionRecipe'), q=Math.max(1,Number($('batchQuantity')?.value||1));
  let materialCost=0, insufficient=[];
  host?.querySelectorAll('.production-row').forEach(row=>{
    const amount=Number(row.querySelector('.production-qty').value||0), cost=amount*Number(row.dataset.unitCost||0);
    materialCost+=cost;
    row.querySelector('.production-line-cost').textContent=money(cost);
    const current=stockFor(row.dataset.materialId);
    if (amount>current) insufficient.push(`${row.querySelector('strong').textContent}: potřeba ${amount}, sklad ${current}`);
  });
  const form=$('batchForm');
  const labor=Number(form.elements.labor_minutes.value||0)*Number(form.elements.hourly_rate.value||0)/60;
  const overhead=Number(form.elements.labor_minutes.value||0)*Number(form.elements.overhead_per_hour.value||0)/60;
  const total=materialCost+labor+overhead;
  $('productionCost').innerHTML=`<strong>Materiál:</strong> ${money(materialCost)} · <strong>Práce:</strong> ${money(labor)} · <strong>Režie:</strong> ${money(overhead)}<br><strong>Celkem za várku:</strong> ${money(total)} · <strong>Na kus:</strong> ${money(total/q)}${insufficient.length?'<p class="warning"><strong>Upozornění: podle skladových pohybů může chybět materiál.</strong><br>'+insufficient.map(safe).join('<br>')+'</p>':''}`;
}
async function createProduction(event) {
  event.preventDefault();
  const f=new FormData(event.target), candleId=f.get('candle_id'), quantity=Number(f.get('quantity'));
  if (!recipeRowsFor(candleId).length) { notice('Výrobu nelze zapsat bez uložené receptury.'); return; }
  let items=[];
  for (const row of $('productionRecipe').querySelectorAll('.production-row')) {
    const amount=Number(row.querySelector('.production-qty').value);
    if (!(amount>0)) { notice('Zkontroluj množství každého materiálu ve várce.'); return; }
    const material=materials.find(m=>m.id===row.dataset.materialId);
    if (!material) { notice('Některý materiál už není v seznamu. Obnov stránku a zkontroluj recepturu.'); return; }
    items.push({material_id:material.id,material_name:material.name,quantity_used:amount,unit:material.unit,unit_cost:Number(material.price_per_unit)});
  }
  if (!items.length) { notice('Receptura neobsahuje žádné materiály.'); return; }
  const materialCost=items.reduce((s,i)=>s+i.quantity_used*i.unit_cost,0);
  const laborMinutes=Number(f.get('labor_minutes')||0), hourlyRate=Number(f.get('hourly_rate')||0), overheadRate=Number(f.get('overhead_per_hour')||0);
  const totalCost=materialCost+laborMinutes*hourlyRate/60+laborMinutes*overheadRate/60;
  const warnings=items.filter(i=>i.quantity_used>stockFor(i.material_id));
  let confirmText=`Zapsat výrobu ${quantity} ks?\n\nMateriál: ${money(materialCost)}\nPráce: ${money(laborMinutes*hourlyRate/60)}\nRežie: ${money(laborMinutes*overheadRate/60)}\nCelkem: ${money(totalCost)} (${money(totalCost/quantity)} / kus)`;
  if(warnings.length) confirmText+='\n\nPOZOR — podle skladových pohybů může chybět:\n'+warnings.map(i=>`${i.material_name}: potřeba ${i.quantity_used} ${i.unit}, sklad ${stockFor(i.material_id)} ${i.unit}`).join('\n')+'\n\nChceš přesto pokračovat?';
  if(!confirm(confirmText)) return;
  const batch={workshop_id:workshopId,candle_id:candleId,color:f.get('color'),quantity,produced_at:f.get('produced_at'),labor_minutes:laborMinutes,hourly_rate:hourlyRate,overhead_per_hour:overheadRate,material_cost_total:materialCost,notes:f.get('notes')||null};
  const {data:batchData,error:batchError}=await db.from('batches').insert(batch).select('id').single();
  if(batchError){notice('Výroba nebyla zapsána: '+batchError.message);return;}
  const batchId=batchData.id;
  const batchMaterialRows=items.map(i=>({workshop_id:workshopId,batch_id:batchId,material_id:i.material_id,material_name:i.material_name,quantity_used:i.quantity_used,unit:i.unit,unit_cost:i.unit_cost}));
  const {error:bmError}=await db.from('batch_materials').insert(batchMaterialRows);
  if(bmError){notice('VAROVÁNÍ: dávka '+batchId+' je vytvořená, ale spotřeba se neuložila: '+bmError.message+'. Neopakuj výrobu; je nutné opravit tuto dávku.');return;}
  const movementRows=items.map(i=>({workshop_id:workshopId,material_id:i.material_id,purchase_item_id:null,movement_type:'production',quantity_delta:-i.quantity_used,unit:i.unit,unit_cost:i.unit_cost,notes:`Spotřeba při výrobě dávky ${batchId}`})); 
  const {error:movementError}=await db.from('stock_movements').insert(movementRows);
  if(movementError){notice('VAROVÁNÍ: dávka i spotřeba byly uloženy, ale skladové pohyby se neuložily: '+movementError.message+'. Neopakuj výrobu; je nutné opravit skladové pohyby.');return;}
  event.target.reset();
  event.target.elements.hourly_rate.value=240;
  event.target.elements.produced_at.value=localDate();
  await loadAll();
  notice(`Výroba byla zapsána. Náklady na materiál ${money(materialCost)}, celkem ${money(totalCost)}.`);
}

$('loginButton').addEventListener('click',signIn);
$('logoutButton').addEventListener('click',signOut);
$('purchasesButton').addEventListener('click',()=>location.href='/nakupy.html');
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
$('recipeCandleSelect').addEventListener('change',renderRecipeEditor);
$('candleSelect').addEventListener('change',renderProductionRecipe);
$('addRecipeMaterial').addEventListener('click',()=>{
  const host=$('recipeEditor');
  if(host.querySelector('.muted') && !host.querySelector('.recipe-row')) host.innerHTML='';
  host.insertAdjacentHTML('beforeend',recipeRowHtml());
  bindRecipeRows(host);
});
$('saveRecipe').addEventListener('click',saveRecipe);
$('batchQuantity').addEventListener('input',renderProductionRecipe);
['labor_minutes','hourly_rate','overhead_per_hour'].forEach(n=>$('batchForm').elements[n].addEventListener('input',updateProductionCost));
$('candleForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  const {error}=await db.from('candles').insert({workshop_id:workshopId,name:f.get('name'),weight_g:Number(f.get('weight_g')),suggested_price:Number(f.get('suggested_price')||0),description:f.get('description')||null});
  if(error){notice('Chyba při ukládání svíčky: '+error.message);return;}
  e.target.reset();await loadAll();notice('Svíčka byla uložena.');
});
$('materialForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target);
  const {error}=await db.from('materials').insert({workshop_id:workshopId,name:f.get('name'),unit:f.get('unit'),price_per_unit:Number(f.get('price_per_unit'))});
  if(error){notice('Chyba při ukládání materiálu: '+error.message);return;}
  e.target.reset();await loadAll();notice('Materiál byl uložen.');
});
$('batchForm').addEventListener('submit',createProduction);

async function init(){
  const {data:{user},error}=await db.auth.getUser();
  if(error){message('loginMsg','Chyba přihlášení: '+error.message);return;}
  currentUser=user;
  if(!user){$('app').classList.add('hidden');$('login').classList.remove('hidden');return;}
  try{await loadWorkshop();}catch(e){message('loginMsg','Nepodařilo se načíst společnou dílnu: '+e.message);return;}
  $('login').classList.add('hidden');$('app').classList.remove('hidden');$('who').textContent=user.email;
  $('batchForm').elements.produced_at.value=localDate();
  try{await loadAll();}catch(e){notice('Nepodařilo se načíst data: '+e.message);}
}
db.auth.onAuthStateChange((_event,session)=>{if(session?.user)setTimeout(()=>init(),0);});
init();

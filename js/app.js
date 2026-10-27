const db = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabasePublishableKey);
let currentUser=null, candles=[], materials=[], batches=[];
 let workshopId = null;

async function loadWorkshop() {
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Nejsi přihlášený.');

  const { data, error } = await db
    .from('workshop_members')
    .select('workshop_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (error) throw error;
  workshopId = data.workshop_id;
}
const $=id=>document.getElementById(id);
function message(id,text){$(id).textContent=text;$(id).classList.remove('hidden')}
function notice(text){message('notice',text)}
function money(v){return Number(v||0).toLocaleString('cs-CZ',{style:'currency',currency:'CZK'})}
async function signIn(){
 const email=$('email').value.trim(),password=$('password').value;
 $('loginMsg').classList.add('hidden');
 const {error}=await db.auth.signInWithPassword({email,password});
 if(error){message('loginMsg','Přihlášení se nepodařilo: '+error.message);return}
 await init();
}
async function signOut(){await db.auth.signOut();location.reload()}
function showTab(tab){
 ['home','candles','materials','batches'].forEach(t=>$('tab-'+t).classList.toggle('hidden',t!==tab));
}
function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function loadAll(){
 let results=await Promise.all([
 db.from('candles').select('*').order('created_at',{ascending:false}),
 db.from('materials').select('*').order('name'),
 db.from('batches').select('*,candles(name,weight_g,suggested_price)').order('created_at',{ascending:false})
 ]);
 for(let r of results){if(r.error)throw r.error}
 candles=results[0].data||[];materials=results[1].data||[];batches=results[2].data||[];
 render();
}
function render(){
 $('countCandles').textContent=candles.length;
 $('countBatches').textContent=batches.length;
 $('stock').textContent=batches.reduce((s,b)=>s+Number(b.quantity||0),0);
 $('candlesList').innerHTML=candles.length?'<div class="tablewrap"><table><tr><th>Název</th><th>Hmotnost</th><th>Doporučená cena</th></tr>'+candles.map(c=>`<tr><td>${safe(c.name)}</td><td>${c.weight_g} g</td><td>${money(c.suggested_price)}</td></tr>`).join('')+'</table></div>':'<p class="muted">Zatím tu nejsou žádné svíčky.</p>';
 $('materialsList').innerHTML=materials.length?'<div class="tablewrap"><table><tr><th>Materiál</th><th>Jednotka</th><th>Cena/jednotku</th></tr>'+materials.map(m=>`<tr><td>${safe(m.name)}</td><td>${safe(m.unit)}</td><td>${money(m.price_per_unit)}</td></tr>`).join('')+'</table></div>':'<p class="muted">Zatím tu nejsou žádné materiály.</p>';
 $('candleSelect').innerHTML='<option value="">Vyber svíčku</option>'+candles.map(c=>`<option value="${c.id}">${safe(c.name)} (${c.weight_g} g)</option>`).join('');
 $('batchesList').innerHTML=batches.length?'<div class="tablewrap"><table><tr><th>Datum</th><th>Svíčka</th><th>Barva</th><th>Kusy</th><th>Náklad/kus</th><th>Prodejní cena</th></tr>'+batches.map(b=>{
 const labor=Number(b.labor_minutes)*Number(b.hourly_rate)/60;
 const overhead=Number(b.labor_minutes)*Number(b.overhead_per_hour)/60;
 const unitCost=(Number(b.material_cost_total)+labor+overhead)/Number(b.quantity);
 return `<tr><td>${safe(b.produced_at)}</td><td>${safe(b.candles?.name||'')}</td><td>${safe(b.color)}</td><td>${b.quantity}</td><td>${money(unitCost)}</td><td>${money(b.candles?.suggested_price||0)}</td></tr>`
 }).join('')+'</table></div>':'<p class="muted">Zatím tu nejsou žádné dávky.</p>';
}
$('candleForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.target);
 const row={workshop_id: workshopId, name:f.get('name'),weight_g:Number(f.get('weight_g')),suggested_price:Number(f.get('suggested_price')),description:f.get('description')||null};
 const {error}=await db.from('candles').insert(row);if(error){notice('Chyba: '+error.message);return}
 e.target.reset();await loadAll();notice('Svíčka byla uložena.');
});
$('materialForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.target);
 const {error}=await db.from('materials').insert({workshop_id: workshopId, name:f.get('name'),unit:f.get('unit'),price_per_unit:Number(f.get('price_per_unit'))});
 if(error){notice('Chyba: '+error.message);return}
 e.target.reset();await loadAll();notice('Materiál byl uložen.');
});
$('batchForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.target);
 const row={workshop_id: workshopId, candle_id:f.get('candle_id'),color:f.get('color'),quantity:Number(f.get('quantity')),produced_at:f.get('produced_at'),labor_minutes:Number(f.get('labor_minutes')||0),hourly_rate:Number(f.get('hourly_rate')||240),overhead_per_hour:Number(f.get('overhead_per_hour')||0),material_cost_total:Number(f.get('material_cost_total')||0),notes:f.get('notes')||null};
 const {error}=await db.from('batches').insert(row);if(error){notice('Chyba: '+error.message);return}
 e.target.reset();e.target.elements.hourly_rate.value=240;e.target.elements.produced_at.value=new Date().toISOString().slice(0,10);await loadAll();notice('Výroba byla zapsána.');
});
async function init(){
 const {data:{user}}=await db.auth.getUser();currentUser=user;
 if(!user){$('app').classList.add('hidden');$('login').classList.remove('hidden');return}
 try { await loadWorkshop(); } catch(e) { message('loginMsg','Nepodařilo se načíst společnou dílnu: '+e.message); return; }
 $('login').classList.add('hidden');$('app').classList.remove('hidden');$('who').textContent=user.email;
 $('batchForm').elements.produced_at.value=new Date().toISOString().slice(0,10);
 try{await loadAll()}catch(e){notice('Nepodařilo se načíst data: '+e.message)}
}
db.auth.onAuthStateChange((_event,session)=>{
 if(session?.user){setTimeout(()=>init(),0)}
});
init();

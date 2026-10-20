/* PACKLAB Accounts v0.9 — optional authenticated sync, separate from AFewBuds save tables.
 * Publishable key only. Supabase Auth handles passwords and refresh tokens.
 * Two independent optimistic-concurrency save slots: game and physical portfolio.
 */
(()=>{
'use strict';
const PROJECT_URL='https://nlrrnhdcjrnfuftyoaqn.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_f8LrZYozO8h2xAvn90L-gw_dZiaUwTY';
const CLOUD_TABLE='packlab_cloud_saves';
const PROFILE_TABLE='packlab_profiles';
const KEYS={game:'packlab_save_v01',portfolio:'packlab_real_card_portfolio_v1'};
const SLOT_NAMES={game:'Game progress',portfolio:'Real Card Portfolio'};
const DEVICE_USER='packlab_cloud_device_user_v09';
const GUEST_PREFIX='packlab_guest_backup_v09_';
const LINKS_PREFIX='packlab_cloud_links_v09_';
const SAVE_DELAY=1100;
const badge=document.getElementById('cloudAccountButton');
const layer=document.getElementById('cloudAccountLayer');
let client=null, currentUser=null, username='', busy=false, authScreen='signin';
let message='', messageError=false, sessionToken=0, restoreInProgress=false;
const slots={game:makeSlot(),portfolio:makeSlot()};
let lastPoll=0;
function makeSlot(){return {remote:null,rev:null,enabled:false,syncedHash:null,dirty:false,error:'',busy:false,timer:null,conflict:false};}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage=(key)=>{try{return localStorage.getItem(key);}catch{return null;}};
const setStorage=(key,value)=>{try{localStorage.setItem(key,value);return true;}catch{return false;}};
function parseJson(x,fallback){try{return x?JSON.parse(x):fallback;}catch{return fallback;}}
function hashString(str){let h=2166136261;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619)>>>0;return `${str.length}:${h.toString(16)}`;}
function slotValue(slot){return slot==='game'?state:realPortfolio;}
function localHash(slot){const data=slotValue(slot);return hashString(JSON.stringify(data));}
function linkKey(){return LINKS_PREFIX+(currentUser?.id||'');}
function getLinks(){return parseJson(storage(linkKey()),{});}
function setLink(slot){if(!currentUser)return;const links=getLinks();const x=slots[slot];links[slot]={revision:x.rev,hash:x.syncedHash,at:Date.now()};setStorage(linkKey(),JSON.stringify(links));}
function isValidSave(slot,payload){if(!payload||typeof payload!=='object'||payload.schema!==1)return false;
 if(slot==='game')return Array.isArray(payload.collection)&&payload.collection.length<=50000&&typeof payload.coins==='number'&&!!payload.packs;
 return Array.isArray(payload.entries)&&payload.entries.length<=20000;
}
function hasProgress(slot){if(slot==='game')return Number(state?.stats?.opened||0)>0||state.collection?.length>0||Number(state?.stats?.won||0)>0;return !!realPortfolio.entries?.length;}
function countSummary(slot,payload){if(!payload)return 'No save';
 if(slot==='game')return `${(payload.collection||[]).length.toLocaleString()} cards · ${(payload.stats?.opened||0).toLocaleString()} packs opened`;
 return `${(payload.entries||[]).length.toLocaleString()} entries · ${(payload.entries||[]).reduce((n,r)=>n+(Number(r.quantity)||1),0).toLocaleString()} cards`;
}
function timeLabel(d){if(!d)return 'Not saved';const a=new Date(d);return Number.isNaN(+a)?'Unknown date':a.toLocaleString();}
function textStatus(text,isError=false){message=text||'';messageError=!!isError;updateBadge();if(!layer.hidden)renderAccount();}
function updateBadge(){if(!badge)return;const saving=Object.values(slots).some(s=>s.busy||s.dirty&&s.enabled);
 const error=Object.values(slots).some(s=>s.conflict||s.error);
 const name=currentUser?(username||currentUser.email?.split('@')[0]||'Account'):'Account';
 badge.textContent=currentUser?(error?'⚠ Sync issue':saving?'◷ Syncing':`☁ ${name}`):'☁ Account';
 badge.title=currentUser?`${currentUser.email} · ${error?'Cloud needs attention':saving?'Saving changes':'Open cloud account / edit Trainer Name'}`:'Account: sign in, register, and sync game + physical collection';
 badge.classList.toggle('cloud-problem',error);
}
function showAccount(){if(!layer)return;layer.hidden=false;renderAccount();}
function hideAccount(){if(layer)layer.hidden=true;}
function renderAccount(){if(layer.hidden)return;
 let inner='';
 if(!client){inner=`<div class="cloud-notice danger">Account service could not load. The game still works as a guest. Check your connection and reload.</div>`;}
 else if(!currentUser){const signup=authScreen==='signup';const recover=authScreen==='reset';
 inner=`<div class="cloud-auth-switch"><button type="button" data-cloud="tab-signin" class="${!signup&&!recover?'current':''}">Sign in</button><button type="button" data-cloud="tab-signup" class="${signup?'current':''}">Create account</button></div>
 <p class="cloud-subtext">${recover?'Request a password-reset link.':'Sign in on phone and PC to use the same game binder and physical-card portfolio. Guest play stays available. <strong>Your Trainer Name can be edited under My Account after signing in.</strong>'}</p>
 <form id="packlabAccountForm" autocomplete="on"><input type="hidden" name="mode" value="${recover?'reset':signup?'signup':'signin'}"/>
 ${signup?'<label>Trainer Name<input name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" placeholder="TrainerName"></label>':''}
 <label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
 ${!recover?`<label>Password<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" required minlength="8" placeholder="At least 8 characters"></label>`:''}
 <button class="primary-action full" type="submit" ${busy?'disabled':''}>${busy?'Working…':recover?'Send reset link':signup?'Create account':'Sign in'}</button></form>
 <div class="cloud-links">${recover?'<button data-cloud="tab-signin">Back to sign in</button>':!signup?'<button data-cloud="tab-reset">Forgot password?</button>':''}<button data-cloud="close">Continue as guest</button></div>
 <p class="cloud-small">Email verification may be required. Passwords are handled by Supabase Auth, not stored in game saves.</p>`;
 }else if(authScreen==='recovery'){
 inner=`<div class="cloud-user-summary"><div><strong>Reset account password</strong><span>${esc(currentUser.email||'')}</span></div></div><p class="cloud-subtext">Your password-reset link was verified. Choose a new password.</p><form id="packlabAccountForm"><input type="hidden" name="mode" value="change-password"><label>New password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label><button class="primary-action full" type="submit">Update password</button></form>`;
 }else {
 const parts=Object.keys(slots).map(slot=>{
 const x=slots[slot],local=slotValue(slot),remote=x.remote;
 const remoteTxt=remote?`${countSummary(slot,remote.payload)} · ${timeLabel(remote.updated_at)}`:'No cloud save yet';
 const localTxt=countSummary(slot,local);
 const synced=x.enabled&&!x.conflict;
 return `<div class="cloud-save-slot"><div class="cloud-save-head"><strong>${esc(SLOT_NAMES[slot])}</strong><span class="cloud-status ${synced?'ready':x.conflict?'warning':''}">${synced?(x.busy?'Saving…':'Cloud linked'):x.conflict?'Version conflict':'Not linked'}</span></div>
 <div class="cloud-slot-summary"><span>ON THIS DEVICE</span><strong>${esc(localTxt)}</strong><span>IN ACCOUNT</span><strong>${esc(remoteTxt)}</strong></div>
 ${x.error?`<p class="cloud-danger">${esc(x.error)}</p>`:''}
 <div class="cloud-slot-actions">${!synced?`${remote?`<button type="button" class="primary-action small-button" data-cloud="load-${slot}" ${busy?'disabled':''}>↓ Use account save</button><button type="button" class="secondary-action small-button" data-cloud="upload-${slot}" ${busy?'disabled':''}>↑ Replace with this device</button>`:`<button type="button" class="primary-action small-button" data-cloud="upload-${slot}" ${busy?'disabled':''}>↑ Save this device to account</button>`}`:
 `<button type="button" class="secondary-action small-button" data-cloud="refresh-${slot}" ${x.busy?'disabled':''}>↻ Sync now</button>`}</div>
 </div>`;
 }).join('');
 inner=`<div class="cloud-user-summary"><div><strong>${esc(username||currentUser.user_metadata?.username||'PACKLAB Collector')}</strong><span>${esc(currentUser.email||'')}</span></div><button type="button" class="secondary-action small-button" data-cloud="logout">Sign out</button></div>
 <form id="packlabTrainerNameForm" class="cloud-trainer-form"><label for="cloudTrainerName">Trainer Name</label><div class="cloud-trainer-fields"><input id="cloudTrainerName" name="trainerName" autocomplete="nickname" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" value="${esc(username||'')}" required><button type="submit" class="secondary-action" ${busy?'disabled':''}>Save Trainer Name</button></div><small>3–20 letters, numbers or underscores. Names are unique regardless of capitalization.</small></form>
 ${username.startsWith("Player_")?`<p class="cloud-small">This account still has an automatically generated Player_ name. Enter the Trainer Name you want above, then press Save Trainer Name.</p>`:""}
 <p class="cloud-subtext">For each collection, choose the save to keep on this device. If both have progress, nothing is overwritten until you choose. Changes sync automatically after linking.</p>${parts}
 <p class="cloud-small">A different signed-in device will load the account copy. Simultaneous edits use revision checks; conflicts require your choice. Use Export Save and Portfolio Export for extra backups.</p>`;
 }
 layer.innerHTML=`<div class="cloud-modal" role="dialog" aria-modal="true" aria-label="FFDPackLabs account and Trainer Name" tabindex="-1"><div class="cloud-modal-head"><div><small>FFDPACKLABS ACCOUNT</small><h2>${currentUser?'Your synced account':'Sign in or create an account'}</h2></div><button type="button" class="cloud-close" data-cloud="close" aria-label="Close account window">×</button></div>
 ${message?`<div class="cloud-notice ${messageError?'danger':''}">${esc(message)}</div>`:''}${inner}</div>`;
}
function validateLocal(slot){const payload=JSON.parse(JSON.stringify(slotValue(slot)));if(!isValidSave(slot,payload))throw Error(`This device's ${SLOT_NAMES[slot]} save is not valid. Export it before continuing.`);const size=new TextEncoder().encode(JSON.stringify(payload)).length;if(size>8*1024*1024)throw Error('Save is larger than the 8 MB cloud limit. Export your collection and reduce its size.');return payload;}
function backupGuestOnce(){if(!currentUser)return;const active=storage(DEVICE_USER);if(active===currentUser.id)return;
 if(active&&active!==currentUser.id)throw Error('Another account is already active on this browser. Sign out first.');
 for(const slot of Object.keys(KEYS)){const v=storage(KEYS[slot]);if(v!==null&&storage(GUEST_PREFIX+slot)===null)setStorage(GUEST_PREFIX+slot,v);}
 setStorage(DEVICE_USER,currentUser.id);
}
function restoreGuest(){for(const slot of Object.keys(KEYS)){const existing=storage(GUEST_PREFIX+slot);
 if(existing!==null){setStorage(KEYS[slot],existing);try{localStorage.removeItem(GUEST_PREFIX+slot);}catch{}}
 else if(storage(DEVICE_USER)){if(slot==='game')setStorage(KEYS[slot],JSON.stringify(freshState()));else setStorage(KEYS[slot],JSON.stringify({schema:1,entries:[],updatedAt:Date.now()}));}}
 try{localStorage.removeItem(DEVICE_USER);}catch{}
 state=loadSave();realPortfolio=loadRealPortfolio();render();
}
function applyRemote(slot,payload){if(!isValidSave(slot,payload))throw Error('Invalid cloud save. Local data was not changed.');
 if(!setStorage(KEYS[slot],JSON.stringify(payload)))throw Error('This device has no storage space to load your account.');
 if(slot==='game'){state=loadSave();state.battle=null; // never resume a stale quick battle across devices
 }else {realPortfolio=loadRealPortfolio();}
 render();
}
function linkSlot(slot,remoteRow){const x=slots[slot];x.rev=Number(remoteRow.revision);x.remote=remoteRow;x.enabled=true;x.dirty=false;x.conflict=false;x.error='';x.syncedHash=localHash(slot);setLink(slot);updateBadge();}
async function readServerRows(){if(!client||!currentUser)return[];
 const {data,error}=await client.from(CLOUD_TABLE).select('slot,payload,revision,updated_at').eq('user_id',currentUser.id);
 if(error)throw error;return data||[];}
async function readProfile(){const {data,error}=await client.from(PROFILE_TABLE).select('username').eq('user_id',currentUser.id).maybeSingle();if(error)throw error;
 const saved=String(data?.username||'');
 const signupName=String(currentUser.user_metadata?.username||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,20);
 if(saved){
  // Only repair known auto-generated placeholders. Never overwrite a player-chosen name.
  const placeholders=['Player_'+currentUser.id.slice(0,7),'Player_'+currentUser.id.replaceAll('-','').slice(0,12)];
  if(placeholders.includes(saved)&&signupName.length>=3&&signupName.toLowerCase()!==saved.toLowerCase()){
   const {data:repaired,error:repairError}=await client.from(PROFILE_TABLE).update({username:signupName}).eq('user_id',currentUser.id).select('username').maybeSingle();
   if(!repairError&&repaired?.username){username=repaired.username;return;}
  }
  username=saved;return;
 }
 let desired=signupName;
 if(desired.length<3)desired='Player_'+currentUser.id.slice(0,7);
 let {error:putError}=await client.from(PROFILE_TABLE).insert({user_id:currentUser.id,username:desired});
 if(putError){const fallback='Player_'+currentUser.id.replaceAll('-','').slice(0,12);
 const result=await client.from(PROFILE_TABLE).insert({user_id:currentUser.id,username:fallback});
 if(result.error&&!String(result.error.code).includes('23505'))throw result.error;
 desired=fallback;
 }
 username=desired;
}
async function connectAccount(user){const ticket=++sessionToken;
 currentUser=user;username=String(user.user_metadata?.username||'');clearTimers();
 for(const slot of Object.keys(slots))Object.assign(slots[slot],makeSlot());
 updateBadge();
 try{
 await readProfile();const rows=await readServerRows();if(ticket!==sessionToken)return;
 const bySlot=Object.fromEntries(rows.map(x=>[x.slot,x]));
 const linked=storage(DEVICE_USER)===user.id?getLinks():{};
 for(const slot of Object.keys(slots)){
 const x=slots[slot],remote=bySlot[slot]||null,meta=linked[slot];x.remote=remote;x.rev=remote?Number(remote.revision):null;
 if(remote&&!isValidSave(slot,remote.payload)){x.error='Cloud save failed validation. Contact support; it was not applied.';continue;}
 if(meta&&remote){
   const fp=localHash(slot),rev=Number(meta.revision),remoteRev=Number(remote.revision);
   if(rev===remoteRev){x.enabled=true;x.syncedHash=meta.hash;x.dirty=fp!==meta.hash; if(x.dirty)schedulePush(slot);}
   else if(fp===meta.hash){backupGuestOnce();applyRemote(slot,remote.payload);linkSlot(slot,remote);}
   else {x.conflict=true;x.error='Both devices have changes. Choose the copy you want to keep.';}
 }else if(meta&&!remote){x.conflict=true;x.error='The account copy is missing. Choose whether to upload this device.';}
 else if(remote&&hashString(JSON.stringify(remote.payload))===localHash(slot)){backupGuestOnce();linkSlot(slot,remote);}
 }
 message='Signed in. Choose how to link each save if needed.';messageError=false;
 }catch(err){message='Signed in, but cloud saves could not be read: '+(err?.message||'Network unavailable');messageError=true;
 for(const x of Object.values(slots))x.error='Cloud connection unavailable; your local save is safe.';
 }
 updateBadge();if(!layer.hidden)renderAccount();
}
function clearTimers(){for(const x of Object.values(slots))if(x.timer){clearTimeout(x.timer);x.timer=null;}}
function changed(slot){const x=slots[slot];if(!currentUser||!x?.enabled||x.conflict||restoreInProgress)return;
 x.dirty=localHash(slot)!==x.syncedHash;if(x.dirty)schedulePush(slot);updateBadge();
}
function schedulePush(slot){const x=slots[slot];if(!x.enabled||x.conflict)return;if(x.timer)clearTimeout(x.timer);
 x.timer=setTimeout(()=>{x.timer=null;void pushSlot(slot);},SAVE_DELAY);
}
async function pushSlot(slot){const x=slots[slot];if(!currentUser||!client||!x.enabled||x.conflict||x.busy)return;
 const userId=currentUser.id,payload=validateLocal(slot),fp=hashString(JSON.stringify(payload));
 if(x.syncedHash===fp){x.dirty=false;updateBadge();return;}
 x.busy=true;x.dirty=true;x.error='';updateBadge();const rev=x.rev;
 try{
 let result;if(rev===null){result=await client.from(CLOUD_TABLE).insert({user_id:userId,slot,payload,revision:1}).select('slot,payload,revision,updated_at');}
 else {result=await client.from(CLOUD_TABLE).update({payload,revision:rev+1,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('slot',slot).eq('revision',rev).select('slot,payload,revision,updated_at');}
 if(result.error){if(result.error.code==='23505'){throw Object.assign(new Error('Cloud save was created on another device.'),{conflict:true});}throw result.error;}
 if(!result.data?.length)throw Object.assign(new Error('The cloud version changed on another device.'),{conflict:true});
 if(!currentUser||currentUser.id!==userId)return;
 const row=result.data[0];x.rev=Number(row.revision);x.remote=row;x.syncedHash=fp;x.conflict=false;x.error='';setLink(slot);
 x.dirty=localHash(slot)!==fp;if(x.dirty)schedulePush(slot);
 }catch(e){x.error=e.message||'Cloud save failed';if(e.conflict){x.conflict=true;x.enabled=false;
 try{const rows=await readServerRows();x.remote=rows.find(r=>r.slot===slot)||null;x.rev=x.remote?Number(x.remote.revision):null;}catch{}}
 else {x.dirty=true;}}
 finally{x.busy=false;updateBadge();if(!layer.hidden)renderAccount();}
}
async function chooseUpload(slot){if(!currentUser||busy)return;const x=slots[slot];const payload=validateLocal(slot);if(x.remote){
 const yes=confirm(`Replace the account's ${SLOT_NAMES[slot]} with this device's data?\n\nCLOUD: ${countSummary(slot,x.remote.payload)}\nDEVICE: ${countSummary(slot,payload)}\n\nThis replaces the cloud copy. Export a backup first if unsure.`);if(!yes)return;
 }
 busy=true;updateBadge();if(!layer.hidden)renderAccount();
 try{backupGuestOnce();const expected=x.remote?Number(x.remote.revision):null;let out;
 if(expected===null)out=await client.from(CLOUD_TABLE).insert({user_id:currentUser.id,slot,payload,revision:1}).select('slot,payload,revision,updated_at');
 else out=await client.from(CLOUD_TABLE).update({payload,revision:expected+1,updated_at:new Date().toISOString()}).eq('user_id',currentUser.id).eq('slot',slot).eq('revision',expected).select('slot,payload,revision,updated_at');
 if(out.error)throw out.error;if(!out.data?.length)throw Error('Cloud changed before this upload. Close and reopen the account panel to choose again.');
 linkSlot(slot,out.data[0]);message=`${SLOT_NAMES[slot]} saved to your account.`;messageError=false;
 }catch(err){message=err.message||'Upload failed.';messageError=true;}
 finally{busy=false;updateBadge();renderAccount();}
}
async function chooseLoad(slot){if(!currentUser||busy)return;const x=slots[slot];if(!x.remote)return;
 if(hasProgress(slot)&&localHash(slot)!==hashString(JSON.stringify(x.remote.payload))){
  if(!confirm(`Load the account's ${SLOT_NAMES[slot]} on this device? The current device copy will be replaced. You can export a backup first.`))return;}
 busy=true;try{backupGuestOnce();restoreInProgress=true;applyRemote(slot,x.remote.payload);restoreInProgress=false;linkSlot(slot,x.remote);message=`${SLOT_NAMES[slot]} loaded from your account.`;messageError=false;}
 catch(err){restoreInProgress=false;message=err.message||'Download failed';messageError=true;}finally{busy=false;renderAccount();}
}
async function manualRefresh(slot){const x=slots[slot];if(!currentUser||busy||x.busy)return;
 x.busy=true;updateBadge();try{const rows=await readServerRows();const row=rows.find(r=>r.slot===slot);
 if(!row){x.error='No cloud save found.';return;}
 if(x.dirty||localHash(slot)!==x.syncedHash){x.busy=false;await pushSlot(slot);return;}
 if(row.revision!==x.rev){restoreInProgress=true;applyRemote(slot,row.payload);restoreInProgress=false;linkSlot(slot,row);message=`${SLOT_NAMES[slot]} updated from another device.`;messageError=false;}
 else message='Your '+SLOT_NAMES[slot]+' is already up to date.';
 }catch(e){x.error=e.message||'Sync failed';restoreInProgress=false;}finally{x.busy=false;updateBadge();renderAccount();}
}
async function pollRemote(){if(!currentUser||busy||document.hidden)return;const now=Date.now();if(now-lastPoll<35000)return;lastPoll=now;
 try{const data=await readServerRows();for(const slot of Object.keys(slots)){const x=slots[slot];if(!x.enabled||x.busy||x.conflict)continue;const row=data.find(v=>v.slot===slot);if(!row||Number(row.revision)<=x.rev)continue;
  if(x.dirty||localHash(slot)!==x.syncedHash){x.enabled=false;x.conflict=true;x.error='Another device has a newer save. Choose which copy to keep.';x.remote=row;x.rev=Number(row.revision);}
  else {restoreInProgress=true;applyRemote(slot,row.payload);restoreInProgress=false;linkSlot(slot,row);}
 }}catch(e){console.warn('PACKLAB cloud refresh unavailable',e?.message);}finally{restoreInProgress=false;updateBadge();}
}
async function signOut(){if(!client||!currentUser)return;const activeDirty=Object.values(slots).some(s=>s.enabled&&(s.dirty||s.busy)||s.conflict);
 if(activeDirty&&!confirm('Some progress may not be saved to your account. Export a backup or resolve sync conflicts first. Sign out anyway?'))return;
 const oldUser=currentUser;busy=true;renderAccount();try{await client.auth.signOut();currentUser=null;username='';sessionToken++;clearTimers();
 if(storage(DEVICE_USER)===oldUser.id){const links=parseJson(storage(LINKS_PREFIX+oldUser.id),{});for(const slot of Object.keys(KEYS)){if(!links[slot]&&storage(GUEST_PREFIX+slot)!==null){const current=storage(KEYS[slot]);if(current!==null)setStorage(GUEST_PREFIX+slot,current);}}restoreGuest();}
 for(const slot of Object.keys(slots))Object.assign(slots[slot],makeSlot());message='Signed out. Guest progress is available on this device.';messageError=false;
 }catch(e){message=e.message||'Sign out failed.';messageError=true;}finally{busy=false;updateBadge();renderAccount();}
}
async function processTrainerNameSubmit(e){
 e.preventDefault();if(!client||!currentUser||busy)return;
 const next=String(new FormData(e.target).get('trainerName')||'').trim();
 if(!/^[A-Za-z0-9_]{3,20}$/.test(next)){textStatus('Trainer Name must use 3–20 letters, numbers, or underscores.',true);return;}
 if(next===username){textStatus('This is already your Trainer Name.');return;}
 busy=true;message='';renderAccount();
 try{
  const {data,error}=await client.from(PROFILE_TABLE).update({username:next}).eq('user_id',currentUser.id).select('username').single();
  if(error)throw error;
  username=data.username;
  // The RLS-protected profile row is authoritative. Metadata is only a recovery hint.
  const metadataResult=await client.auth.updateUser({data:{username}});
  if(metadataResult.error)console.warn('Could not update Trainer Name metadata hint',metadataResult.error.message);
  message='Trainer Name saved to your account.';messageError=false;
 }catch(err){
  message=err?.code==='23505'?'This Trainer Name is already taken. Try a different name.':(err?.message||'Unable to update Trainer Name.');
  messageError=true;
 }finally{busy=false;renderAccount();updateBadge();}
}
async function processAccountSubmit(e){e.preventDefault();if(busy||!client)return;const d=new FormData(e.target),mode=d.get('mode'),email=String(d.get('email')||'').trim(),password=String(d.get('password')||'');
 if((mode!=='change-password'&&(!email||!email.includes('@')))||(mode!=='reset'&&password.length<8)){textStatus('Use a valid email and a password with at least 8 characters.',true);return;}
 const name=String(d.get('username')||'').trim();if(mode==='signup'&&!/^[A-Za-z0-9_]{3,20}$/.test(name)){textStatus('Trainer Name must be 3–20 letters, numbers or underscores.',true);return;}
 busy=true;message='';renderAccount();try{
 if(mode==='change-password'){const {error}=await client.auth.updateUser({password});if(error)throw error;authScreen='signin';message='Password changed.';}
 else if(mode==='signin'){const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;if(data?.session){message='Signed in. Loading account saves…';if(data.user)await connectAccount(data.user);}else message='Check your email to finish signing in.';}
 else if(mode==='signup'){const redirectTo='https://ffdevelopment.github.io/FFDPackLab/';const {data,error}=await client.auth.signUp({email,password,options:{data:{username:name},emailRedirectTo:redirectTo}});if(error)throw error;
 if(data?.session&&data.user){await connectAccount(data.user);message='Account created. Choose which device saves to upload.';}
 else {authScreen='signin';message='Account registered. Check your email for a verification link, then return here and sign in. If the email goes to the wrong site, the PACKLAB redirect URL needs adding in Supabase Auth settings.';}
 }else if(mode==='reset'){const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:'https://ffdevelopment.github.io/FFDPackLab/'});if(error)throw error;authScreen='signin';message='If this email is registered, a password reset email has been sent.';}
 messageError=false;
 }catch(err){message=err.message||'Account request failed.';messageError=true;}finally{busy=false;renderAccount();updateBadge();}
}
function accountEvent(e){const target=e.target.closest('[data-cloud]');if(!target||layer.hidden)return;e.preventDefault();const action=target.dataset.cloud;
 if(action==='close'){hideAccount();return;}
 if(action.startsWith('tab-')){authScreen=action.slice(4);message='';messageError=false;renderAccount();return;}
 if(action==='logout'){void signOut();return;}
 for(const slot of Object.keys(slots)){if(action===`load-${slot}`){void chooseLoad(slot);return;}
 if(action===`upload-${slot}`){void chooseUpload(slot);return;}
 if(action===`refresh-${slot}`){void manualRefresh(slot);return;}}
}
async function init(){updateBadge();if(!layer||!badge)return;
 badge.addEventListener('click',showAccount);
 layer.addEventListener('click',e=>{if(e.target===layer)hideAccount();else accountEvent(e)});
 layer.addEventListener('submit',e=>{if(e.target?.id==='packlabAccountForm')void processAccountSubmit(e);else if(e.target?.id==='packlabTrainerNameForm')void processTrainerNameSubmit(e);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!layer.hidden)hideAccount();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollRemote();});
 window.addEventListener('focus',()=>void pollRemote());
 if(!window.supabase?.createClient){message='Account library could not load. Guest mode remains available.';messageError=true;updateBadge();return;}
 try{client=window.supabase.createClient(PROJECT_URL,PUBLISHABLE_KEY,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,storageKey:'packlab_auth_v09'}});
 client.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){authScreen='recovery';message='Choose a new password.';setTimeout(showAccount,0);}
  if(session?.user&&(!currentUser||currentUser.id!==session.user.id))setTimeout(()=>void connectAccount(session.user),0);
  if(event==='SIGNED_OUT'&&currentUser){setTimeout(()=>{if(!busy){const previous=currentUser;currentUser=null;username='';sessionToken++;clearTimers();if(storage(DEVICE_USER)===previous.id)restoreGuest();for(const x of Object.values(slots))Object.assign(x,makeSlot());message='Session ended. Guest progress restored.';updateBadge();if(!layer.hidden)renderAccount();}},0);}
 });
 const {data,error}=await client.auth.getSession();if(error)throw error;
 if(data?.session){const {data:u,error:userError}=await client.auth.getUser();if(userError)throw userError;if(u?.user)await connectAccount(u.user);}else if(storage(DEVICE_USER)){restoreGuest();}
 }catch(err){message='Unable to connect to accounts: '+(err.message||'network unavailable');messageError=true;}
 updateBadge();
}
window.PackLabCloud={changed,showAccount,hasAccount:()=>!!currentUser,status:()=>({signedIn:!!currentUser,username,slots:Object.fromEntries(Object.entries(slots).map(([slot,x])=>[slot,{revision:x.rev,linked:x.enabled,conflict:x.conflict,error:x.error}]))})};
void init().finally(()=>{if(window.location.hash.toLowerCase()==='#account')showAccount();});
})();

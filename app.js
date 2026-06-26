// ══════════ 1. FIREBASE SETUP ══════════
const firebaseConfig = {
  apiKey: "AIzaSyBS0cf3J3EroYIoIILqcL0pn55rvlvFiKQ",
  authDomain: "my-workout-tracker-d6283.firebaseapp.com",
  projectId: "my-workout-tracker-d6283",
  storageBucket: "my-workout-tracker-d6283.firebasestorage.app",
  messagingSenderId: "687899775443",
  appId: "1:687899775443:web:36d19c16584704be2e5f26"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestore = firebase.firestore();

let currentUser = null;
let isGuest = false;

// ══════════ 2. AUTHENTICATION & GUEST LOGIC ══════════

// Automatically check if the user was a guest within the last 24 hours
const GUEST_STORAGE_KEY = 'trn_v4_guest';
const GUEST_TIME_KEY = 'trn_v4_guest_time';

auth.onAuthStateChanged(async (user) => {
  if (isGuest) return; // Prevent loop if manually bypassed

  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app');
  
  if (user) {
    currentUser = user;
    loginScreen.style.display = 'none';
    appContainer.style.display = 'block';
    document.getElementById('user-email').textContent = user.email;

    await loadDB();
    renderHome();
  } else {
    // If no Google user, check if they are a recent guest
    const lastGuestLogin = localStorage.getItem(GUEST_TIME_KEY);
    if (lastGuestLogin && (Date.now() - parseInt(lastGuestLogin)) < 86400000) {
      // It's been less than 24 hours since they clicked Guest. Auto-load guest mode.
      confirmGuestMode();
    } else {
      // Show login screen
      currentUser = null;
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  }
});

// Function to verify the legal checkbox is checked
function checkTOS() {
  const checkbox = document.getElementById('tos-checkbox');
  if (!checkbox || !checkbox.checked) {
    alert("Please check the box to agree to the Terms & Privacy policy before continuing.");
    return false;
  }
  return true;
}

function signInWithGoogle() {
  if (!checkTOS()) return; // Stop if checkbox is empty
  
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    alert("Login issue: " + err.message);
  });
}

function triggerGuestWarning() {
  if (!checkTOS()) return; // Stop if checkbox is empty
  
  document.getElementById('guest-warning-overlay').style.display = 'flex';
}

// Actually locks in guest mode
async function confirmGuestMode() {
  document.getElementById('guest-warning-overlay').style.display = 'none';
  isGuest = true;
  
  // Save a timestamp so we don't annoy them for 24 hours
  localStorage.setItem(GUEST_TIME_KEY, Date.now().toString());

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-email').textContent = "Guest (Local Storage Only)";
  
  await loadDB();
  renderHome();
}

function signOutUser() {
  if (isGuest) {
    localStorage.removeItem(GUEST_TIME_KEY);
    location.reload(); 
  } else {
    auth.signOut();
  }
}

async function deleteAccount() {
  confirm2("Permanently delete your account and all data from the cloud?", "Delete Account", async () => {
    if (isGuest) {
      localStorage.removeItem(GUEST_STORAGE_KEY);
      localStorage.removeItem(GUEST_TIME_KEY);
      location.reload();
      return;
    }
    try {
      await firestore.collection('users').doc(currentUser.uid).delete();
      await currentUser.delete();
      location.reload();
    } catch(e) {
      alert("Error deleting account. You may need to sign out and sign back in first to verify your identity.");
    }
  }, "Cancel");
}

function clearAllData() {
  confirm2("Delete all your workout history and reset groups to default? Your account will stay active.", "Clear Data", () => {
    db.sessions = [];
    db.measurements = [];
    db.groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
    saveDB();
    renderHome();
    showScreen('home');
  }, "Cancel");
}

// ══════════ 3. DEFAULT PLAN ══════════
const DEFAULT_GROUPS = [
  {id:'A',label:'Upper A — Width',color:'#0A84FF',cardio:true,exercises:[
    {id:'lat_pulldown',name:'Lat Pulldown',sets:3,range:'8–12',starred:false},
    {id:'seated_row',name:'Seated Row',sets:3,range:'8–12',starred:false},
    {id:'shoulder_press_a',name:'Shoulder Press',sets:3,range:'8–12',starred:false},
    {id:'lateral_raises_a',name:'Lateral Raises',sets:3,range:'12–20',starred:true},
    {id:'bicep_curl',name:'Bicep Curl',sets:3,range:'10–12',starred:false},
  ]},
  {id:'B',label:'Upper B — Chest',color:'#FF453A',cardio:true,exercises:[
    {id:'chest_press',name:'Chest Press',sets:3,range:'8–12',starred:false},
    {id:'incline_chest',name:'Incline Chest Press',sets:3,range:'8–12',starred:false},
    {id:'pec_deck',name:'Pec Deck',sets:3,range:'10–12',starred:false},
    {id:'shoulder_press_b',name:'Shoulder Press (light)',sets:3,range:'8–12',starred:false},
    {id:'lateral_raises_b',name:'Lateral Raises',sets:3,range:'12–20',starred:true},
    {id:'triceps',name:'Triceps Pushdown',sets:3,range:'10–12',starred:false},
  ]},
  {id:'L',label:'Lower — Maintenance',color:'#30D158',cardio:true,exercises:[
    {id:'leg_press',name:'Leg Press',sets:3,range:'10–12',starred:false},
    {id:'leg_curl',name:'Leg Curl',sets:3,range:'10–12',starred:false},
    {id:'leg_extension',name:'Leg Extension',sets:3,range:'10–12',starred:false},
    {id:'calf_raises',name:'Calf Raises',sets:3,range:'12–15',starred:false},
  ]},
  {id:'C',label:'Cardio Only',color:'#FF9F0A',cardio:true,exercises:[]},
];
const COLORS = ['#0A84FF','#FF453A','#30D158','#FF9F0A','#BF5AF2','#FF375F','#5E5CE6','#FFD60A','#64D2FF','#32ADE6'];

// ══════════ 4. CLOUD / LOCAL DATABASE ══════════
let db = {settings: {weeklyGoal: 3, setupDone: false}, sessions:[], measurements:[], groups: []};

async function loadDB(){
  if (isGuest) {
    const s = localStorage.getItem(GUEST_STORAGE_KEY);
    if (s) { db = JSON.parse(s); }
    else { db = { settings: {weeklyGoal: 3}, sessions: [], measurements: [], groups: JSON.parse(JSON.stringify(DEFAULT_GROUPS)) }; }
  } else if (currentUser) {
    try {
      const docRef = firestore.collection('users').doc(currentUser.uid);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        db = docSnap.data();
      } else {
        db = { settings: {weeklyGoal: 3}, sessions: [], measurements: [], groups: JSON.parse(JSON.stringify(DEFAULT_GROUPS)) };
        await saveDB();
      }
    } catch(e) {
      console.error("Failed to load data", e);
      alert("Could not load cloud data. Check your internet connection.");
    }
  }

  // Safety checks for backward compatibility
  if(!db.settings) db.settings = {weeklyGoal: 3}; 
  if(!db.settings.weeklyGoal) db.settings.weeklyGoal = 3;
  if(!db.groups || db.groups.length === 0) db.groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
  if(!db.measurements) db.measurements = [];
  if(!db.sessions) db.sessions = [];
  db.groups.forEach(g => g.exercises.forEach(e => { if(e.starred===undefined) e.starred=false; }));
  
  // Set Settings UI
  if(document.getElementById('set-goal')) {
    document.getElementById('set-goal').value = db.settings.weeklyGoal;
  }

  // Run Startup Checks (Just weigh-in now, no onboarding)
  checkWeighIn();
}

async function saveDB(){
  if (isGuest) {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(db));
  } else if (currentUser) {
    try {
      await firestore.collection('users').doc(currentUser.uid).set(db);
    } catch(e) {
      console.error("Failed to save data", e);
    }
  }
}

// ══════════ 5. ONBOARDING & WEIGH-IN LOGIC ══════════


function updateWeeklyGoal(val) {
  db.settings.weeklyGoal = parseInt(val) || 3;
  saveDB();
  renderHome();
}

function checkWeighIn() {
  const overlay = document.getElementById('weigh-in-overlay');
  if (!db.measurements || db.measurements.length === 0) {
    overlay.style.display = 'flex';
    return;
  }
  // Check if last weigh-in was > 7 days ago
  const latest = [...db.measurements].sort((a,b) => b.ts - a.ts)[0];
  if (Date.now() - latest.ts > 7 * 86400000) {
    overlay.style.display = 'flex';
  }
}

function skipWeighIn() {
  document.getElementById('weigh-in-overlay').style.display = 'none';
}

function submitWeighIn() {
  const bw = document.getElementById('quick-bw').value;
  if (!bw) { alert('Enter a weight or tap skip.'); return; }
  db.measurements.push({ ts: Date.now(), bw: bw, waist: '', chest: '', shoulder: '' });
  saveDB();
  document.getElementById('weigh-in-overlay').style.display = 'none';
  if(document.getElementById('screen-progress').classList.contains('active')) renderMeasureHistory();
}

// ══════════ 6. CORE APP LOGIC ══════════
let activeWk=null, restTimer=null, restEnd=0, wkStartTime=0, wkTimerInterval=null;
let openExSet = new Set([0]);
let editingSessionIdx = null, editSessionBuf = null;
let editGroupBuf = null; // Buffer for when creating/editing groups
let progTab = 'weight';

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function slug(s){ return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_'); }
function getGroup(id){ return db.groups.find(g=>g.id===id); }

function fmtDate(ts){
  const d = new Date(ts); const n = new Date();
  const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if(diff===0) return 'Today'; if(diff===1) return 'Yesterday'; if(diff<7) return diff+'d ago';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function fmtDateFull(ts){ return new Date(ts).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}); }
function fmtDur(ms){ const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000); return m+'m '+(s<10?'0':'')+s+'s'; }
function getLastExData(exId, beforeTs){
  let list = [...db.sessions]; if(beforeTs) list = list.filter(s=>s.ts<beforeTs);
  for(let s of list.sort((a,b)=>b.ts-a.ts)){
    const ex = (s.exercises||[]).find(e=>e.id===exId);
    if(ex && ex.sets && ex.sets.some(st=>st.weight||st.reps)) return ex;
  } return null;
}
function getPR(exId){
  let pr=0; db.sessions.forEach(s=>(s.exercises||[]).filter(e=>e.id===exId).forEach(e=>e.sets.forEach(st=>{const w=parseFloat(st.weight)||0;if(w>pr)pr=w;}))); return pr;
}
function sessionVol(s){ return (s.exercises||[]).reduce((a,ex)=>a+ex.sets.reduce((b,st)=>b+(parseFloat(st.weight||0)*parseFloat(st.reps||0)),0),0); }
function thisWeekCount(){ return db.sessions.filter(s=>Date.now()-s.ts<7*86400000).length; }

function calcStreak(){
  if(!db.sessions.length) return 0;
  const days = [...new Set(db.sessions.map(s => {
    const d = new Date(s.ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }))].sort().reverse();
  let streak=0, cur=new Date(); cur.setHours(0,0,0,0);
  for(let dd of days){ 
    const p=dd.split('-'); const d=new Date(p[0], p[1]-1, p[2]); const diff=Math.round((cur-d)/86400000); 
    if(diff<=1){ streak++; cur=d; } else break; 
  } return streak;
}
function getLastSession(gid){ return [...db.sessions].filter(s=>s.groupId===gid).sort((a,b)=>b.ts-a.ts)[0]||null; }
function allKnownExercises(){
  const map={}; db.groups.forEach(g=>g.exercises.forEach(e=>{map[e.id]=e.name;}));
  db.sessions.forEach(s=>(s.exercises||[]).forEach(e=>{if(!map[e.id])map[e.id]=e.name;})); return Object.entries(map).map(([id,name])=>({id,name}));
}

function confirm2(msg, yesLabel, onYes, noLabel){
  const ov=document.createElement('div'); ov.id='confirm-overlay';
  ov.innerHTML=`<div class="confirm-box"><div class="confirm-msg">${msg}</div><div class="confirm-btns"><button class="btn btn-red" id="cy">${yesLabel}</button><button class="btn btn-ghost" id="cn">${noLabel||'Cancel'}</button></div></div>`;
  document.body.appendChild(ov); document.getElementById('cy').onclick=()=>{ov.remove();onYes();}; document.getElementById('cn').onclick=()=>ov.remove();
}

function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  const nb=document.getElementById('nav-'+name); if(nb) nb.classList.add('active');
  const fb=document.getElementById('workout-finish-bar'); if(fb) fb.style.display = (name==='workout') ? 'flex' : 'none';
  if(name==='home') renderHome(); if(name==='history') renderHistory(); if(name==='progress'){ renderProgressSelect(); renderChart(); }
  window.scrollTo(0,0);
}

function renderHome(){
  const cards=document.getElementById('wk-cards'); cards.innerHTML='';
  db.groups.forEach(g=>{
    const last=getLastSession(g.id); const card=document.createElement('div'); card.className='wk-card';
    card.innerHTML=`<div class="wk-card-dot" style="background:${g.color}"></div><div class="wk-card-title">${g.label}</div><div class="wk-card-sub">${g.exercises.length?g.exercises.length+' exercises':'Cardio only'}${g.cardio?' + cardio':''}</div><div class="wk-card-last">${last?'Last: '+fmtDate(last.ts):'No sessions yet'}</div>`;
    card.onclick=()=>startWorkout(g.id); cards.appendChild(card);
  });
  
  const goal = db.settings.weeklyGoal || 3;
  const tw=thisWeekCount(), streak=calcStreak(); 
  document.getElementById('home-sub').textContent = tw>=goal ? `${tw}/${goal} sessions this week ✓` : `${tw}/${goal} sessions this week`;
  
  const vol=db.sessions.filter(s=>Date.now()-s.ts<7*86400000).reduce((a,s)=>a+sessionVol(s),0);
  document.getElementById('stats-strip').innerHTML=`<div class="stat-tile"><div class="stat-tile-val">${tw}</div><div class="stat-tile-lbl">This week</div></div><div class="stat-tile"><div class="stat-tile-val">${streak}</div><div class="stat-tile-lbl">Day streak</div></div><div class="stat-tile"><div class="stat-tile-val">${vol>0?Math.round(vol/1000)+'k':'—'}</div><div class="stat-tile-lbl">Weekly vol</div></div>`;
}

// ══════════ PLAN MANAGEMENT (BUFFERED) ══════════
function openManagePlan(){ const ov=document.createElement('div'); ov.id='manage-overlay'; document.body.appendChild(ov); renderManagePlanList(); }
function closeManagePlan(){ document.getElementById('manage-overlay')?.remove(); renderHome(); }

function renderManagePlanList(){
  const ov=document.getElementById('manage-overlay'); if(!ov) return;
  let html=`<div class="overlay-head"><button class="back-btn" onclick="closeManagePlan()">←</button><div class="overlay-title">Manage Plan</div><div></div></div><div class="sec-label">Workout Groups</div>`;
  db.groups.forEach((g,gi)=>{
    const starCount = g.exercises.filter(e=>e.starred).length;
    html+=`<div class="group-row" onclick="openEditGroup('${g.id}')"><div class="group-color-dot" style="background:${g.color}"></div><div class="group-info"><div class="group-name">${g.label}</div><div class="group-sub">${g.exercises.length} exercises${starCount?' · '+starCount+' ⭐':''}${g.cardio?' · cardio':''}</div></div><div class="group-chevron">›</div></div>`;
  });
  html+=`<div class="add-dashed" onclick="openNewGroupForm()">+ Create New Workout Group</div><div style="height:120px"></div><div class="overlay-finish-bar"><button class="btn btn-primary" style="width:100%" onclick="closeManagePlan()">Done</button></div>`;
  ov.innerHTML=html;
}

function openEditGroup(gid){ 
  const g = getGroup(gid); if(!g) return;
  editGroupBuf = JSON.parse(JSON.stringify(g)); 
  renderEditGroup(); 
}

function renderEditGroup(){
  const ov=document.getElementById('manage-overlay'); if(!ov || !editGroupBuf) return;
  const g = editGroupBuf;
  let html=`<div class="overlay-head"><button class="back-btn" onclick="discardGroupEdits()">←</button><div class="overlay-title" style="font-size:18px;flex:1;margin:0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.label}</div><button class="btn btn-ghost btn-sm" onclick="openEditGroupMeta()">✏️ Rename</button></div>
  <div class="sec-label" style="padding-top:4px">Exercises <span class="sec-action" onclick="openAddExerciseForm()">+ Add</span></div>`;
  if(!g.exercises.length){ html+=`<div style="text-align:center;color:var(--muted);font-size:14px;padding:30px 16px">No exercises yet. Add one above.</div>`; } else {
    g.exercises.forEach((ex,ei)=>{ html+=`<div class="edit-ex-row" id="eerow-${ei}"><div class="edit-ex-star" onclick="toggleStar(${ei})">${ex.starred?'⭐':'☆'}</div><div class="edit-ex-info"><div class="edit-ex-name">${ex.name}</div><div class="edit-ex-meta">${ex.sets} sets · ${ex.range} reps</div></div><div class="edit-ex-actions"><div class="icon-sm" onclick="openEditExerciseForm(${ei})">✏️</div><div class="icon-sm" onclick="removeExerciseFromGroup(${ei})" style="color:var(--red)">🗑</div></div></div>`; });
  }
  html+=`<div class="sec-label" style="margin-top:12px">Cardio</div><div class="modal-form"><div class="toggle-wrap" style="margin-bottom:8px"><label class="toggle"><input type="checkbox" ${g.cardio?'checked':''} onchange="toggleGroupProp('cardio',this.checked)"><span class="toggle-slider"></span></label><span style="font-size:14px;font-weight:500">Include cardio</span></div></div>
  <div class="sec-label">Color</div><div class="modal-form"><div class="color-picker">${COLORS.map(c=>`<div class="color-swatch${g.color===c?' selected':''}" style="background:${c}" onclick="setGroupColor('${c}')"></div>`).join('')}</div></div><div style="height:120px"></div>
  <div class="overlay-finish-bar">
    <button class="btn btn-red" onclick="deleteGroup('${g.id}')">Delete</button>
    <button class="btn btn-ghost" onclick="discardGroupEdits()">Discard</button>
    <button class="btn btn-primary" onclick="saveGroupEdits()">Save</button>
  </div>`;
  ov.innerHTML=html;
}

function toggleStar(ei){ editGroupBuf.exercises[ei].starred = !editGroupBuf.exercises[ei].starred; renderEditGroup(); }
function toggleGroupProp(prop, val){ editGroupBuf[prop] = val; }
function setGroupColor(color){ editGroupBuf.color = color; renderEditGroup(); }
function removeExerciseFromGroup(ei){ editGroupBuf.exercises.splice(ei,1); renderEditGroup(); }

function discardGroupEdits() { editGroupBuf = null; renderManagePlanList(); }

function saveGroupEdits() {
  const idx = db.groups.findIndex(g => g.id === editGroupBuf.id);
  if(idx > -1) db.groups[idx] = editGroupBuf;
  else db.groups.push(editGroupBuf); 
  saveDB(); editGroupBuf = null; renderManagePlanList();
}

function openEditGroupMeta(){
  const ov=document.getElementById('manage-overlay'); if(!ov) return;
  let html=`<div class="overlay-head"><button class="back-btn" onclick="renderEditGroup()">←</button><div class="overlay-title">Rename</div><div></div></div><div class="modal-form" style="margin-top:8px"><label class="field-lbl">Name</label><input id="meta-name" value="${editGroupBuf.label}"></div><div style="height:120px"></div><div class="overlay-finish-bar"><button class="btn btn-primary" style="width:100%" onclick="saveGroupMeta()">Done</button></div>`;
  ov.innerHTML=html; setTimeout(()=>document.getElementById('meta-name')?.focus(),100);
}
function saveGroupMeta(){ const n=document.getElementById('meta-name')?.value.trim(); if(n) editGroupBuf.label=n; renderEditGroup(); }

function openAddExerciseForm(){
  const ov=document.getElementById('manage-overlay'); if(!ov) return;
  ov.innerHTML=`<div class="overlay-head"><button class="back-btn" onclick="renderEditGroup()">←</button><div class="overlay-title">Add Exercise</div><div></div></div><div class="modal-form" style="margin-top:8px"><label class="field-lbl">Name</label><input id="nex-name"><label class="field-lbl">Sets</label><input id="nex-sets" type="number" value="3"><label class="field-lbl">Reps</label><input id="nex-range" value="8–12"><div class="toggle-wrap" style="margin-top:16px;"><label class="toggle"><input type="checkbox" id="nex-star"><span class="toggle-slider"></span></label><span>⭐ Key exercise</span></div></div><div style="height:120px"></div><div class="overlay-finish-bar"><button class="btn btn-primary" style="width:100%" onclick="confirmAddExercise()">Add</button></div>`;
  setTimeout(()=>document.getElementById('nex-name')?.focus(),100);
}
function confirmAddExercise(){ const n=document.getElementById('nex-name')?.value.trim(); if(!n) return; editGroupBuf.exercises.push({id:slug(n)+'_'+uid(),name:n,sets:parseInt(document.getElementById('nex-sets')?.value)||3,range:document.getElementById('nex-range')?.value.trim()||'8–12',starred:document.getElementById('nex-star')?.checked||false}); renderEditGroup(); }

function openEditExerciseForm(ei){
  const ov=document.getElementById('manage-overlay'); if(!ov) return; const ex=editGroupBuf.exercises[ei];
  ov.innerHTML=`<div class="overlay-head"><button class="back-btn" onclick="renderEditGroup()">←</button><div class="overlay-title">Edit Exercise</div><div></div></div><div class="modal-form" style="margin-top:8px"><label class="field-lbl">Name</label><input id="eex-name" value="${ex.name}"><label class="field-lbl">Sets</label><input id="eex-sets" type="number" value="${ex.sets}"><label class="field-lbl">Reps</label><input id="eex-range" value="${ex.range}"><div class="toggle-wrap" style="margin-top:16px;"><label class="toggle"><input type="checkbox" id="eex-star" ${ex.starred?'checked':''}><span class="toggle-slider"></span></label><span>⭐ Key exercise</span></div></div><div style="height:120px"></div><div class="overlay-finish-bar"><button class="btn btn-primary" style="width:100%" onclick="confirmEditExercise(${ei})">Done</button></div>`;
  setTimeout(()=>document.getElementById('eex-name')?.focus(),100);
}
function confirmEditExercise(ei){ const n=document.getElementById('eex-name')?.value.trim(); if(!n) return; editGroupBuf.exercises[ei]={...editGroupBuf.exercises[ei],name:n,sets:parseInt(document.getElementById('eex-sets')?.value)||3,range:document.getElementById('eex-range')?.value.trim()||'8–12',starred:document.getElementById('eex-star')?.checked||false}; renderEditGroup(); }

function deleteGroup(gid){ 
  confirm2('Delete this group? History kept.','Delete',() => { 
    db.groups = db.groups.filter(g => g.id !== gid); 
    saveDB(); 
    editGroupBuf = null;
    renderManagePlanList(); 
  },'Cancel'); 
}

function openNewGroupForm(){
  const ov=document.getElementById('manage-overlay'); if(!ov) return;
  ov.innerHTML=`<div class="overlay-head"><button class="back-btn" onclick="renderManagePlanList()">←</button><div class="overlay-title">New Group</div><div></div></div><div class="modal-form" style="margin-top:8px"><label class="field-lbl">Name</label><input id="ng-name" placeholder="e.g. Pull Day"><label class="field-lbl">Color</label><div class="color-picker" id="ng-colors">${COLORS.map((c,i)=>`<div class="color-swatch${i===0?' selected':''}" style="background:${c}" data-color="${c}" onclick="selectNewGroupColor(this)"></div>`).join('')}</div><div class="toggle-wrap" style="margin-top:16px;"><label class="toggle"><input type="checkbox" id="ng-cardio" checked><span class="toggle-slider"></span></label><span>Include cardio</span></div></div><div style="height:120px"></div><div class="overlay-finish-bar"><button class="btn btn-primary" style="width:100%" onclick="confirmNewGroup()">Next</button></div>`;
  setTimeout(()=>document.getElementById('ng-name')?.focus(),100);
}
function selectNewGroupColor(el){ document.querySelectorAll('#ng-colors .color-swatch').forEach(s=>s.classList.remove('selected')); el.classList.add('selected'); }
function confirmNewGroup(){ const n=document.getElementById('ng-name')?.value.trim(); if(!n){alert('Enter a group name');return;} const c=document.querySelector('#ng-colors .color-swatch.selected')?.dataset.color||COLORS[0]; const id='grp_'+uid(); editGroupBuf = {id,label:n,color:c,cardio:document.getElementById('ng-cardio')?.checked,exercises:[]}; renderEditGroup(); }

// ══════════════════════════════════════════
// ACTIVE WORKOUT
// ══════════════════════════════════════════
function startWorkout(gid){
  const g=getGroup(gid); if(!g) return; openExSet=new Set([0]);
  activeWk={ groupId:gid, ts:Date.now(), duration:0, exercises: g.exercises.map(ex=>({id:ex.id,name:ex.name+(ex.starred?' ⭐':''),sets:Array.from({length:ex.sets},()=>({weight:'',reps:'',done:false}))})), cardio:null, notes:'' };
  wkStartTime=Date.now(); wkTimerInterval=setInterval(()=>{ const el=document.getElementById('wk-timer-display'); if(el) el.textContent=fmtDur(Date.now()-wkStartTime); },1000);
  renderWorkoutScreen(); showScreen('workout'); document.getElementById('nav-workout').style.display='flex';
}
function renderWorkoutScreen(){
  if(!activeWk) return; const g=getGroup(activeWk.groupId)||{label:'Workout',color:'#888',cardio:false};
  document.getElementById('wk-dot').style.background=g.color; document.getElementById('wk-title').textContent=g.label; document.getElementById('wk-date').textContent=fmtDateFull(activeWk.ts);
  const el=document.getElementById('ex-list'); el.innerHTML='';
  activeWk.exercises.forEach((sEx,ei)=>{
    const planEx=(getGroup(activeWk.groupId)||{exercises:[]}).exercises.find(e=>e.id===sEx.id); const range=planEx?planEx.range:'8–12';
    const lastEx=getLastExData(sEx.id, activeWk.ts);
    let badge=lastEx?`<div class="ex-badge has-data">${Math.max(...lastEx.sets.map(s=>parseFloat(s.weight)||0)||0)} lbs</div>`:'<div class="ex-badge">New</div>';
    const setRows=sEx.sets.map((st,si)=>{ const ls=lastEx&&lastEx.sets[si]; return`<div class="set-row" id="sr-${ei}-${si}"><div class="set-num">${si+1}</div><input class="set-input${ls&&ls.weight?' hint':''}" type="number" placeholder="${ls?ls.weight||'lbs':'lbs'}" value="${st.weight}" oninput="updSet(${ei},${si},'weight',this.value)"><input class="set-input" type="number" placeholder="${ls?ls.reps||'reps':'reps'}" value="${st.reps}" oninput="updSet(${ei},${si},'reps',this.value)"><button class="set-check${st.done?' done':''}" onclick="toggleDone(${ei},${si})">✓</button></div>`; }).join('');
    let tip=''; if(lastEx){ const allMax=lastEx.sets.every(s=>parseInt(s.reps)>=12); if(allMax) tip=`<div class="progress-tip tip-up">💪 Hit 12 last time — try +${['A','B'].includes(activeWk.groupId)?'5–10':'10–20'} lbs!</div>`; else if(lastEx.sets.reduce((a,s)=>a+(parseInt(s.reps)||0),0)/lastEx.sets.length>=10) tip=`<div class="progress-tip tip-ok">On track — keep building toward 12 reps</div>`; }
    const block=document.createElement('div'); block.className='ex-block'; block.innerHTML=`<div class="ex-head" onclick="toggleEx(${ei})"><div class="ex-name-wrap"><div class="ex-name">${sEx.name}</div><div class="ex-meta">${sEx.sets.length} sets · ${range} reps</div></div>${badge}</div><div class="ex-body${openExSet.has(ei)?' open':''}" id="exbd-${ei}"><div class="set-labels"><div class="set-lbl">Set</div><div class="set-lbl">Weight</div><div class="set-lbl">Reps</div><div></div></div><div id="sets-${ei}">${setRows}</div>${tip}</div>`;
    el.appendChild(block);
  });
  renderCardioSection();
}
function toggleEx(ei){ if(openExSet.has(ei)) openExSet.delete(ei); else openExSet.add(ei); document.getElementById('exbd-'+ei)?.classList.toggle('open'); }
function updSet(ei,si,field,val){ if(activeWk) activeWk.exercises[ei].sets[si][field]=val; }
function renderCardioSection(){
  const cs=document.getElementById('cardio-sec'); cs.innerHTML=''; const g=getGroup(activeWk.groupId)||{cardio:false}; if(!g.cardio) return;
  cs.innerHTML=`<div class="sec-label" style="padding-top:12px">Cardio</div><div class="cardio-block"><div class="cardio-title">Incline Walk · 3.6 mph · 20–25 min</div><div class="cardio-row"><div class="cardio-field"><label>Duration</label><input class="set-input" type="number" id="c-dur" oninput="updCardio()"></div><div class="cardio-field"><label>Speed</label><input class="set-input" type="number" id="c-spd" value="3.6" oninput="updCardio()"></div><div class="cardio-field"><label>Incline %</label><input class="set-input" type="number" id="c-inc" oninput="updCardio()"></div></div></div>`;
}
function updCardio(){ if(activeWk) activeWk.cardio={duration:document.getElementById('c-dur')?.value||'',speed:document.getElementById('c-spd')?.value||'3.6',incline:document.getElementById('c-inc')?.value||''}; }
function toggleDone(ei,si){
  if(!activeWk) return; const set=activeWk.exercises[ei].sets[si]; set.done=!set.done;
  document.querySelector(`#sr-${ei}-${si} .set-check`)?.classList.toggle('done',set.done);
  if(set.done){ setRestAuto(); checkPR(activeWk.exercises[ei].id, parseFloat(set.weight)||0); }
}
function checkPR(id,w){ if(w>0&&w>getPR(id)) showPRToast(id); }
function showPRToast(id){ const t=document.getElementById('pr-toast'); t.textContent='🏆 New PR — '+(allKnownExercises().find(e=>e.id===id)?.name.replace('⭐','').trim()||'Exercise')+'!'; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }

function setRestAuto(){ setRest(75); }
function setRest(s){
  clearInterval(restTimer); restEnd=Date.now()+s*1000; document.querySelectorAll('.rest-btn').forEach(b=>b.classList.remove('active')); const map={60:0,75:1,90:2}; if(map[s]!==undefined) document.querySelectorAll('.rest-btn')[map[s]]?.classList.add('active');
  restTimer=setInterval(()=>{ const rem=Math.max(0,restEnd-Date.now()); const el=document.getElementById('rest-val'); if(el) el.textContent=rem>0?Math.ceil(rem/1000)+'s':'Go! 💪'; if(rem===0){ clearInterval(restTimer); setTimeout(()=>{if(document.getElementById('rest-val'))document.getElementById('rest-val').textContent='—';},2500); } },200);
}
function clearRest(){ clearInterval(restTimer); document.getElementById('rest-val').textContent='—'; document.querySelectorAll('.rest-btn').forEach(b=>b.classList.remove('active')); }

function finishWorkout(){ if(!activeWk) return; updCardio(); activeWk.notes=document.getElementById('session-notes')?.value||''; activeWk.duration=Date.now()-wkStartTime; db.sessions.push(activeWk); saveDB(); activeWk=null; clearInterval(restTimer); clearInterval(wkTimerInterval); document.getElementById('nav-workout').style.display='none'; showScreen('home'); }
function cancelWorkout(){ confirm2('Discard this workout?','Discard',()=>{ activeWk=null; clearInterval(restTimer); clearInterval(wkTimerInterval); document.getElementById('nav-workout').style.display='none'; showScreen('home'); },'Keep'); }

function renderHistory(){
  const list=document.getElementById('hist-list'); const sessions=[...db.sessions].sort((a,b)=>b.ts-a.ts); document.getElementById('hist-sub').textContent=sessions.length+' sessions total';
  if(!sessions.length){ list.innerHTML='<div class="empty"><div class="empty-icon">📋</div>No workouts yet</div>'; return; }
  list.innerHTML=sessions.map(s=>{ const g=getGroup(s.groupId)||{label:s.groupId||'Workout',color:'#888'}; const vol=Math.round(sessionVol(s)); return`<div class="hist-item" onclick="showSessionDetail(${db.sessions.indexOf(s)})"><div class="hist-top"><div class="hist-type"><span class="wk-dot" style="background:${g.color}"></span>${g.label}${s.duration?`<span class="dur-pill">⏱ ${fmtDur(s.duration)}</span>`:''}</div><div class="hist-date">${fmtDate(s.ts)}</div></div><div class="hist-pills"><div class="hist-pill">${(s.exercises||[]).reduce((a,ex)=>a+ex.sets.filter(st=>st.weight||st.reps).length,0)} sets</div>${vol>0?`<div class="hist-pill">${vol.toLocaleString()} lbs vol</div>`:''}${s.cardio&&s.cardio.duration?`<div class="hist-pill">${s.cardio.duration} min cardio</div>`:''}${s.notes?`<div class="hist-pill">📝 notes</div>`:''}</div></div>`; }).join('');
}

function showSessionDetail(idx){ editingSessionIdx=idx; editSessionBuf=null; renderSessionView(idx,false); }
function closeDetail(){ document.getElementById('detail-overlay')?.remove(); }
function startEditSession(idx){ editSessionBuf=JSON.parse(JSON.stringify(db.sessions[idx])); if(!editSessionBuf.cardio) editSessionBuf.cardio={duration:'',speed:'3.6',incline:''}; renderSessionView(idx,true); }
function cancelEditSession(idx){ confirm2('Discard changes?','Discard',()=>{ editSessionBuf=null; renderSessionView(idx,false); },'Keep'); }
function saveEditSession(idx){ db.sessions[idx]=editSessionBuf; editSessionBuf=null; saveDB(); renderSessionView(idx,false); renderHistory(); }
function updEditSet(ei,si,f,v){ if(editSessionBuf) editSessionBuf.exercises[ei].sets[si][f]=v; }
function updEditCardio(f,v){ if(editSessionBuf){ if(!editSessionBuf.cardio) editSessionBuf.cardio={}; editSessionBuf.cardio[f]=v; } }
function updEditNotes(v){ if(editSessionBuf) editSessionBuf.notes=v; }

function renderSessionView(idx, editMode){
  const s=editMode?editSessionBuf:db.sessions[idx]; if(!s) return; const g=getGroup(s.groupId)||{label:s.groupId||'Workout',color:'#888'};
  let html=`<div class="overlay-head" style="margin-bottom:12px"><button class="back-btn" onclick="closeDetail()">←</button><div style="flex:1;margin:0 12px"><div style="display:flex;align-items:center;gap:8px"><span class="wk-dot" style="background:${g.color}"></span><span style="font-size:20px;font-weight:700">${g.label}</span></div><div style="font-size:13px;color:var(--muted);margin-top:4px">${fmtDateFull(s.ts)}</div></div>${editMode?'':`<button class="back-btn" onclick="startEditSession(${idx})">✏️</button>`}</div>`;
  (s.exercises||[]).forEach((ex,ei)=>{
    html+=`<div class="ex-block"><div class="ex-head"><div class="ex-name-wrap"><div class="ex-name">${ex.name}</div></div></div><div class="ex-body open"><div class="set-labels"><div class="set-lbl">Set</div><div class="set-lbl">Weight</div><div class="set-lbl">Reps</div><div></div></div>${ex.sets.map((st,si)=>`<div class="set-row"><div class="set-num">${si+1}</div>${editMode?`<input class="set-input" type="number" value="${st.weight}" oninput="updEditSet(${ei},${si},'weight',this.value)"><input class="set-input" type="number" value="${st.reps}" oninput="updEditSet(${ei},${si},'reps',this.value)">`:`<div class="readonly-val">${st.weight||'—'}</div><div class="readonly-val">${st.reps||'—'}</div>`}<button class="set-check${st.done?' done':''}" ${editMode?`onclick="this.classList.toggle('done');updEditSet(${ei},${si},'done',this.classList.contains('done'))"`:''} style="${editMode?'':'pointer-events:none'}">✓</button></div>`).join('')}</div></div>`;
  });
  if(g.cardio){
    const c=s.cardio||{}; html+=`<div class="cardio-block"><div class="cardio-title">Cardio</div><div class="cardio-row">${editMode?`<div class="cardio-field"><label>Min</label><input class="set-input" type="number" value="${c.duration||''}" oninput="updEditCardio('duration',this.value)"></div><div class="cardio-field"><label>Spd</label><input class="set-input" type="number" value="${c.speed||''}" oninput="updEditCardio('speed',this.value)"></div><div class="cardio-field"><label>Inc</label><input class="set-input" type="number" value="${c.incline||''}" oninput="updEditCardio('incline',this.value)"></div>`:(c.duration||c.speed||c.incline?`<div style="font-size:14px;color:var(--text);display:flex;gap:16px;">${c.duration?`<span>Dur: <b style="color:var(--blue)">${c.duration}</b></span>`:''}${c.speed?`<span>Spd: <b style="color:var(--blue)">${c.speed}</b></span>`:''}${c.incline?`<span>Inc: <b style="color:var(--blue)">${c.incline}</b></span>`:''}</div>`:'<div style="font-size:13px;color:var(--muted)">No cardio logged</div>')}</div></div>`;
  }
  html+=`<div class="px" style="margin-top:16px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px;font-weight:600">NOTES</div>${editMode?`<textarea class="notes-input" oninput="updEditNotes(this.value)">${s.notes||''}</textarea>`:`<div style="font-size:14px;background:var(--surface);border-radius:var(--radius-sm);padding:14px;border:1px solid var(--border);min-height:50px">${s.notes||'<span style="color:var(--muted2)">No notes</span>'}</div>`}</div><div style="height:120px"></div><div class="overlay-finish-bar">${editMode?`<button class="btn btn-ghost" onclick="cancelEditSession(${idx})">Discard</button><button class="btn btn-primary" onclick="saveEditSession(${idx})">Save Changes</button>`:`<button class="btn btn-red" onclick="deleteSession(${idx})">Delete Session</button>`}</div>`;
  let ov=document.getElementById('detail-overlay'); if(!ov){ ov=document.createElement('div'); ov.id='detail-overlay'; document.body.appendChild(ov); } ov.innerHTML=html;
}
function deleteSession(idx){ confirm2('Delete session?','Delete',()=>{ db.sessions.splice(idx,1); saveDB(); closeDetail(); renderHistory(); renderHome(); },'Cancel'); }

function setProgTab(tab,btn){ progTab=tab; document.querySelectorAll('.vol-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); document.getElementById('prog-weight-view').style.display=tab==='weight'?'block':'none'; document.getElementById('prog-volume-view').style.display=tab==='volume'?'block':'none'; document.getElementById('prog-body-view').style.display=tab==='body'?'block':'none'; if(tab==='volume') renderVolumeChart(); if(tab==='body') renderMeasureHistory(); }
function renderProgressSelect(){ document.getElementById('prog-select').innerHTML=allKnownExercises().map(e=>`<option value="${e.id}">${e.name.replace('⭐','').trim()}</option>`).join(''); }
function renderChart(){
  const id=document.getElementById('prog-select')?.value; const wrap=document.getElementById('chart-wrap'); if(!wrap||!id) return;
  const data=[]; db.sessions.forEach(s=>{ const ex=(s.exercises||[]).find(e=>e.id===id); if(ex){ const mw=Math.max(...ex.sets.map(st=>parseFloat(st.weight)||0)); if(mw>0) data.push({ts:s.ts,weight:mw}); } }); data.sort((a,b)=>a.ts-b.ts);
  if(!data.length){ wrap.innerHTML='<div class="no-data">No data yet</div>'; return; }
  const maxW=Math.max(...data.map(d=>d.weight)); const last=data[data.length-1]; const gain=last.weight-data[0].weight;
  wrap.innerHTML=`<div class="chart-stats"><div class="cs-card"><div class="cs-val">${last.weight}</div><div class="cs-lbl">Last</div></div><div class="cs-card"><div class="cs-val" style="color:var(--amber)">${maxW}</div><div class="cs-lbl">PR</div></div><div class="cs-card"><div class="cs-val" style="color:${gain>=0?'var(--green)':'var(--red)'}">${gain>0?'+':''}${gain}</div><div class="cs-lbl">Gain</div></div></div><div class="bars-area" id="chart-bars"></div>`;
  const bars=document.getElementById('chart-bars'); data.slice(-14).forEach(d=>{ const pct=maxW>0?(d.weight/maxW)*100:0; const w=document.createElement('div'); w.className='bar-wrap'; w.innerHTML=`<div class="bar${d.weight===maxW?' is-pr':''}" style="height:${Math.max(4,Math.round(pct*1.3))}px"></div><div class="bar-lbl">${d.weight}<br>${fmtDate(d.ts).replace(' ago','')}</div>`; bars.appendChild(w); });
}
function renderVolumeChart(){
  const wrap=document.getElementById('vol-chart-wrap'); if(!wrap) return; const last8=db.sessions.slice(-8); if(!last8.length){ wrap.innerHTML='<div class="no-data">No sessions yet</div>'; return; }
  const maxV=Math.max(...last8.map(s=>sessionVol(s))); wrap.innerHTML=`<div style="font-size:13px;color:var(--muted);margin-bottom:16px;font-weight:600">VOLUME</div><div class="bars-area" id="vol-bars"></div>`;
  const bars=document.getElementById('vol-bars'); last8.forEach(s=>{ const vol=sessionVol(s); const pct=maxV>0?(vol/maxV)*100:0; const w=document.createElement('div'); w.className='bar-wrap'; w.innerHTML=`<div class="bar" style="height:${Math.max(4,Math.round(pct*1.3))}px;background:${(getGroup(s.groupId)||{color:'#888'}).color}"></div><div class="bar-lbl">${Math.round(vol/1000*10)/10}k<br>${fmtDate(s.ts).replace(' ago','')}</div>`; bars.appendChild(w); });
}
function saveMeasurement(){ const bw=document.getElementById('m-bw').value, waist=document.getElementById('m-waist').value, chest=document.getElementById('m-chest').value, shoulder=document.getElementById('m-shoulder').value; if(!bw&&!waist&&!chest&&!shoulder){ alert('Enter measurement'); return; } db.measurements.push({ts:Date.now(),bw,waist,chest,shoulder}); saveDB(); ['m-bw','m-waist','m-chest','m-shoulder'].forEach(id=>{if(document.getElementById(id))document.getElementById(id).value='';}); renderMeasureHistory(); }
function renderMeasureHistory(){ const el=document.getElementById('measure-hist'); if(!el) return; const rows=[...db.measurements].sort((a,b)=>b.ts-a.ts).slice(0,10); if(!rows.length){ el.innerHTML='<div style="text-align:center;color:var(--muted);font-size:14px;padding:24px 0">No measurements yet</div>'; return; } el.innerHTML=rows.map(m=>`<div class="measure-row"><div style="font-size:13px;color:var(--muted);font-weight:500">${fmtDate(m.ts)}</div><div style="display:flex;gap:14px;font-size:14px;font-weight:600">${m.bw?`<span>${m.bw} <span style="font-weight:500;font-size:11px">lbs</span></span>`:''}${m.waist?`<span>${m.waist}<span style="font-weight:500;font-size:11px">" w</span></span>`:''}</div></div>`).join(''); }
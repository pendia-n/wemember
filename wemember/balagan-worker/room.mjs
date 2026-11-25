import { gameLanding, landingCSS } from './landing.mjs';
import {challenges, maintainChallenges} from './challenges.mjs';
import { brandAsset, brandCSS, brandLink, iconTag } from './brand.mjs';
import { gameAuth, gameUser } from './game-auth.mjs';
import { games, scoreRecall } from './games.mjs';

const h = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const location = id => '/room/'+id;
const redirect = to=>new Response(null,{status:303,headers:{Location:to}});
const link=(label,url)=>'<a class="button" href="'+h(url)+'">'+h(label)+'</a>';
const button=(action,label)=>'<button name="action" value="'+action+'">'+label+'</button>';
const form=(url,contents)=>'<form method="post" action="'+url+'">'+contents+'</form>';
const para=text=>'<p class="answer">'+h(text)+'</p>';
const millis=value=>value<1e12?value*1000:value;
const elapsed=player=>Math.max(0,millis(player.submitted_at)-millis(player.opened_at));
const time=()=>Math.floor(Date.now()/1000);
function html(g,title,body,status=200){
 const [paper,ink,accent]=g.colors;
 return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+h(title)+' · '+g.name+'</title>'+iconTag+'<style>'+brandCSS+
 `*{box-sizing:border-box}body{background:${paper};color:${ink};margin:0;font:17px/1.55 system-ui,sans-serif}a{color:inherit}nav,main{width:min(1070px,calc(100% - 32px));margin:auto}nav{display:flex;gap:20px;justify-content:space-between;padding:20px 0;border-bottom:1px solid currentColor}main{padding:36px 0}h1,h2{letter-spacing:-.05em;line-height:1}h1{font-size:clamp(38px,6vw,73px);margin:0 0 22px}h2{font-size:32px}.hero{display:grid;grid-template-columns:1fr 1.2fr;border:1px solid currentColor;border-radius:8px;overflow:hidden}.hero div,.panel{padding:clamp(18px,4vw,45px)}.hero img{width:100%;height:100%;object-fit:cover}.panel{border:1px solid currentColor;border-radius:8px;background:#ffffff90;max-width:780px;margin-bottom:15px}.button,button{display:inline-block;background:${accent};color:${ink};border:1px solid currentColor;border-radius:4px;font:inherit;font-weight:750;padding:10px 14px;margin:6px 8px 0 0;text-decoration:none;cursor:pointer}form{margin-top:12px}label{display:block;font-weight:700;margin-top:12px}input,textarea,select{width:100%;padding:10px;font:inherit;margin:5px 0 12px}textarea{min-height:125px}.answer{white-space:pre-wrap;overflow-wrap:anywhere}.player{border-bottom:1px solid currentColor;padding:7px 0}:focus-visible{outline:3px solid currentColor;outline-offset:4px}@media(max-width:720px){.hero{grid-template-columns:1fr}}`+
 landingCSS+'</style><body><nav>'+brandLink(g.name)+'<div><a href="https://balagan.live/wallet">Wallet</a><a href="https://balagan.live">Balagan</a></div></nav><main>'+body+'</main></body></html>', {status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff'}});
}
async function readForm(request) {
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')||''))return null;
 const reader=request.body?.getReader();
 if(!reader)return null;
 const decoder=new TextDecoder();let value='', length=0;
 while(true){
  const item=await reader.read();
  if(item.done)break;
  length+=item.value.length;
  if(length>6000){await reader.cancel();return null;}
  value+=decoder.decode(item.value,{stream:true});
 }
 return new URLSearchParams(value+decoder.decode());
}
async function authorizeEntry(request,env,game,roomId) {
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-balagan=([^;]+)/)?.[1];
 return env.BALAGAN.fetch(new Request('https://balagan.live/api/entry',{method:'POST',headers:{
  'X-Balagan-Game':game,'X-Balagan-Round':roomId,Authorization:'Bearer '+token
 }}));
}
export function createRoomWorker(game){
 const g=games[game];
 const render=(title,body,status)=>html(g,title,body,status);
 const message=(title,body,status)=>render(title,'<h1>'+h(title)+'</h1><div class="panel">'+body+'</div>',status);
 const signIn=path=>'/auth/start?next='+encodeURIComponent(path);
 const field=(label)=>'<label for="answer">'+label+'</label><textarea name="answer" id="answer" required maxlength="1000"></textarea>';
 return {async scheduled(_event,env,ctx){ctx.waitUntil(maintainChallenges(env,game));},async fetch(request,env){
  const url = new URL(request.url), path=url.pathname, method=request.method;
  const brand=await brandAsset(request,env,game);if(brand)return brand;
  const auth=await gameAuth(request,env,game);if(auth)return auth;
  const updated=await challenges(request,env,game,render);if(updated)return updated;
  if(method!=='GET'&&method!=='POST')return new Response(null,{status:405});
  if(method==='POST'&&request.headers.get('Origin')!==url.origin)return new Response(null,{status:403});
  const db=env.DB;
  if(path==='/'&&method==='GET')return render(g.name,gameLanding(game));
  const match=/^\/room\/([a-f0-9-]{36})(?:\/(recording))?$/.exec(path);
  if(path!=='/host'&&!match)return message('Page not found',link('Game home','/'),404);
  if(path==='/host')return new Response(null,{status:303,headers:{Location:game==='sorriest'?'/daily':'/challenge/new'}});
  const user=await gameUser(request,env,game);
  if(!user){
   if(match&&method==='GET'&&!match[2])return message('You’re invited',para(g.entry)+link('Sign in to see the room',signIn(path))+link('Create an account',signIn(path)+'&action=register'));
   return redirect(signIn(path));
  }
  const now=time();
  const [,id,recording]=match;
  const room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  if(!room)return message('Room not found',link('Game home','/'),404);
  const base=location(id), scenario=g.scenarios[room.scenario], host=room.host===user.id;
  const player=await db.prepare('SELECT * FROM players WHERE room_id=? AND user_id=?').bind(id,user.id).first();
  const nowMs=Date.now();
  const hasJury=game==='barara'&&Boolean(await db.prepare("SELECT 1 FROM players WHERE room_id=? AND role='jury' LIMIT 1").bind(id).first());
  const mayGiveVerdict=player?.role==='jury'&&player.cost!=null||host&&!hasJury;
  const closed=room.phase==='closed'||now-room.created_at>=86400||(game==='barara'&&room.started_at&&now-room.started_at>=600);
  const phase=closed?'closed':room.phase;
  if(recording){
   if(game!=='wemember'||method!=='POST'||phase!=='play'||player?.cost==null)return new Response(null,{status:403});
   if(player.opened_at!=null)return new Response(null,{status:410});
   const file=await env.MEDIA.get('challenges/seaside.wav');
   if(!file)return new Response(null,{status:503});
   const consumed=await db.prepare("UPDATE players SET opened_at=? WHERE room_id=? AND user_id=? AND opened_at IS NULL AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='play')")
    .bind(nowMs,id,user.id,id).run();
   if(!consumed.meta.changes){await file.body.cancel();return new Response(null,{status:410});}
   return new Response(file.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'no-store'}});
  }
  if(method==='POST'){
   const values=await readForm(request);const action=values?.get('action');
   if(closed)return redirect(base);
   if(action==='join'&&phase==='lobby'){
    await db.prepare(`INSERT OR IGNORE INTO players(room_id,user_id,username,role)
      SELECT ?,?,?,CASE WHEN ?='barara' THEN
      CASE WHEN EXISTS(SELECT 1 FROM players WHERE room_id=? AND role='accused') THEN 'jury' ELSE 'accused' END
      ELSE 'player' END FROM rooms WHERE id=? AND phase='lobby'`)
      .bind(id,user.id,user.username,game,id,id).run();
   } else if(action==='enter'&&phase==='play'&&player&&player.cost==null&&(game!=='barara'||player.role!=='host')){
    const payment=await authorizeEntry(request,env,game,id);
    if(payment.status===402)return message('You need more tokens',para(g.entry)+link('Open wallet','https://balagan.live/wallet'),402);
    if(!payment.ok)return message('Entry is temporarily unavailable',link('Back to room',base),503);
    const {cost}=await payment.json();
    await db.prepare('UPDATE players SET cost=? WHERE room_id=? AND user_id=? AND cost IS NULL').bind(cost,id,user.id).run();
   } else if(action==='submit'&&phase==='play'&&player?.cost!=null){
    const answer=values?.get('answer')?.trim();
    if(!answer||answer.length>1000)return message('Enter a response under 1,000 characters',link('Back to room',base),400);
    if(game==='wemember'){
     const heardAt=player.opened_at==null ? null : player.opened_at<1e12 ? player.opened_at*1000 : player.opened_at;
     if(heardAt==null||nowMs<heardAt+g.recordingMs)return message('Finish listening first',link('Back to room',base),409);
     await db.prepare("UPDATE players SET answer=?,score=?,submitted_at=? WHERE room_id=? AND user_id=? AND answer IS NULL AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='play')")
       .bind(answer,scoreRecall(answer),nowMs,id,user.id,id).run();
    }
    if(game!=='wemember'&&(game!=='barara'||player.role==='accused')){
     if(!player.answer)await db.prepare('UPDATE players SET answer=? WHERE room_id=? AND user_id=? AND answer IS NULL').bind(answer,id,user.id).run();
     else await db.prepare('UPDATE players SET followup=?,submitted_at=? WHERE room_id=? AND user_id=? AND followup IS NULL').bind(answer,now,id,user.id).run();
    }
   } else if(action==='vote'&&phase==='vote'&&(player?.cost!=null||game==='barara'&&mayGiveVerdict)&&game!=='wemember'){
    const choice=values.get('choice');
    const allowed=game==='barara'
      ? mayGiveVerdict&&['guilty','not-guilty'].includes(choice)
      : choice!==user.id&&await db.prepare('SELECT 1 FROM players WHERE room_id=? AND user_id=? AND followup IS NOT NULL').bind(id,choice).first();
    if(allowed)await db.prepare('INSERT OR IGNORE INTO votes VALUES(?,?,?)').bind(id,user.id,choice).run();
   } else if(host&&action==='start'&&phase==='lobby'){
    await db.prepare("UPDATE rooms SET phase='play',started_at=? WHERE id=? AND phase='lobby' AND EXISTS(SELECT 1 FROM players WHERE room_id=? AND user_id!=?)").bind(now,id,id,user.id).run();
   } else if(host&&action==='advance'&&(phase==='play'||phase==='vote')){
    const next=phase==='vote'||game==='wemember'?'closed':'vote';
    if(phase==='play'){
     const completed=game==='barara' ? "role='accused' AND followup IS NOT NULL" : "submitted_at IS NOT NULL";
     await db.prepare("UPDATE rooms SET phase=? WHERE id=? AND phase='play' AND EXISTS(SELECT 1 FROM players WHERE room_id=? AND "+completed+")").bind(next,id,id).run();
    } else await db.prepare("UPDATE rooms SET phase='closed' WHERE id=? AND phase='vote'").bind(id).run();
   }
   return redirect(base);
  }
  if(!player&&phase!=='lobby')return message('This room has already started',link('Game home','/'),409);
  const {results:players}=await db.prepare('SELECT * FROM players WHERE room_id=? ORDER BY username COLLATE NOCASE').bind(id).all();
  let content='<h1>'+h(room.name)+'</h1><div class="panel"><h2>'+h(scenario[0])+'</h2>';
  if(game==='barara'&&room.started_at&&!closed)content+=para('Court closes at '+new Date((room.started_at+600)*1000).toISOString().slice(11,16)+' UTC.');
  if(phase==='lobby'){
   content+=para(g.entry)+para('Share this private link with friends.')+'<input aria-label="Invitation link" readonly value="'+h(url.origin+base)+'">';
   content+=players.map(p=>'<div class="player">'+h(p.username)+(game==='barara'?' · '+h(p.role):'')+'</div>').join('');
   if(!player)content+=form(base,button('join','Join lobby'));
   if(host)content+=players.length>1?form(base,button('start','Start challenge')):para('Wait for at least one friend to join.');
  } else if(phase==='play'){
   content+=para(scenario[1]);
   if(host&&game==='barara')content+=para('Hosting as the judge. The accused and jury enter separately.');
   else if(player?.cost==null){
    content+=para(g.entry)+form(base,button('enter',game==='wemember'?'Confirm entry · free if available, otherwise 15 tokens':'Confirm entry · '+g.cost+' tokens'));
   } else if(game==='wemember'){
    if(player.answer)content+=para('Answer locked. Wait for the host to reveal results.');
    else {
     if(player.opened_at==null)content+='<button id="listen" data-src="'+base+'/recording">Play recording once</button><p id="audio-status" role="status"></p><script>document.getElementById("listen").addEventListener("click",async function(){this.disabled=true;const s=document.getElementById("audio-status");try{const r=await fetch(this.dataset.src,{method:"POST"});if(!r.ok)throw Error();const a=new Audio(URL.createObjectURL(await r.blob()));a.onended=()=>{s.textContent="Playback ended. Type your answer.";document.getElementById("recall").disabled=false;};await a.play();}catch{s.textContent="Audio could not play. Refresh to see whether playback was recorded.";}});</script>';
     const formBlocked=player.opened_at==null||nowMs<(player.opened_at<1e12?player.opened_at*1000:player.opened_at)+g.recordingMs;
     content+=form(base,'<fieldset id="recall" '+(formBlocked?'disabled':'')+'>'+field('Your recollection')+button('submit','Lock in answer')+'</fieldset>');
     if(player.opened_at!=null&&formBlocked)content+=link('Continue after playback',base);
    }
   } else if(game==='barara'&&player.role==='jury')content+=para('Wait for the defence before voting.');
   else if(player.followup)content+=para('Response submitted. Wait for voting.');
   else content+=form(base,field(player.answer?scenario[2]:game==='barara'?'Your defence':'Your opening apology')+button('submit',player.answer?'Submit response':'Submit statement'));
   const canAdvance=game==='barara'?players.some(p=>p.role==='accused'&&p.followup):players.some(p=>p.submitted_at);
   if(host&&canAdvance)content+=form(base,button('advance',game==='wemember'?'Reveal results':'Open voting'));
  } else if(phase==='vote'){
   const voted=await db.prepare('SELECT 1 FROM votes WHERE room_id=? AND user_id=?').bind(id,user.id).first();
   const eligible=players.filter(p=>p.followup&&p.user_id!==user.id);
   if(game==='barara'){
    const accused=players.find(p=>p.role==='accused');content+=para(accused?.answer)+para(accused?.followup);
    if(!voted&&mayGiveVerdict)content+=form(base,'<label for="choice">Your verdict</label><select id="choice" name="choice"><option value="not-guilty">Not guilty</option><option value="guilty">Guilty</option></select>'+button('vote','Lock verdict'));
   } else {
    content+=eligible.map(p=>'<div class="player"><strong>'+h(p.username)+'</strong>'+para(p.answer)+para(p.followup)+'</div>').join('');
    if(!voted&&eligible.length&&player?.cost!=null)content+=form(base,'<label for="choice">Best recovery</label><select id="choice" name="choice">'+eligible.map(p=>'<option value="'+h(p.user_id)+'">'+h(p.username)+'</option>').join('')+'</select>'+button('vote','Cast vote'));
   }
   if(voted)content+=para('Your vote is recorded.');
   if(host)content+=form(base,button('advance','Reveal results'));
  } else {
   if(game==='wemember')content+=para(g.reference)+players.filter(p=>p.score!=null).sort((a,b)=>b.score-a.score||elapsed(a)-elapsed(b)||a.submitted_at-b.submitted_at).map(p=>'<div class="player">'+h(p.username)+' · '+p.score+' / 5</div>').join('');
   else{
    const {results:votes}=await db.prepare('SELECT choice,count(*) AS total FROM votes WHERE room_id=? GROUP BY choice ORDER BY total DESC,choice').bind(id).all();
    content+=votes.length?votes.map(v=>'<div class="player">'+h(players.find(p=>p.user_id===v.choice)?.username||v.choice)+' · '+v.total+'</div>').join(''):para('No votes recorded.');
   }
  }
  if(phase==='play'||phase==='vote')content+=link('Refresh room',base);
  return render(room.name,content+'</div>');
 }};
}

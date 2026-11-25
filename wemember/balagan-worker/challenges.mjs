import {gameUser} from './game-auth.mjs';
import {button,date,esc,field,form,go,link,pay,randomIndex,readFixed,readForm,recallScore,remix,settle,text,uuid} from './challenge-rules.mjs';

const hour=3600000,day=24*hour;
const state=db=>db.prepare('SELECT * FROM challenges WHERE id=?');
const getPlayers=(db,id)=>db.prepare('SELECT * FROM challenge_players WHERE challenge_id=? ORDER BY username COLLATE NOCASE').bind(id).all();
const where=(db,id,user)=>db.prepare('SELECT * FROM challenge_players WHERE challenge_id=? AND user_id=?').bind(id,user).first();
const path=(game,id)=> (game==='sorriest'?'/daily/':'/challenge/')+id;
const escapeField=(name,value)=>'<input type="hidden" name="'+name+'" value="'+esc(value)+'">';
const poolRewards={wemember:[15,8,5],sorriest:[20,20,20,10,10,10,10,8,8,5],barara:[20,15,15,15,15,15]};
const cost={wemember:15,sorriest:20,barara:30};

function mp3Duration(bytes){
 let i=0, samples=0,rate=0;
 if(bytes[0]===73&&bytes[1]===68&&bytes[2]===51){
  if(bytes.length<10||bytes.slice(6,10).some(n=>n>=128))return 0;
  i=10+(bytes[6]<<21)+(bytes[7]<<14)+(bytes[8]<<7)+bytes[9]+(bytes[5]&16?10:0);
 }
 const kb=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
 while(i+4<=bytes.length){
  if(bytes.length-i===128&&bytes[i]===84&&bytes[i+1]===65&&bytes[i+2]===71){i=bytes.length;break;}
  const b=bytes[i+1], c=bytes[i+2];
  const bitrate=kb[c>>4], frameRate=[44100,48000,32000][(c>>2)&3];
  if(bytes[i]!==255||(b&254)!==250||!bitrate||!frameRate||(rate&&rate!==frameRate))return 0;
  rate=frameRate;
  const size=Math.floor(144000*bitrate/rate)+((c>>1)&1);
  if(i+size>bytes.length)return 0;
  samples+=1152;i+=size;
 }
 return rate&&i===bytes.length?Math.ceil(samples/rate*1000):0;
}
export {mp3Duration};

async function selectPrompt(db,id){
 if(id)return db.prepare('SELECT * FROM prompt_deck WHERE id=?').bind(id).first();
 return db.prepare('SELECT * FROM prompt_deck ORDER BY random() LIMIT 1').first();
}

async function ensureDaily(db,now){
 const start=Math.floor(now/day)*day;
 const dates=[start-day,start];
 const statements=[];
 for(const date of dates){
  const serial=Math.floor(date/day);
  const {results}=await db.prepare('SELECT id FROM prompt_deck ORDER BY id').all();
  if(!results.length)continue;
  const existing=await db.prepare('SELECT count(*) AS n FROM challenges WHERE code LIKE ?').bind('S:'+serial+':%').first();
  if(existing.n===19)continue;
  for(let i=0;i<19;i++){
   const row=await selectPrompt(db,results[(serial*19+i)%results.length].id);
   const open=date+Math.floor(i*day/19),variant=remix(row);
   statements.push(db.prepare(`INSERT OR IGNORE INTO challenges
    (id,code,name,prompt_id,prompt,answers,state,created_ms,start_ms,submit_until,vote_until)
    VALUES (?, ?, ?, ?, ?, ?, 'daily', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(),'S:'+serial+':'+i,'Daily apology '+(i+1),row.id,variant.prompt,
      JSON.stringify(variant.facts),now,open,open+day,open+2*day));
  }
 }
 if(statements.length)await db.batch(statements);
}

async function close(env,game,room,now){
 const db=env.DB;
 if(!room.finalized_ms){
  let winners=[];
  if(game==='wemember'){
   const {results}=await db.prepare(`SELECT user_id FROM challenge_players WHERE challenge_id=? AND cost IS NOT NULL AND score>0
     ORDER BY score DESC,elapsed_ms,tie_key LIMIT 3`).bind(room.id).all();
   winners=results.map(x=>x.user_id);
  }else if(game==='sorriest'){
   const {results}=await db.prepare(`SELECT p.user_id,count(v.choice) AS votes FROM challenge_players p
      JOIN challenge_votes v ON v.challenge_id=p.challenge_id AND v.choice=p.user_id
      WHERE p.challenge_id=? AND p.reply IS NOT NULL AND p.cost IS NOT NULL
      GROUP BY p.user_id ORDER BY votes DESC,p.tie_key LIMIT 10`).bind(room.id).all();
   winners=results.map(x=>x.user_id);
  }else{
   const {results}=await db.prepare(`SELECT v.*,p.user_id FROM challenge_votes v JOIN challenge_players p
      ON p.challenge_id=v.challenge_id AND p.user_id=v.voter
      WHERE v.challenge_id=? AND p.role='jury' AND p.cost IS NOT NULL ORDER BY p.tie_key`).bind(room.id).all();
   const sides=await getPlayers(db,room.id);
   const hostVotes=results.filter(x=>x.choice==='host');
   const otherVotes=results.filter(x=>x.choice==='opponent');
   if(results.length>=3&&hostVotes.length!==otherVotes.length){
    const majority=hostVotes.length>otherVotes.length?hostVotes:otherVotes;
    const winner=sides.results.find(x=>x.role===majority[0].choice&&x.cost!==null);
    if(winner)winners=[winner.user_id,...majority.map(x=>x.user_id)];
   }
  }
  await db.prepare(`UPDATE challenges SET finalized_ms=?,state='closed',reward_users=?,
    audio_delete_at=CASE WHEN audio_key IS NULL THEN NULL ELSE ? END WHERE id=? AND finalized_ms IS NULL`)
    .bind(now,JSON.stringify(winners),now+15*60000,room.id).run();
  room=await state(db).bind(room.id).first();
 }
 if(!room.reward_sent)await settle(env,game,room);
 return room;
}

export async function maintainChallenges(env,game,now=Date.now()){
 const db=env.DB;
 if(game==='sorriest')await ensureDaily(db,now);
 const {results}=await db.prepare(`SELECT * FROM challenges WHERE
   (reward_users IS NOT NULL AND reward_sent=0)
   OR (finalized_ms IS NULL AND (vote_until<=? OR (?='wemember' AND submit_until<=?)))
   ORDER BY created_ms LIMIT 30`).bind(now,game,now).all();
 for(const room of results){try{await close(env,game,room,now);}catch{console.error('Game settlement pending',room.id);}}
 if(game==='wemember'){
  const abandoned=now-day;
  const {results:expired}=await db.prepare(`SELECT * FROM challenges WHERE audio_key IS NOT NULL AND
   (audio_delete_at<=? OR (state='lobby' AND created_ms<=?)) ORDER BY created_ms LIMIT 50`).bind(now,abandoned).all();
  for(const room of expired){
   try{
    await env.MEDIA.delete(room.audio_key);
    await db.prepare('UPDATE challenges SET audio_key=NULL WHERE id=? AND audio_key=?').bind(room.id,room.audio_key).run();
   }catch{console.error('Temporary audio deletion pending',room.id);}
  }
 }
}

export async function challenges(request,env,game,render){
 const url=new URL(request.url),route=url.pathname,method=request.method,now=Date.now(),db=env.DB;
 const daily=game==='sorriest';
 if(!['/challenge/new','/daily','/record-host.js','/mp3-encoder.js','/mp3-encoder-license.txt'].includes(route)&&
    !/^\/(daily|challenge)\/[0-9a-f-]+(?:\/(audio|recording))?$/.test(route))return null;
 const show=(title,body,status)=>render(title,'<h1>'+esc(title)+'</h1><div class="panel">'+body+'</div>',status);
 if(['/record-host.js','/mp3-encoder.js','/mp3-encoder-license.txt'].includes(route)&&game==='wemember'&&['GET','HEAD'].includes(method)){
  const file=await env.MEDIA.get('scripts/'+route.slice(1));
  return file?new Response(method==='HEAD'?null:file.body,{headers:{'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'public,max-age=3600'}}):new Response(null,{status:404});
 }
 if(method==='POST'&&request.headers.get('Origin')!==url.origin)return new Response(null,{status:403});
 if(!['GET','POST'].includes(method))return new Response(null,{status:405});
 if(route==='/daily'&&daily&&method==='GET'){
  await ensureDaily(db,now);
  const today=Math.floor(now/day)*day;
  const {results}=await db.prepare("SELECT id,name,start_ms,submit_until,vote_until FROM challenges WHERE vote_until>? AND start_ms<? ORDER BY start_ms DESC")
    .bind(now,today+day).all();
  return show('Daily Sorriest',text('19 contests open over the UTC day. Each entry costs 20 tokens. One apology up to 500 characters per contest.')+link('How to play and earn tokens','/#how-to-play')+
    results.map(row=>'<div class="player">'+esc(row.name)+' · '+(row.start_ms>now?'Opens '+date(row.start_ms):row.submit_until>now?'Accepting entries until '+date(row.submit_until):'Voting until '+date(row.vote_until))+link('View contest',path(game,row.id))+'</div>').join(''));
 }
 if(route==='/challenge/new'&&!daily){
  const user=await gameUser(request,env,game);
  if(!user)return go('/auth/start?next=%2Fchallenge%2Fnew');
  if(method==='GET')return show(game==='barara'?'Open a private court':'Host a voice challenge',
    form('<label for="name">Room name</label><input id="name" name="name" required maxlength="48">'+
      (game==='barara'?'<label for="case">Case</label><select id="case" name="case"><option value="B001">The missing cookie</option><option value="B002">The borrowed umbrella</option></select>':'')+
      button('create','Create room')));
  const fields=await readForm(request), name=fields?.get('name')?.trim();
  if(!name||name.length>48)return show('Set a room name',link('Try again','/challenge/new'),400);
  const prompt=await selectPrompt(db,game==='barara'?fields.get('case'):null);
  if(!prompt)return show('Choose a valid prompt',link('Try again','/challenge/new'),400);
  const id=crypto.randomUUID(), variant=remix(prompt);
  await db.batch([
   db.prepare("INSERT INTO challenges(id,host,name,prompt_id,prompt,answers,state,created_ms) VALUES(?,?,?,?,?,?,'lobby',?)")
      .bind(id,user.id,name,prompt.id,variant.prompt,JSON.stringify(variant.facts),now),
   db.prepare('INSERT INTO challenge_players(challenge_id,user_id,username,role,tie_key) VALUES(?,?,?,?,?)')
      .bind(id,user.id,user.username,'host',crypto.randomUUID())
  ]);
  return go(path(game,id));
 }
 const match=/^\/(daily|challenge)\/([a-f0-9-]+)(?:\/(audio|recording))?$/.exec(route);
 if(!match||!uuid.test(match[2])||daily!==(match[1]==='daily'))return show('Page not found',link('Game home','/'),404);
 const id=match[2], actionPath=match[3],base=path(game,id);
 let room=await state(db).bind(id).first();
 if(!room)return show('Room not found',link('Game home','/'),404);
 const user=await gameUser(request,env,game);
 if(!user)return show(daily?room.name:'You’re invited',text(daily?room.prompt:'Sign in with Balagan to open this invitation.')+
  link('Sign in','/auth/start?next='+encodeURIComponent(base))+
  link('Create account','/auth/start?action=register&next='+encodeURIComponent(base)),method==='POST'?401:200);
 const host=room.host===user.id;
 let player=await where(db,id,user.id);
 if(!room.finalized_ms&&((room.vote_until&&now>=room.vote_until)||(game==='wemember'&&room.submit_until&&now>=room.submit_until))){
  room=await close(env,game,room,now);
 }
 const phase=room.finalized_ms?'closed':daily?(now<room.start_ms?'scheduled':now<room.submit_until?'play':'vote'):room.state;
 if(actionPath==='recording'&&game==='wemember'&&method==='POST'){
  if(!host||phase!=='lobby')return new Response('Recording is available to the host before play.',{status:403});
  if(!/^audio\/mpeg(?:;|$)/i.test(request.headers.get('Content-Type')||''))return new Response('Upload MP3 audio.',{status:415});
  const data=await readFixed(request,1600000),length=data&&mp3Duration(data);
  if(!length||length<1500||length>60000)return new Response('Record a valid MP3 clip between 1.5 and 60 seconds.',{status:400});
  const key='recordings/'+id+'/'+crypto.randomUUID()+'.mp3';
  await env.MEDIA.put(key,data,{httpMetadata:{contentType:'audio/mpeg'}});
  const result=await db.prepare("UPDATE challenges SET audio_key=?,audio_ms=? WHERE id=? AND state='lobby' AND audio_key IS ?")
   .bind(key,length,id,room.audio_key).run();
  if(!result.meta.changes){await env.MEDIA.delete(key);return new Response('Room changed. Refresh and try again.',{status:409});}
  if(room.audio_key)await env.MEDIA.delete(room.audio_key);
  return Response.json({ms:length});
 }
 if(actionPath==='audio'&&game==='wemember'&&method==='POST'){
  if(!room.audio_key||(!host&&(phase!=='play'||player?.cost==null||player.listen_ms!=null))||(host&&phase!=='lobby'))
   return new Response('Playback unavailable.',{status:410});
  const file=await env.MEDIA.get(room.audio_key);
  if(!file)return new Response('Audio unavailable.',{status:503});
  if(!host){
   const updated=await db.prepare('UPDATE challenge_players SET listen_ms=? WHERE challenge_id=? AND user_id=? AND listen_ms IS NULL').bind(Date.now(),id,user.id).run();
   if(!updated.meta.changes){await file.body.cancel();return new Response(null,{status:410});}
  }
  return new Response(file.body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store'}});
 }
 if(actionPath)return new Response(null,{status:404});
 if(method==='POST'){
  const fields=await readForm(request),action=fields?.get('action');
  if(action==='join'&&phase==='lobby'&&!daily&&!player){
   const added=await db.prepare(`INSERT OR IGNORE INTO challenge_players(challenge_id,user_id,username,role,tie_key)
     SELECT ?,?,?,CASE WHEN ?='barara' THEN CASE WHEN EXISTS(SELECT 1 FROM challenge_players WHERE challenge_id=? AND role='opponent')
       THEN 'jury' ELSE 'opponent' END ELSE 'player' END,?
     FROM challenges WHERE id=? AND state='lobby'
      AND (?!='barara' OR (SELECT count(*) FROM challenge_players WHERE challenge_id=?)<7)`)
     .bind(id,user.id,user.username,game,id,crypto.randomUUID(),id,game,id).run();
   if(!added.meta.changes)return show('Room is full or has started',link('Back to room',base),409);
  }else if(action==='start'&&host&&phase==='lobby'&&!daily){
   const {results}=await getPlayers(db,id);
   if(game==='wemember'&&(!room.audio_key||results.length<2))return show('Add a recording and invite a player first',link('Back to room',base),409);
   if(game==='barara'&&!results.some(x=>x.role==='opponent'))return show('Invite an opponent first',link('Back to room',base),409);
   const end=now+(game==='wemember'?10:8)*60000;
   await db.prepare("UPDATE challenges SET state='play',start_ms=?,submit_until=?,vote_until=? WHERE id=? AND state='lobby'")
    .bind(now,end,game==='barara'?end+2*60000:null,id).run();
  }else if(action==='enter'&&phase==='play'&&(player||(daily&&!player))&&!(game==='wemember'&&host)){
   if(game==='barara'&&room.submit_until<=now)return go(base);
   if(!player){
    await db.prepare("INSERT OR IGNORE INTO challenge_players(challenge_id,user_id,username,role,tie_key) VALUES(?,?,?,'player',?)")
      .bind(id,user.id,user.username,crypto.randomUUID()).run();
    player=await where(db,id,user.id);
   }
   if(player.cost==null){
    const result=await pay(request,env,game,id);
    if(result.status===402)return show('You need more tokens',link('Open wallet','https://balagan.live/wallet'),402);
    if(result.status)return show('Entry is temporarily unavailable',link('Return',base),503);
    await db.prepare('UPDATE challenge_players SET cost=? WHERE challenge_id=? AND user_id=? AND cost IS NULL')
      .bind(result.cost,id,user.id).run();
   }
  }else if(action==='submit'&&phase==='play'&&player?.cost!=null&&game!=='barara'){
   const answer=fields.get('reply')?.trim();
   const limit=daily?500:1000;
   if(!answer||[...answer].length>limit)return show('Check your answer length',link('Return',base),400);
   const elapsed=daily?0:now-player.listen_ms-room.audio_ms;
   if(!daily&&(player.listen_ms==null||elapsed<0))return show('Finish listening before submitting',link('Return',base),409);
   const score=daily?null:recallScore(answer,JSON.parse(room.answers));
   await db.prepare(`UPDATE challenge_players SET reply=?,score=?,elapsed_ms=? WHERE challenge_id=? AND user_id=? AND reply IS NULL
     AND EXISTS(SELECT 1 FROM challenges WHERE id=? AND finalized_ms IS NULL AND submit_until>?)`)
     .bind(answer,score,elapsed,id,user.id,id,now).run();
  }else if(action==='argument'&&game==='barara'&&phase==='play'&&player?.cost!=null&&now<room.submit_until){
   const reply=fields.get('reply')?.trim();
   const n=Number(fields.get('turn'));
   if(!reply||[...reply].length>1000||!Number.isInteger(n)||n<0||n>=14||player.role!==(n%2?'opponent':'host'))
    return show('That turn is unavailable',link('Return',base),409);
   const result=await db.prepare(`INSERT OR IGNORE INTO challenge_turns
      SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM challenge_turns WHERE challenge_id=?)=?
      AND EXISTS(SELECT 1 FROM challenges WHERE id=? AND state='play' AND submit_until>?)`)
    .bind(id,n,user.id,reply,now,id,n,id,now).run();
   if(result.meta.changes&&n===13)await db.prepare("UPDATE challenges SET state='vote',vote_until=? WHERE id=? AND state='play'")
    .bind(Math.min(now+2*60000,room.vote_until),id).run();
  }else if(action==='open-vote'&&game==='barara'&&host&&phase==='play'){
   await db.prepare("UPDATE challenges SET state='vote',vote_until=? WHERE id=? AND state='play' AND (SELECT count(*) FROM challenge_turns WHERE challenge_id=?)>=2")
    .bind(Math.min(now+2*60000,room.vote_until),id,id).run();
  }else if(action==='vote'&&player?.cost!=null&&(phase==='vote'||game==='barara'&&phase==='play'&&room.submit_until<=now)){
   const choice=fields.get('choice');
   const allowed=daily?choice!==user.id&&await db.prepare('SELECT 1 FROM challenge_players WHERE challenge_id=? AND user_id=? AND reply IS NOT NULL AND cost IS NOT NULL').bind(id,choice).first()
     :player.role==='jury'&&['host','opponent'].includes(choice);
   if(allowed)await db.prepare(`INSERT OR IGNORE INTO challenge_votes SELECT ?,?,? WHERE EXISTS(
     SELECT 1 FROM challenges WHERE id=? AND finalized_ms IS NULL AND vote_until>?)`).bind(id,user.id,choice,id,now).run();
  }else if(action==='finish'&&host&&game==='barara'&&phase==='vote'){
   const remaining=await db.prepare(`SELECT count(*) AS n FROM challenge_players p WHERE challenge_id=? AND role='jury'
     AND cost IS NOT NULL AND NOT EXISTS(SELECT 1 FROM challenge_votes v WHERE v.challenge_id=p.challenge_id AND v.voter=p.user_id)`).bind(id).first();
   if(!remaining.n)await close(env,game,room,now);
  }else if(action==='finish'&&host&&game==='wemember'&&phase==='play'){
   const {results}=await getPlayers(db,id);
   if(results.some(p=>p.role==='player')&&results.filter(p=>p.role==='player').every(p=>p.reply))await close(env,game,room,now);
  }
  return go(base);
 }
 if(!daily&&!player&&phase!=='lobby')return show('This private room has already started',link('Game home','/'),409);
 const {results:players}=await getPlayers(db,id);
 if(phase==='scheduled')return show(room.name,text('Opens '+date(room.start_ms)));
 let content=game!=='wemember'||host||phase==='closed'?text(room.prompt.replace('|',' · ')):'';
 if(phase==='lobby'){
  if(game==='barara')content+=text('One host, one opponent and up to five jurors. Each player pays 30 tokens to play.');
  content+='<label for="invite">Invitation link</label><input id="invite" value="'+esc(url.origin+base)+'" readonly>';
  content+=players.map(p=>'<div class="player">'+esc(p.username)+' · '+esc(p.role)+'</div>').join('');
  if(!player)content+=form(button('join','Join lobby'));
  if(host){
   if(game==='wemember')content+='<section id="host-capture" data-upload="'+base+'/recording" data-ready="'+Boolean(room.audio_key)+'"><p>Read the script aloud. Vary your speed, volume and tone freely.</p><button id="record">Record microphone</button> <button id="stop" disabled>Stop and save MP3</button><label for="mp3">Or choose an MP3</label><input type="file" id="mp3" accept="audio/mpeg,.mp3"><small><a href="/mp3-encoder-license.txt">MP3 encoder license</a></small><p id="capture-status" role="status">'+(room.audio_key?'Recording ready.':'')+'</p></section><script src="/mp3-encoder.js" defer></script><script src="/record-host.js" defer></script>';
   if(game==='barara'||room.audio_key)content+=form(button('start','Start challenge'));
  }
 }else if(phase==='play'&&!(game==='barara'&&now>=room.submit_until)){
  if(host&&game==='wemember')content+=text('Players can listen and submit until '+date(room.submit_until))+form(button('finish','Reveal when all players have replied'));
  else if(player?.cost==null)content+=form(button('enter',game==='wemember'?'Enter · free if available, otherwise 15 tokens':'Enter · '+cost[game]+' tokens'));
  else if(game==='wemember'){
   if(player.reply)content+=text('Answer locked. Results appear when the round closes.');
   else{
    if(player.listen_ms==null)content+='<button id="listen" data-src="'+base+'/audio">Play recording once</button><p id="audio-status" role="status"></p><script>document.getElementById("listen").onclick=async function(){this.disabled=true;const s=document.getElementById("audio-status");try{const r=await fetch(this.dataset.src,{method:"POST"});if(!r.ok)throw Error();const a=new Audio(URL.createObjectURL(await r.blob()));a.onended=()=>{s.textContent="Playback ended. Type your reply.";document.getElementById("recall").disabled=false;};await a.play();}catch{s.textContent="Playback failed. Tell the host."}};</script>';
    content+=form('<fieldset id="recall" '+(player.listen_ms==null||Date.now()<player.listen_ms+room.audio_ms?'disabled':'')+'>'+field('Type what you remember',1000)+button('submit','Lock answer')+'</fieldset>');
   }
  }else if(daily)content+=player.reply?text('Apology locked. Voting opens '+date(room.submit_until)):form(field('Your apology',500)+button('submit','Lock apology'));
  if(game==='barara'){
   const {results:turns}=await db.prepare('SELECT * FROM challenge_turns WHERE challenge_id=? ORDER BY turn_number').bind(id).all();
   content+=turns.map(t=>'<div class="player"><strong>'+esc(players.find(p=>p.user_id===t.user_id)?.username)+' · Round '+(Math.floor(t.turn_number/2)+1)+'</strong>'+text(t.body)+'</div>').join('');
   const n=turns.length;
   if(player?.cost!=null&&n<14&&player.role===(n%2?'opponent':'host'))
    content+=form(escapeField('turn',n)+field('Your argument',1000)+button('argument','Send argument'));
   if(host&&n>=2)content+=form(button('open-vote','Open jury voting'));
  }
 }else if(phase==='vote'||game==='barara'&&phase==='play'&&now>=room.submit_until){
  const prior=await db.prepare('SELECT 1 FROM challenge_votes WHERE challenge_id=? AND voter=?').bind(id,user.id).first();
  if(game==='barara'){
   const {results:turns}=await db.prepare('SELECT * FROM challenge_turns WHERE challenge_id=? ORDER BY turn_number').bind(id).all();
   content+=turns.map(t=>'<div class="player"><strong>'+esc(players.find(p=>p.user_id===t.user_id)?.username)+'</strong>'+text(t.body)+'</div>').join('');
   if(!prior&&player?.role==='jury'&&player.cost!=null)
    content+=form('<label for="choice">Your verdict</label><select id="choice" name="choice"><option value="host">Host wins</option><option value="opponent">Opponent wins</option></select>'+button('vote','Lock vote'));
   if(host&&phase==='vote')content+=form(button('finish','Reveal when the jury has voted'));
  }else if(player?.cost!=null&&!prior){
   const choices=players.filter(p=>p.reply&&p.user_id!==user.id).sort((a,b)=>a.tie_key.localeCompare(b.tie_key));
   content+=choices.map(p=>'<div class="player">'+text(p.reply)+form(escapeField('choice',p.user_id)+button('vote','Vote for this apology'))+'</div>').join('');
   if(!choices.length)content+=text('No other apologies to vote for.');
  }
  if(prior)content+=text('Your vote is recorded.');
 }else if(phase==='closed'){
  const winners=JSON.parse(room.reward_users||'[]');
  if(game==='wemember')content+='<h2>Recall scores</h2>'+players.filter(p=>p.reply).sort((a,b)=>b.score-a.score||a.elapsed_ms-b.elapsed_ms||a.tie_key.localeCompare(b.tie_key))
    .map(p=>'<div class="player">'+esc(p.username)+' · '+p.score+' / 3 · '+(p.elapsed_ms/1000).toFixed(2)+' seconds</div>').join('');
  if(game==='sorriest'){
   const {results}=await db.prepare("SELECT p.reply,p.username,count(v.choice) AS votes FROM challenge_players p LEFT JOIN challenge_votes v ON v.challenge_id=p.challenge_id AND v.choice=p.user_id WHERE p.challenge_id=? AND p.reply IS NOT NULL GROUP BY p.user_id ORDER BY votes DESC,p.tie_key")
     .bind(id).all();
   content+=results.map(p=>'<div class="player"><strong>'+esc(p.username)+' · '+p.votes+' votes</strong>'+text(p.reply)+'</div>').join('');
  }
  content+='<h2>Token awards</h2>'+(winners.length?winners.map((key,i)=>'<div class="player">'+esc(players.find(p=>p.user_id===key)?.username)+' · '+poolRewards[game][i]+' tokens</div>').join(''):text('No token awards this round.'));
  if(!room.reward_sent&&winners.length)content+=text('The wallet is recording these rewards.');
 }
 return show(room.name,content+link('Refresh',base));
}

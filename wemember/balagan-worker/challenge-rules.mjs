import {signSettlement} from './settlement-proof.mjs';

export const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const text=v=>'<p class="answer">'+esc(v)+'</p>';
export const date=v=>new Date(v).toISOString().replace('T',' ').slice(0,16)+' UTC';
export const go=url=>new Response(null,{status:303,headers:{Location:url}});
export const button=(action,label)=>'<button name="action" value="'+action+'">'+label+'</button>';
export const form=(contents,path='')=>'<form method="post" action="'+esc(path)+'">'+contents+'</form>';
export const field=(title,max)=>'<label for="reply">'+title+'</label><textarea id="reply" name="reply" maxlength="'+max+'" required></textarea>';
export const link=(label,url)=>'<a class="button" href="'+esc(url)+'">'+label+'</a>';
export const randomIndex=length=>crypto.getRandomValues(new Uint32Array(1))[0]%length;
export function remix(row){
 const pools=JSON.parse(row.slots_json);
 const keys=Object.keys(pools);
 const idx=keys.map(key=>randomIndex(pools[key].length));
 if(keys.length&&idx.every(n=>!n))idx[randomIndex(idx.length)]=1;
 const facts=keys.map((key,i)=>({value:pools[key][idx[i]],options:pools[key]}));
 return {prompt:row.template.replace(/\[([A-Z]{2})\]/g,(_,key)=>pools[key][idx[keys.indexOf(key)]]),facts};
}
const norm=v=>String(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\bsix forty\b/g,'6:40')
 .replace(/\bseven (fifteen|quarter past)\b|\bquarter past seven\b/g,'7:15').replace(/\beight twenty\b/g,'8:20')
 .replace(/\bnine forty.five\b|\bquarter to ten\b/g,'9:45').replace(/\bten thirty\b|\bhalf past ten\b/g,'10:30')
 .replace(/\b(five|ten|fifteen|twenty|thirty)\s*(minutes?|mins?)\b/g,(_,n)=>({five:5,ten:10,fifteen:15,twenty:20,thirty:30}[n])+' minutes')
 .replace(/\b(m|mins?|minute)\b/g,'minutes').replace(/\bcaf[eé]\b/g,'cafe')
 .replace(/\btorch\b/g,'flashlight').replace(/\bgray\b/g,'grey').replace(/[^a-z0-9]+/g,' ').trim();
export function recallScore(answer,facts){
 const source=' '+norm(answer)+' ';
 return facts.filter(fact=>{
  const actual=norm(fact.value).replace(/^(a |an |the )/,'');
  const found=fact.options.map(norm).map(x=>x.replace(/^(a |an |the )/,'')).filter(x=>source.includes(' '+x+' '));
  return found.includes(actual)&&new Set(found).size===1;
 }).length;
}

export async function readForm(request){
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')||''))return null;
 const body=await readFixed(request,6000);
 return body?new URLSearchParams(new TextDecoder().decode(body)):null;
}
export async function readFixed(request,limit){
 const reader=request.body?.getReader();
 if(!reader)return null;
 const chunks=[];let len=0;
 while(true){const {value,done}=await reader.read();if(done)break;len+=value.byteLength;if(len>limit){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(len);let index=0;
 for(const value of chunks){bytes.set(value,index);index+=value.byteLength;}
 return bytes;
}

export async function pay(request,env,game,id){
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-balagan=([^;]+)/)?.[1];
 const result=await env.BALAGAN.fetch(new Request('https://balagan.live/api/entry',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Balagan-Game':game,'X-Balagan-Round':id}}));
 return result.ok?{cost:(await result.json()).cost}:{status:result.status};
}
export async function settle(env,game,row){
 if(row.reward_sent||!row.reward_users)return;
 const body=JSON.stringify({game,round:row.id,winners:JSON.parse(row.reward_users)});
 const ts=String(Math.floor(Date.now()/1000));
 const signature=await signSettlement(env.BALAGAN_JWT_SECRET,ts,body);
 const res=await env.BALAGAN.fetch(new Request('https://balagan.live/api/game-rewards',{method:'POST',body,headers:{
 'Content-Type':'application/json','X-Balagan-Time':ts,'X-Balagan-Signature':signature
 }}));
 if(res.ok)await env.DB.prepare('UPDATE challenges SET reward_sent=1 WHERE id=?').bind(row.id).run();
}

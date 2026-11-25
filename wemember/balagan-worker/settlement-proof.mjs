const utf8=new TextEncoder();
export async function signSettlement(secret,issued,body){
 if(!/^[0-9a-f]{64}$/i.test(secret||''))throw new Error('Missing game signing key');
 const bytes=Uint8Array.from(secret.match(/../g),n=>parseInt(n,16));
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,utf8.encode('balagan-rewards-v1\n'+issued+'\n'+body));
 return Array.from(new Uint8Array(signature),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function validSettlement(secret,issued,body,supplied,now=Math.floor(Date.now()/1000)){
 if(!/^\d{10}$/.test(issued||'')||Math.abs(now-Number(issued))>120||!(/^[0-9a-f]{64}$/.test(supplied||'')))return false;
 const expected=await signSettlement(secret,issued,body);
 let mismatch=0;
 for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^supplied.charCodeAt(i);
 return mismatch===0;
}

#!/usr/bin/env node
// Probe specific (public) Tipprunde slugs while logged in, to capture per-community
// page structure + locate the TIP-DISTRIBUTION ("Tippverteilung") feature.
// Usage: node recon/probe_communities.mjs [slug1,slug2,...]

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'research', 'recon');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function loadEnv() {
  const raw = await readFile(join(ROOT, '.env'), 'utf8');
  const env = {};
  for (const l of raw.split('\n')) { const t = l.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
  return env;
}
class Jar { constructor(){this.c=new Map();} ingest(s=[]){for(const sc of s){const f=sc.split(';')[0];const j=f.indexOf('=');if(j<0)continue;const n=f.slice(0,j).trim(),v=f.slice(j+1).trim();if(!v||/deleted/i.test(v))this.c.delete(n);else this.c.set(n,v);}} header(){return[...this.c.entries()].map(([k,v])=>`${k}=${v}`).join('; ');} names(){return[...this.c.keys()];} }

async function go(jar, method, url, { body, contentType } = {}) {
  let u=url,m=method,b=body,ct=contentType,hops=0;
  while(true){
    const h={'User-Agent':UA,'Accept':'text/html,*/*;q=0.8','Accept-Language':'de-DE,de;q=0.9'};
    const c=jar.header(); if(c)h['Cookie']=c; if(b!=null&&ct)h['Content-Type']=ct;
    const r=await fetch(u,{method:m,headers:h,body:b,redirect:'manual'});
    const sc=typeof r.headers.getSetCookie==='function'?r.headers.getSetCookie():[]; jar.ingest(sc);
    if([301,302,303,307,308].includes(r.status)&&r.headers.get('location')&&hops<10){
      u=new URL(r.headers.get('location'),u).toString(); if(r.status===302||r.status===303){m='GET';b=undefined;ct=undefined;} hops++; continue;
    }
    return { finalUrl:u, status:r.status, html:await r.text() };
  }
}
function scan(html){
  const has=re=>re.test(html); const all=re=>[...new Set([...html.matchAll(re)].map(m=>m[1]))];
  return {
    isRealRound: has(/id=["']kicktipp-content["']/i),
    redirectedHome: false,
    score_input_names: all(/<input[^>]*\bname=["']([^"']*(?:heimTipp|gastTipp)[^"']*)["']/gi),
    odds_classes: ['kicktipp-wettquote','wettquote-link','quote-heim','quote-remis','quote-gast','quote-text','quote-label','quote-link'].filter(c=>html.includes(c)),
    tippabgabeSpiele: has(/id=["']tippabgabeSpiele["']/i),
    tippverteilung: has(/Tippverteilung|Verteilung der Tipps|verteilung/i),
    distribution_links: all(/href=["']([^"']*(?:verteilung|spielinfo|tippuebersicht\/spiel|tippspielId=)[^"']*)["']/gi).slice(0,30),
    tippspielIds: all(/tippspielId=([0-9]+)/gi).slice(0,15),
    tippsaisonIds: all(/tippsaisonId=([0-9]+)/gi).slice(0,5),
    spieltagIndexes: all(/spieltagIndex=([0-9]+)/gi).slice(0,10),
    pageTitle: (html.match(/<title>([^<]*)<\/title>/i)||[])[1]||'',
    h1: (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[,''])[1].replace(/<[^>]*>/g,'').trim().slice(0,80),
  };
}
const save=(n,d)=>writeFile(join(OUT,n),typeof d==='string'?d:JSON.stringify(d,null,2));

async function main(){
  await mkdir(OUT,{recursive:true});
  const env=await loadEnv();
  const BASE=(env.KICKTIPP_BASE_URL||'https://www.kicktipp.de').replace(/\/$/,'');
  const jar=new Jar();
  // login
  const lp=await go(jar,'GET',`${BASE}/info/profil/login`);
  const action=(lp.html.match(/<form[^>]*action=["']([^"']*)["'][^>]*>[\s\S]*?name=["']?kennung/i)||[])[1]||'/info/profil/loginaction';
  const p=new URLSearchParams({kennung:env.KICKTIPP_EMAIL,passwort:env.KICKTIPP_PASSWORD,submitbutton:'Anmelden'});
  await go(jar,'POST',new URL(action,`${BASE}/info/profil/login`).toString(),{body:p.toString(),contentType:'application/x-www-form-urlencoded'});
  console.log('logged in, cookies:',jar.names().join(', '));

  const slugs=(process.argv[2]||'bundesliga-tippspiel,wm-tippspiel,wm2026-tippspiel,weltmeisterschaft-tippspiel,fussball-wm-tippspiel,wmtippspiel,em-tippspiel,champions-league-tippspiel').split(',');
  const report={base:BASE,slugs:{}};
  for(const slug of slugs){
    const rec={};
    for(const page of ['','tippabgabe','tippuebersicht','tabellen','tippspielplan']){
      const url=`${BASE}/${slug}${page?'/'+page:''}`;
      const r=await go(jar,'GET',url);
      const onHome=r.finalUrl===`${BASE}/`||/info\/tippspiele/i.test(r.finalUrl);
      const s=scan(r.html); s.redirectedHome=onHome;
      if(s.isRealRound&&!onHome) await save(`comm_${slug}_${page||'root'}.html`,r.html);
      rec[page||'root']={status:r.status,finalUrl:r.finalUrl,onHome,real:s.isRealRound&&!onHome,title:s.pageTitle,h1:s.h1,tippverteilung:s.tippverteilung,odds:s.odds_classes,scoreInputs:s.score_input_names.slice(0,4),tippspielIds:s.tippspielIds.slice(0,5),spieltagIndexes:s.spieltagIndexes,tippsaisonIds:s.tippsaisonIds};
      console.log(`  ${slug}/${page||'(root)'} -> ${r.status} ${onHome?'[redir home]':(s.isRealRound?'[REAL]':'[?]')} ${s.h1?('h1="'+s.h1+'"'):''}${s.tippverteilung?' +VERTEILUNG':''}`);
    }
    report.slugs[slug]=rec;
    // distribution hunt for the first real round
    const ueber=rec['tippuebersicht'], abg=rec['tippabgabe'];
    const ids=[...new Set([...(ueber?.tippspielIds||[]),...(abg?.tippspielIds||[])])];
    if((ueber?.real||abg?.real) && ids.length){
      let i=0;
      for(const id of ids.slice(0,3)){
        const url=`${BASE}/${slug}/tippuebersicht/spiel?tippspielId=${id}`;
        const r=await go(jar,'GET',url); const s=scan(r.html);
        await save(`comm_${slug}_spiel_${id}.html`,r.html);
        console.log(`    match-detail ${id} -> ${r.status} verteilung=${s.tippverteilung}`);
        rec[`spiel_${id}`]={status:r.status,finalUrl:r.finalUrl,tippverteilung:s.tippverteilung};
        i++;
      }
    }
  }
  await save('communities_report.json',report);
  console.log('\n✓ saved communities_report.json + real-round HTML snapshots');
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});

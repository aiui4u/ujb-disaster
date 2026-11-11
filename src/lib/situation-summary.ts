import {CITIES,fresh,kstDay,type Situation,type Message} from './model';
import {buildHazards} from './hazards';
import {number} from './weather-data';
export const ANALYSIS_FIELDS=[{key:'current',title:'현재상황',sub:'CURRENT'},{key:'prediction',title:'예측상황',sub:'FORECAST'},{key:'actions',title:'조치사항',sub:'ACTIONS'}] as const;
function clock(at:string){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));}
function finish(rows:string[],missing:boolean){return [...new Set(rows)].length?[...new Set(rows)]:[missing?'자료 미확보':'특이사항 없음'];}
const significant=/호우|홍수|산불|산사태|태풍|지진|해일|침수|붕괴|대설|폭설|폭염|한파|강풍|풍랑|화재|대피|통제|정전|단수|가스\s*누출|화학\s*사고/;
const directive=/대피|접근\s*(금지|자제)|출입\s*(금지|통제)|이용\s*(금지|통제)|우회|통행\s*(제한|금지|통제)|안전한\s*곳|방문\s*자제|운행\s*중단|차량\s*이동|전원\s*차단|신고(?:해|하시|하여|바랍)|삼가|자제|주의(?:\s*하시|\s*해|\s*하여|\s*바랍|하세요)|유의(?:하시|해|하여|바랍)|금지|창문.{0,12}닫|마스크.{0,12}착용/;
export function synthesiseSituation(data:Situation|null,messages:Message[],now=Date.now()){
 const current:string[]=[],prediction:string[]=[],actions:string[]=[];
 const w=data?.warnings,wValid=!!w?.verified&&fresh(w.collectedAt,90,now)&&!w.error;
 const feeds=data?.feeds??[];
 const feed=(id:string)=>feeds.find(f=>f.id===id);
 const groups=new Map<string,Set<string>>();
 if(wValid)for(const city of w!.cities.filter(c=>CITIES.includes(c.name))){
  for(const warning of city.active){const key=`${warning.kind} ${warning.level}`;const cities=groups.get(key)??new Set<string>();cities.add(city.name);groups.set(key,cities);}
  for(const warning of city.preliminary)prediction.push(`${city.name} ${warning.kind} 예비특보${warning.timing?` · ${warning.timing}`:''}.`);
 }
 const ordered=(names:string[])=>names.sort((a,b)=>a==='의정부시'?-1:b==='의정부시'?1:a.localeCompare(b,'ko'));
 for(const [kind,cities] of groups)current.push(`${ordered([...cities]).join('·')} ${kind} 발효 중.`);
 const regional=buildHazards(data,'regional',now);
 const fire=regional.find(h=>h.id==='fire')!;
 const freshFire=fresh(feed('fire')?.savedAt,90,now)&&!feed('fire')?.error;
 if(freshFire){
  const unresolved=fire.records.filter(r=>/미제공/.test(r.text));
  if(unresolved.length)current.push(`${ordered([...new Set(unresolved.map(r=>r.city))]).join('·')} 산불 발생정보 ${unresolved.length}건 · 진화완료 여부 미확인.`);
 }
 const landslide=regional.find(h=>h.id==='landslide')!;
 for(const record of landslide.records.filter(r=>!r.historical)){
  if(record.kind==='예측')prediction.push(`${record.city} ${record.text} · 분석 ${clock(record.at!)}.`);
  else if(!/해제|종료/.test(record.text))current.push(`${record.city} 산사태 ${record.text} · 발표 ${clock(record.at!)}.`);
 }
 // Relate observed water rises to a simultaneous official rain/typhoon warning.
 // No flood threshold or future level is inferred from an uncalibrated gauge value.
 const rainCities=new Set(wValid?w!.cities.filter(c=>c.active.some(v=>/호우|태풍/.test(v.kind))).map(c=>c.name):[]);
 const water=regional.find(h=>h.id==='water')!;
 for(const r of water.records.filter(r=>!r.historical&&rainCities.has(r.city))){
  if(r.measurement?.change?.startsWith('+'))current.push(`${r.title} 수위 ${r.measurement.value}cm · 직전 관측 대비 ${r.measurement.change} 상승, 호우·태풍특보 동시 발효.`);
 }
 // Forecast values supplement an official warning or forecast; dry/normal forecasts are omitted.
 const weather=data?.weather;
 const relevantWeather=wValid&&w!.cities.some(c=>c.name==='의정부시'&&[...c.active,...c.preliminary].some(v=>/호우|대설|태풍|강풍/.test(v.kind)));
 const forecastFresh=weather?.sources?.forecast?.ok&&fresh(weather.sources.forecast.base??weather.fetchedAt,720,now);
 if(relevantWeather&&forecastFresh){
  const hours=(weather?.hours??[]).filter(h=>Date.parse(h.at)>now&&Date.parse(h.at)<=now+12*3600000);
  const pops=hours.map(h=>number(h.values.POP)).filter((v):v is number=>v!==null&&v>=0&&v<=100);
  if(pops.length&&Math.max(...pops)>0)prediction.push(`의정부시 향후 12시간 강수확률 최대 ${Math.max(...pops)}%.`);
 }
 const recent=messages.filter(m=>fresh(m.at,360,now)&&significant.test(`${m.kind} ${m.text}`)&&!/훈련|시험\s*발송|테스트|연습/.test(m.text));
 const seen=new Set<string>();
 for(const m of [...recent].sort((a,b)=>b.at.localeCompare(a.at))){
  const key=`${m.kind}:${[...m.cities].sort().join(',')}`;if(seen.has(key))continue;seen.add(key);
  const label=ordered([...m.cities]).join('·');
  const parts=m.text.split(/\n+|(?<=[.!?。])\s+/).map(s=>s.trim()).filter(Boolean);
  const resolved=/해제|진화\s*완료|상황\s*종료|통행\s*재개/.test(m.text);
  if(!resolved)current.push(`${label} ${m.kind||'재난'} 안내 · ${clock(m.at)}: ${parts[0]||m.text}`);
  // Show the issuing authority's own instructions as received, never as actions completed by this system.
  const instructions=parts.filter(p=>directive.test(p)&&!/해제|진화\s*완료|통행\s*재개/.test(p));
  if(instructions.length)actions.push(`${label} 공식 문자 안내(${clock(m.at)}): ${instructions.join(' ')}`);
 }
 const messageAvailable=!!feed('messages')?.savedAt;
 const currentAvailable=wValid||freshFire||water.records.some(r=>!r.historical)||landslide.records.some(r=>!r.historical)||recent.length>0;
 const predictionAvailable=wValid||fresh(feed('prediction')?.savedAt,120,now)||!!forecastFresh;
 const actionAvailable=wValid||messageAvailable;
 return {current:finish(current,!currentAvailable),prediction:finish(prediction,!predictionAvailable),actions:finish(actions,!actionAvailable)};
}

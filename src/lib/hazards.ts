import {CITIES,field,fresh,kstDay,targetCities,type Situation,type Feed} from './model';
import {feedTimestamp,feedRegion} from './feed-health';
import {WATER_STATIONS} from './water-stations';
export type HazardId='water'|'fire'|'landslide'|'typhoon';
export type HazardScope='local'|'regional';
export type HazardRecord={id:string;city:string;title:string;text:string;at:string|null;historical?:boolean;kind?:string;measurement?:{value:string;unit:'cm';change:string|null}};
export type HazardSummary={id:HazardId;title:string;value:string;detail:string;note:string;at:string|null;records:HazardRecord[];empty:string;coverage?:string};
const titles:Record<HazardId,string>={water:'하천수위',fire:'산불',landslide:'산사태',typhoon:'태풍'};
const latest=(rows:HazardRecord[])=>[...rows].sort((a,b)=>(b.at??'').localeCompare(a.at??''));
function regionCities(area:string){return /^(경기도|경기\s)/.test(area.trim())?targetCities(area):[];}
export function compactWaterRows(rows:Record<string,unknown>[]){
 const groups=new Map<string,Record<string,unknown>[]>();
 for(const row of rows){const code=field(row,'WALE_OBSVTR_CD');if(!code||!feedTimestamp('water',row))continue;const group=groups.get(code)??[];group.push(row);group.sort((a,b)=>String(b.YMD_HM).localeCompare(String(a.YMD_HM)));const unique=[...new Map(group.map(r=>[String(r.YMD_HM),r])).values()].slice(0,2);groups.set(code,unique);}
 return [...groups.values()].flat();
}
export function buildHazards(data:Situation|null,scope:HazardScope,now=Date.now()):HazardSummary[]{
 const match=(city:string)=>CITIES.includes(city)&&(scope==='regional'||city==='의정부시');
 const area=scope==='local'?'의정부시':'경기도';
 const feed=(id:string)=>data?.feeds.find(f=>f.id===id);
 const water=feed('water'),fire=feed('fire'),landslide=feed('landslide'),prediction=feed('prediction');
 const waterRecords:HazardRecord[]=[];
 for(const station of WATER_STATIONS.filter(s=>match(s.city))){
  const rows=(water?.rows??[]).filter(r=>field(r,'WALE_OBSVTR_CD')===station.code).sort((a,b)=>String(b.YMD_HM).localeCompare(String(a.YMD_HM)));
  const row=rows[0],at=row?feedTimestamp('water',row):null;
  if(!row||!at)continue;
  const value=field(row,'WALE_DATA');if(!value||!Number.isFinite(Number(value))||Number(value)<=-999)continue;
  // Source hydrologic DB defines WL (time-stamped gauge data with quality grade) in cm.
  // https://www.codil.or.kr/filebank/original/RK/OTKCRK081116/OTKCRK081116.pdf?stream=T
  // Preserve the numeric value; do not relabel it as metres or water depth.
  const prev=rows[1],delta=prev?Number(value)-Number(prev.WALE_DATA):null;
  const change=delta!==null&&Number.isFinite(delta)?`${delta>0?'+':''}${Number(delta.toFixed(2))}cm`:null;
  const trend=change?` · 직전 관측 대비 ${change}`:'';
  waterRecords.push({id:station.code,city:station.city,title:`${station.city} ${station.name}`,text:`${station.river} · 수위 ${value}cm${trend}`,at,historical:!fresh(at,120,now),kind:'관측',measurement:{value,unit:'cm',change}});
 }
 const wCurrent=latest(waterRecords.filter(r=>!r.historical)),wOld=latest(waterRecords.filter(r=>r.historical));
 const fireRecords:HazardRecord[]=[];
 for(const row of fire?.rows??[]){const at=feedTimestamp('fire',row),addr=feedRegion('fire',row);if(!at||Date.parse(at)>now||kstDay(Date.parse(at))!==kstDay(now))continue;
  const cities=regionCities(addr).filter(match);if(!cities.length)continue;
  const done=field(row,'EXTNGS_CMPTN_DT','EXTNGS_END_DT'),id=field(row,'FRSTFR_INFO_ID')||`${at}:${addr}`;
  fireRecords.push({id,city:cities[0],title:addr,text:done?`진화완료 · ${done}`:'산불 발생정보 · 진화완료 시각 미제공',at,kind:'발생'});
 }
 const fRecords=latest([...new Map(fireRecords.map(r=>[r.id,r])).values()]);
 const fComplete=!!fire?.complete&&fresh(fire.savedAt,90,now)&&!fire.error;
 const allLandslide:HazardRecord[]=[];
 for(const id of ['landslide','prediction'])for(const row of feed(id)?.rows??[]){const at=feedTimestamp(id,row);if(!at||Date.parse(at)>now)continue;
  const cities=regionCities(feedRegion(id,row)).filter(match);if(!cities.length)continue;
  const isPrediction=id==='prediction',age=isPrediction?120:1440;
  const state=isPrediction?`공식 예측 ${field(row,'LNLD_FRCST_NM')}`:`${field(row,'FRCST_APNT_KND_CD_NM')} ${field(row,'FRCST_APNT_STTS')}`;
  for(const city of cities)allLandslide.push({id:`${id}:${city}:${at}`,city,title:city,text:state,at,historical:!fresh(at,age,now)||kstDay(Date.parse(at))!==kstDay(now),kind:isPrediction?'예측':'발령'});
 }
 const newestByCity=new Map<string,HazardRecord>();for(const r of latest(allLandslide)){const key=`${r.kind}:${r.city}`;if(!newestByCity.has(key))newestByCity.set(key,r);}
 const lRecords=latest([...newestByCity.values()]),lCurrent=lRecords.filter(r=>!r.historical);
 const w=data?.warnings,wValid=!!w?.verified&&fresh(w.collectedAt,90,now)&&!w.error;
 const tRecords:HazardRecord[]=[];
 if(wValid)for(const city of w!.cities.filter(c=>match(c.name)))for(const [kind,entries] of [['발효',city.active],['예비',city.preliminary]] as const)for(const entry of entries.filter(e=>e.kind==='태풍'))tRecords.push({id:`${city.name}:${kind}:${entry.level}`,city:city.name,title:city.name,text:`태풍 ${entry.level||'예비특보'} · ${entry.areas.join(', ')}${entry.timing?` · ${entry.timing}`:''}`,at:entry.timing&&Number.isFinite(Date.parse(entry.timing))?entry.timing:w!.effectiveAt||w!.collectedAt,kind});
 const tCities=new Set(tRecords.map(r=>r.city));
 const waterSummary:HazardSummary={id:'water',title:titles.water,value:wCurrent.length?(scope==='local'?`${wCurrent[0].measurement!.value}cm`:`${wCurrent.length}개 관측소`):wOld.length?'최근 관측 기록':'관측값 없음',detail:scope==='local'?(wCurrent[0]?.title.replace('의정부시 ','')??'의정부시 관측소'):`${new Set(wCurrent.map(r=>r.city)).size}개 시군 관측`,note:wCurrent.length?('관측소 기준 수위 · cm'):wOld[0]?.text??`${area} 수위 관측값 미확보`,at:wCurrent[0]?.at??wOld[0]?.at??null,records:[...wCurrent,...wOld],empty:`${area}의 확인된 수위 관측값이 없습니다.`,coverage:scope==='regional'?`경기도 31개 시군 대상 · 소재지가 확인된 관측소 ${WATER_STATIONS.length}곳 기준`:undefined};
 return [waterSummary,{id:'fire',title:titles.fire,value:fComplete||fRecords.length?`오늘 ${fRecords.length}건`:'오늘 기록 없음',detail:`${area} 발생정보`,note:fRecords[0]?.title??(fComplete?'오늘 조회된 발생정보 0건':'오늘 발생정보 집계 미확정'),at:fire?.savedAt??null,records:fRecords,empty:fComplete?`오늘 조회된 ${area} 산불 발생정보는 0건입니다.`:`오늘 ${area} 산불 발생정보 집계가 확정되지 않았습니다.`},
 {id:'landslide',title:titles.landslide,value:lCurrent.length?`${new Set(lCurrent.map(r=>r.city)).size}개 지역 기록`:'오늘 기준 기록 없음',detail:`${area} 발령·공식 예측`,note:lCurrent[0]?.text??'오늘 공식 발령·예측 기록 없음',at:lCurrent[0]?.at??[prediction?.savedAt,landslide?.savedAt].filter((v):v is string=>!!v).sort().at(-1)??null,records:lRecords,empty:`오늘 조회된 ${area} 산사태 발령·예측 기록이 없습니다.`},
 {id:'typhoon',title:titles.typhoon,value:wValid?(tRecords.length?scope==='local'?tRecords.map(r=>r.kind==='예비'?'예비특보':r.text.split(' · ')[0].replace('태풍 ','')).join(' · '):`${tCities.size}개 시군`:'특보 없음'):'특보 미확인',detail:`${area} 태풍특보`,note:tRecords.length?tRecords.map(r=>r.city).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):wValid?'발효·예비 태풍특보 없음':'최근 공식 특보 기준시각 미확정',at:w?.collectedAt??null,records:tRecords,empty:wValid?`${area}에 발효·예비 태풍특보가 없습니다.`:`${area} 태풍특보 현황이 확정되지 않았습니다.`}];
}

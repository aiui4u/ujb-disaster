import {dateValue,field,fresh,kstDay,targetCities,type Feed} from './model';
const TIME_FIELDS:Record<string,string[]>={water:['YMD_HM'],rain:['YMD_HUR'],fire:['FRSTFR_GNT_DT'],landslide:['FRCST_APNT_DT'],prediction:['PREDC_ANLS_DT'],pop:['DT_TM_FC'],rain6:['PRSNTN_TM']};
export function feedTimestamp(id:string,row:Record<string,unknown>){
 const raw=field(row,...(TIME_FIELDS[id]??[]));
 const compact=raw.replace(/\D/g,'');
 if(/^\d{10}$/.test(raw))return dateValue(compact+'0000');
 if(/^\d{12}$/.test(raw))return dateValue(compact+'00');
 const parts=raw.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
 if(parts)return dateValue(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]??'00'}+09:00`);
 return dateValue(raw);
}
export function feedHealth(feed:Feed|undefined,now=Date.now()){
 if(!feed)return {latestAt:null,currentRows:[],state:'연결 확인 중'};
 const dated=(feed.rows??[]).map(row=>({row,at:feedTimestamp(feed.id,row)})).filter(x=>x.at&&Date.parse(x.at)<=now+300000).sort((a,b)=>b.at!.localeCompare(a.at!));
 const latestAt=dated[0]?.at??null;
 const age=feed.id==='pop'||feed.id==='rain6'?720:feed.id==='fire'||feed.id==='landslide'?1440:120;
 const currentRows=dated.filter(x=>fresh(x.at,age,now)).map(x=>x.row);
 const state=feed.error?'수신 지연':!feed.savedAt?feed.state:!feed.rows?.length?'조회자료 없음':!latestAt?'자료시각 확인 중':!currentRows.length?'최신자료 미수신':feed.complete?'자료 수신':'일부 자료 수신';
 return {latestAt,currentRows,state};
}
export function feedRegion(id:string,row:Record<string,unknown>){
 return id==='fire'?field(row,'FRSTFR_DCLR_ADDR','FRSTFR_GNT_PLC'):id==='landslide'?field(row,'OCRN_FRCST_APNT_INST_NM'):id==='prediction'?field(row,'SGG_NM'):'';
}
export function feedRecords(feed:Feed){
 return (feed.rows??[]).map(row=>{
  const at=feedTimestamp(feed.id,row);
  const region=feedRegion(feed.id,row);
  const title=region||(feed.id==='water'?`관측소 ${field(row,'WALE_OBSVTR_CD')}`:feed.id==='rain'?`관측소 ${field(row,'THEX_OBSVTR_CD')}`:`격자 ${field(row,'COORD_X','XCRD_LTC')}, ${field(row,'COORD_Y','YCRD_LTC')}`);
  const detail=feed.id==='water'?`수위 ${field(row,'WALE_DATA')}cm`:feed.id==='rain'?`우량 원자료 ${field(row,'THEX_DATA')}`:feed.id==='fire'?`산불 발생 · ${field(row,'EXTNGS_CMPTN_DT')?'진화완료 '+field(row,'EXTNGS_CMPTN_DT'):'진화완료 시각 미수신'}`:feed.id==='landslide'?`${field(row,'FRCST_APNT_KND_CD_NM')} · ${field(row,'FRCST_APNT_STTS')}`:feed.id==='prediction'?field(row,'LNLD_FRCST_NM'):feed.id==='pop'?Object.entries(row).filter(([k])=>/^TIME\d+$/.test(k)).sort((a,b)=>Number(a[0].slice(4))-Number(b[0].slice(4))).slice(0,8).map(([k,v])=>`${k}: ${v}%`).join(' · '):Object.entries(row).filter(([k])=>/^RN_\d+$/.test(k)).sort((a,b)=>Number(a[0].slice(3))-Number(b[0].slice(3))).map(([k,v])=>`${k}: ${v}`).join(' · ');
  return {at,title,detail};
 }).sort((a,b)=>(b.at??'').localeCompare(a.at??'')).slice(0,20);
}

export function fireReports(feed:Feed|undefined,city?:string,now=Date.now()){
 return (feed?.rows??[]).filter(row=>{
  const at=feedTimestamp('fire',row),cities=targetCities(feedRegion('fire',row));
  return at&&kstDay(Date.parse(at))===kstDay(now)&&Date.parse(at)<=now&&!!cities.length&&(!city||cities.includes(city));
 });
}
export function publicRows(id:string,rows:Record<string,unknown>[]){
 if(id!=='fire')return rows;
 const allowed=['FRSTFR_INFO_ID','FRSTFR_GNT_DT','FRSTFR_DCLR_ADDR','FRSTFR_GNT_PLC','EXTNGS_CMPTN_DT','EXTNGS_END_DT','FTRXTNGSH_SRNC_END_DT','STDG_CTPV_CD','STDG_SGG_CD'];
 return rows.map(row=>Object.fromEntries(allowed.filter(k=>k in row).map(k=>[k,row[k]])));
}

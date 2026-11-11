export const CITIES=['수원시','성남시','의정부시','안양시','부천시','광명시','평택시','동두천시','안산시','고양시','과천시','구리시','남양주시','오산시','시흥시','군포시','의왕시','하남시','용인시','파주시','이천시','안성시','김포시','화성시','광주시','양주시','포천시','여주시','연천군','가평군','양평군'];
export const FEEDS=[
 {id:'messages',name:'긴급재난문자',path:'DSSP-IF-00247',key:'SAFETYDATA_MESSAGES_KEY'},
 {id:'water',name:'하천수위 · 10분 자료',path:'DSSP-IF-00007',key:'SAFETYDATA_WATER_KEY'},
 {id:'rain',name:'우량 · 시간 자료',path:'DSSP-IF-00005',key:'SAFETYDATA_RAIN_KEY'},
 {id:'fire',name:'산불 발생정보',path:'DSSP-IF-10346',key:'SAFETYDATA_FIRE_KEY'},
 {id:'landslide',name:'산사태 공식 발령',path:'DSSP-IF-00734',key:'SAFETYDATA_LANDSLIDE_KEY'},
 {id:'prediction',name:'산사태 공식 예측',path:'DSSP-IF-00735',key:'SAFETYDATA_PREDICTION_KEY'},
 {id:'pop',name:'강수확률 예보',path:'DSSP-IF-00029',key:'SAFETYDATA_POP_KEY'},
 {id:'rain6',name:'6시간 강수량 예보',path:'DSSP-IF-00031',key:'SAFETYDATA_RAIN6_KEY'},
] as const;
export type Message={id:string;at:string;area:string;text:string;kind:string;level:string;cities:string[]};
export type Feed={id:string;name:string;state:string;savedAt:string|null;error:string|null;rows:Record<string,unknown>[];messages?:Message[];complete?:boolean;total?:number;calls?:number;nextDue?:number;fields?:string[];receivedCount?:number};
export type Warning={kind:string;level:string;areas:string[];timing:string};
export type WarningSnapshot={verified:boolean;collectedAt:string;issuedAt:string;effectiveAt:string;error?:string;cities:{name:string;active:Warning[];preliminary:Warning[]}[];rawCurrent:string;rawPreliminary:string};
export type Weather=import('./weather-data').WeatherData;
export type Situation={at:string;feeds:Feed[];warnings:WarningSnapshot|null;weather:Weather|null;sharedError:string|null};
export const kstDay=(at:Date|number=Date.now())=>new Date(Number(at)+9*3600000).toISOString().slice(0,10);
export function dateValue(v:unknown){const s=String(v??'').trim();if(!s)return null;let t=s;if(/^\d{14}$/.test(s))t=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12)}+09:00`;else if(/^\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}/.test(s))t=s.replace(/[/.]/g,'-').replace(' ','T')+(/[zZ]$|[+-]\d\d:\d\d$/.test(s)?'':'+09:00');return Number.isFinite(Date.parse(t))?new Date(t).toISOString():null;}
export function field(row:Record<string,unknown>,...keys:string[]){for(const key of keys){const value=row[key];if(value!==null&&value!==undefined&&String(value).trim())return String(value);}return '';}
export function targetCities(area:string){if(/전국|경기도\s*(전체|전역)/.test(area)||area.trim()==='경기도')return [...CITIES];return CITIES.filter(c=>area.includes(c)&&!(c==='광주시'&&!area.includes('경기도 광주시')&&/광주광역시/.test(area)));}
export function parseMessages(rows:Record<string,unknown>[]){return rows.map(row=>{const text=field(row,'MSG_CN','msg_cn','msgCn','MESSAGE','msg');const area=field(row,'RCPTN_RGN_NM','rcptn_rgn_nm','rcptnRgnNm','LOCATION_NAME');const at=dateValue(field(row,'CRT_DT','crt_dt','crtDt','CREATE_DATE'));if(!text||!area||!at)return null;return {id:field(row,'SN','sn','MD101_SN')||`${at}:${area}:${text}`,at,area,text,kind:field(row,'DST_SE_NM','dst_se_nm','dstSeNm'),level:field(row,'EMRG_STEP_NM','emrg_step_nm','emrgStepNm'),cities:targetCities(area)} as Message;}).filter((x):x is Message=>x!==null);}
export function decodeResponse(json:any){const root=json.response??json;const head=root.header??{};const code=head.resultCode??head.result_code;if(code!==undefined&&!['00','0','200','INFO-000','NORMAL_SERVICE'].includes(String(code)))throw Error(`제공기관 응답 ${String(code).slice(0,24)}`);if(root.error)throw Error('제공기관 오류 응답');const body=root.body??root;const candidate=Array.isArray(body)?body:body.items?.item??body.items??body.data??body.list??body.rows??root.data;const rows=Array.isArray(candidate)?candidate:candidate&&typeof candidate==='object'?[candidate]:[];if(!candidate&&Number(body.totalCount??root.totalCount)!==0)throw Error('제공자료 형식 확인 필요');return {rows:rows as Record<string,unknown>[],total:Number(body.totalCount??root.totalCount??rows.length)};}
export function fresh(at:string|null|undefined,minutes:number,now=Date.now()){const n=Date.parse(at??'');return Number.isFinite(n)&&n<=now+300000&&now-n<minutes*60000;}

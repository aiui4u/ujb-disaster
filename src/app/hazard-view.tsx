'use client';
import type {HazardSummary} from '@/lib/hazards';
export function hazardDate(at:string|null){return at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at)):'기준시각 없음';}
export function HazardSection({hazard,compact=false,onOpen}:{hazard:HazardSummary;compact?:boolean;onOpen?:()=>void}){
 const current=hazard.records.filter(r=>!r.historical),history=hazard.records.filter(r=>r.historical),shown=compact?current.slice(0,2):current;
 return <section className={`hazard-section${compact?'':' hazard-expanded'}`} aria-label={`${hazard.title} 지역별 현황`}>
  <div className="hazard-section-head"><h4>{hazard.title}</h4>{compact&&<span>{hazard.value}</span>}{onOpen&&<button onClick={onOpen}>상세보기</button>}</div>
  {!compact&&<div className="hazard-key-value"><strong>{hazard.value}</strong></div>}
  {hazard.coverage&&<p className="hazard-coverage">{hazard.coverage}</p>}
  {shown.length?shown.map(r=><article className="hazard-record" key={r.id}><div><b>{r.title}</b>{r.kind&&<span>{r.kind}</span>}</div><p>{r.text}</p>{!compact&&r.measurement&&hazard.records.length>1&&<div className="water-level-number"><strong>{r.measurement.value}</strong><span>{r.measurement.unit}</span></div>}<time>{hazardDate(r.at)}</time></article>):<p className="hazard-empty">{history.length?'오늘 기준 기록 없음':hazard.empty}</p>}
  {compact&&current.length>shown.length&&<button className="hazard-more" onClick={onOpen}>외 {current.length-shown.length}건 전체보기</button>}
  {!!history.length&&<details className="hazard-history"><summary>최근 기록 · {history.length}개 지역·관측소</summary>{(compact?history.slice(0,2):history).map(r=><article className="hazard-record" key={r.id}><div><b>{r.title}</b><span>과거 이력</span></div><p>{r.text}</p><time>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(r.at!))}</time></article>)}{compact&&history.length>2&&<button className="hazard-more" onClick={onOpen}>전체 이력 보기</button>}</details>}
 </section>;
}

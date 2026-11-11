import {fresh,kstDay,type Situation} from './model';
import {synthesiseSituation} from './situation-summary';
export function messagesToday(data:Situation|null,now=Date.now()){return (data?.feeds.find(f=>f.id==='messages')?.messages??[]).filter(m=>m.cities.length&&kstDay(Date.parse(m.at))===kstDay(now)).sort((a,b)=>b.at.localeCompare(a.at));}
export function analyse(data:Situation|null,now=Date.now()){
 const w=data?.warnings;
 const valid=!!w?.verified&&fresh(w.collectedAt,90,now)&&!w.error;
 const local=valid?w?.cities.find(c=>c.name==='의정부시'):null;
 const region=valid?w?.cities.filter(c=>c.active.length)??[]:[];
 const messages=messagesToday(data,now),localMessages=messages.filter(m=>m.cities.includes('의정부시'));
 return {...synthesiseSituation(data,messages,now),valid,local,region,messages,localMessages};
}

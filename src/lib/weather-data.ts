import type {WarningSnapshot} from './model';
import type {AirForecast,HighForecast,AirRow} from './weather-air';
export type Values = Record<string, string>;
export type Hour = {at:string; values:Values; source:string};
export type Source = {ok:boolean; message:string; base:string|null};
export type WeatherData = {fetchedAt:string; warnings?:WarningSnapshot; storage?:{savedAt:string;failedSources:string[]}; collection?:{pending:boolean;lastStarted:string|null;lastFinished:string|null;message:string|null}; grid:{nx:number;ny:number;name:string}; current:Values; observedAt:string|null; hours:Hour[]; daily:{date:string;min:number|null;max:number|null;pop:number|null}[]; sources:{current:Source;ultra:Source;forecast:Source;air:Source;airForecast?:Source;high?:Source}; air:Record<string,string>|null; airHistory?:AirRow[]; airForecasts?:AirForecast[]; highForecasts?:HighForecast[]; airStation?:{name:string;address:string;area:string;requestedName?:string;fallbackReason?:string}; analysis?:{generatedAt:string;summary:string;coverage:{label:string;state:'used'|'partial'|'excluded';time:string|null;detail:string}[]}; notices:{title:string;body:string;level:string;action?:string;evidence?:string;priority?:number}[]};

export function number(v:unknown):number|null{if(v===undefined||v===null||v===''||v==='-'||!Number.isFinite(Number(v)))return null;return Number(v);}
export function condition(v:Values){const p=number(v.PTY);if(p!==null&&p!==0)return ({1:'비',2:'비·눈',3:'눈',4:'소나기',5:'빗방울',6:'빗방울·눈날림',7:'눈날림'} as Record<number,string>)[p]??'강수';return ({1:'맑음',3:'구름 많음',4:'흐림'} as Record<number,string>)[Number(v.SKY)]??'하늘상태 확인 중';}

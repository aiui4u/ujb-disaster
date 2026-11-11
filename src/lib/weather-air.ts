import {number,type WeatherData} from './weather-data';
export type AirRow=Record<string,string>;
export type AirForecast={date:string;issuedAt:string;code:string;grade:string;region:string;overall:string;cause:string;action:string};
export type HighForecast={date:string;issuedAt:string;region:string;over50:boolean|null;grade:string;cause:string};
export function airTimestamp(value:string|undefined){if(!value)return null;const date=Date.parse(value.replace(' ','T')+'+09:00');return Number.isFinite(date)?date:null;}
export function issuedTimestamp(value:string){const m=value.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2})(?::(\d{2}))?/);return m?Date.parse(`${m[1]}T${m[2].padStart(2,'0')}:${m[3]??'00'}:00+09:00`):0;}
export function metricValue(row:AirRow|null|undefined,code:string){if(!row||row[code+'Flag'])return null;return number(row[code+'Value']);}
export function airGrade(row:AirRow|null|undefined,code:string){if(metricValue(row,code)===null)return null;const value=row?.[code+(code==='pm10'||code==='pm25'?'Grade1h':'Grade')];return ['1','2','3','4'].includes(String(value))?Number(value):null;}
export const gradeLabel=(grade:unknown)=>({'1':'좋음','2':'보통','3':'나쁨','4':'매우 나쁨'} as Record<string,string>)[String(grade)]??'자료 없음';

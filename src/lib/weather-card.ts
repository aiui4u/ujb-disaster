import type {WeatherData} from './weather-data';

export function weatherCard(weather:WeatherData|null|undefined,now:number){
 const raw=weather?.current?.T1H;
 const temperature=raw!==undefined&&raw!==null&&String(raw).trim()!==''&&Number.isFinite(Number(raw))?Number(raw):null;
 const observed=Date.parse(weather?.observedAt??'');
 const current=Number.isFinite(observed)&&observed<=now+300000&&now-observed<120*60000&&weather?.sources?.current?.ok!==false;
 const available=temperature!==null;
 return {
  value:available?`${temperature}°C`:'관측 수신 대기',
  detail:available?`${current?'':'마지막 관측 · '}시간강수 ${weather?.current?.RN1??'—'}mm · 바람 ${weather?.current?.WSD??'—'}m/s`:'의정부시청 대표 날씨 수신 대기',
  delayed:available&&!current,
  at:weather?.observedAt??null,
 };
}

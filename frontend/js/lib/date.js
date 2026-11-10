// Time and calendar rules are isolated from rendering and persistence.
import { MARKET_DATA_READY_MINUTES, TAIPEI_TIME_ZONE } from './constants.js';

export function taipeiClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}
export const today = () => taipeiClock().date;
export function shiftDate(date, days) { const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10); }
export function isWeekday(date) { const day=new Date(`${date}T00:00:00Z`).getUTCDay();return day!==0&&day!==6; }
export function previousWeekday(date) { let value=shiftDate(date,-1);while(!isWeekday(value))value=shiftDate(value,-1);return value; }
export function marketTargetDate(now = new Date(), tradingDates = []) {
  const clock=taipeiClock(now), afterReady=clock.hour*60+clock.minute>=MARKET_DATA_READY_MINUTES;
  const candidate=isWeekday(clock.date)&&afterReady?clock.date:shiftDate(clock.date,-1);
  const calendarTarget=(tradingDates||[]).filter(date=>date<=candidate).sort().at(-1);
  return calendarTarget||(!isWeekday(candidate)?previousWeekday(clock.date):candidate);
}
export function isWaitingForTodayClose(now = new Date()) { const clock=taipeiClock(now);return isWeekday(clock.date)&&clock.hour*60+clock.minute<MARKET_DATA_READY_MINUTES; }
export const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

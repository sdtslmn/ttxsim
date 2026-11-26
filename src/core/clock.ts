import type { Scenario } from "./types.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall clock inside the story, e.g. "Tue 09:42" or "Day 2 07:15". */
export function clockLabel(s: Scenario, minute: number): string {
  const abs = s.startMinute + minute;
  const day = Math.floor(abs / 1440);
  const hm = `${pad(Math.floor((abs % 1440) / 60))}:${pad(abs % 60)}`;
  if (s.startWeekday !== undefined) return `${DAYS[(s.startWeekday + day) % 7]} ${hm}`;
  const multiDay = s.startMinute + s.limit > 1440;
  return multiDay ? `Day ${day + 1} ${hm}` : hm;
}

/** Time since the exercise started, e.g. "T+1:05" or "T+1d 2:10". */
export function elapsedLabel(minute: number): string {
  const d = Math.floor(minute / 1440);
  const h = Math.floor((minute % 1440) / 60);
  const m = minute % 60;
  return d ? `T+${d}d ${h}:${pad(m)}` : `T+${h}:${pad(m)}`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d} d` : "", h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}


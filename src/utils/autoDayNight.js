import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

// Open-Meteo 官方接口：北京（天安门）日出日落，Asia/Shanghai 时区。
// 接口返回每日数组，第 0 项即今天。
const SUN_API_URL = 'https://api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074&daily=sunrise,sunset&timezone=Asia/Shanghai';

const SHANGHAI_UTC_OFFSET_MS = 8 * 3600 * 1000;
const SUN_CACHE_KEY = 'marchcenter_sun_times';
const RETRY_AFTER_MS = 30 * 60 * 1000;
const MAX_RECHECK_MS = 60 * 60 * 1000;

// Asia/Shanghai 本地日期（YYYY-MM-DD），与接口 daily.time 口径一致，
// 不依赖浏览器时区。
const shanghaiDateKey = (now = Date.now()) => (
  new Date(now + SHANGHAI_UTC_OFFSET_MS).toISOString().slice(0, 10)
);

// 接口的日出/日落是 Asia/Shanghai 本地时间字符串（"YYYY-MM-DDTHH:MM"），
// 转成绝对时间戳，不依赖浏览器时区。
const parseShanghaiTime = (value) => (
  Date.parse(`${value}:00Z`) - SHANGHAI_UTC_OFFSET_MS
);

export async function fetchSunTimes() {
  const response = await apiFetch(SUN_API_URL, { timeoutMs: 8000, retry: 0 });
  if (!response.ok) throw new Error(`Open-Meteo 请求失败 (${response.status})`);
  const data = await response.json();
  const day = data?.daily;
  const date = day?.time?.[0];
  const sunrise = day?.sunrise?.[0];
  const sunset = day?.sunset?.[0];
  if (!date || !sunrise || !sunset) throw new Error('Open-Meteo 响应缺少日出日落');
  return { date, sunrise: parseShanghaiTime(sunrise), sunset: parseShanghaiTime(sunset) };
}

export const isDaytime = (sunTimes, now = Date.now()) => (
  Boolean(sunTimes) && now >= sunTimes.sunrise && now < sunTimes.sunset
);

const readCachedSunTimes = () => {
  try {
    const raw = localStorage.getItem(SUN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed.date === 'string'
      && Number.isFinite(parsed.sunrise)
      && Number.isFinite(parsed.sunset)
    ) {
      return parsed;
    }
  } catch { /* 缓存损坏则忽略 */ }
  return null;
};

/**
 * 根据 lightDark 返回生效的日/夜模式：'auto' 时按北京日出日落计算，
 * 其余直接透传。日出/日落数据按天缓存；到达下一个边界时自动重算，
 * 回到前台立即重算，请求失败 30 分钟后重试。
 */
export function useAutoLightDark(lightDark) {
  const [sunTimes, setSunTimes] = useState(readCachedSunTimes);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (lightDark !== 'auto') return undefined;
    if (sunTimes && sunTimes.date === shanghaiDateKey()) return undefined;
    let cancelled = false;
    let retryTimer = null;
    fetchSunTimes()
      .then((fetched) => {
        if (cancelled) return;
        setSunTimes(fetched);
        try { localStorage.setItem(SUN_CACHE_KEY, JSON.stringify(fetched)); } catch { /* 忽略 */ }
      })
      .catch(() => {
        if (cancelled) return;
        retryTimer = window.setTimeout(() => setRetryTick((tick) => tick + 1), RETRY_AFTER_MS);
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [lightDark, sunTimes, retryTick]);

  useEffect(() => {
    if (lightDark !== 'auto' || !sunTimes) return undefined;
    const now = Date.now();
    const boundaries = [sunTimes.sunrise, sunTimes.sunset].filter((time) => time > now);
    const nextBoundary = boundaries.length
      ? Math.min(...boundaries)
      : sunTimes.sunrise + 86400000;
    const delay = Math.min(Math.max(nextBoundary - now, 1000), MAX_RECHECK_MS);
    const timer = setTimeout(
      () => setSunTimes((prev) => (prev ? { ...prev } : prev)),
      delay
    );
    const recheck = () => setSunTimes((prev) => (prev ? { ...prev } : prev));
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [lightDark, sunTimes]);

  if (lightDark !== 'auto') return lightDark;
  if (!sunTimes || sunTimes.date !== shanghaiDateKey()) return 'light';
  return isDaytime(sunTimes) ? 'light' : 'dark';
}

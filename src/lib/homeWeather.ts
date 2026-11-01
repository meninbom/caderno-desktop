import { HOME_WEATHER_KEY, parseCityResults, parseWeatherResponse, parseWeatherSettings, type HomeWeatherSettings, type WeatherCity } from '../../shared/home-weather';

export function loadHomeWeather(): HomeWeatherSettings {
  try { return parseWeatherSettings(JSON.parse(localStorage.getItem(HOME_WEATHER_KEY) ?? 'null')); }
  catch { return { version: 1, city: null, reading: null }; }
}
export function saveHomeWeather(settings: HomeWeatherSettings): boolean {
  try { localStorage.setItem(HOME_WEATHER_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}
async function request(url: URL, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = window.setTimeout(abort, 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 429 ? 'Limite temporário do serviço. Tente novamente mais tarde.' : 'O serviço de clima está indisponível.');
    return await response.json();
  } finally { window.clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export async function searchWeatherCities(query: string, signal: AbortSignal) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query.trim().slice(0, 80), count: '6', language: 'pt', format: 'json' }).toString();
  return parseCityResults(await request(url, signal));
}
export async function fetchCityWeather(city: WeatherCity, signal: AbortSignal) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude), current: 'temperature_2m,weather_code,is_day', daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '1', timeformat: 'unixtime' }).toString();
  return parseWeatherResponse(await request(url, signal), city.id);
}

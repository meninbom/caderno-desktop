/** Contrato mínimo do widget de clima. Sem dependências e sem conteúdo das notas. */
export const HOME_WEATHER_KEY = 'caderno.home.weather.v1';
export const WEATHER_FRESH_MS = 15 * 60_000;
export interface WeatherCity { id: number; name: string; region: string; country: string; latitude: number; longitude: number }
export interface WeatherReading { cityId: number; temperature: number; low: number | null; high: number | null; code: number; isDay: boolean; observedAt: number; fetchedAt: number }
export interface HomeWeatherSettings { version: 1; city: WeatherCity | null; reading: WeatherReading | null }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const temp = (value: unknown) => finite(value, -100, 70) ? value : null;

export function parseWeatherCity(value: unknown): WeatherCity | null {
  const city = object(value);
  if (!Number.isSafeInteger(city.id) || !finite(city.id, 1, Number.MAX_SAFE_INTEGER) || !text(city.name) || !finite(city.latitude, -90, 90) || !finite(city.longitude, -180, 180)) return null;
  return { id: city.id, name: text(city.name), region: text(city.region ?? city.admin1), country: text(city.country), latitude: city.latitude, longitude: city.longitude };
}
export const weatherCityLabel = (city: WeatherCity) => [city.name, city.region, city.country].filter(Boolean).join(', ');

export function parseCityResults(value: unknown): WeatherCity[] {
  const results = object(value).results;
  if (!Array.isArray(results)) return [];
  const seen = new Set<number>();
  return results.slice(0, 8).flatMap(value => {
    const feature = object(value).feature_code;
    if (typeof feature === 'string' && !feature.startsWith('PPL')) return [];
    const city = parseWeatherCity(value);
    if (!city || seen.has(city.id)) return [];
    seen.add(city.id); return [city];
  });
}

export function parseWeatherResponse(value: unknown, cityId: number, now = Date.now()): WeatherReading {
  const response = object(value), current = object(response.current), daily = object(response.daily);
  if (temp(current.temperature_2m) === null || !finite(current.weather_code, 0, 99) || !Number.isInteger(current.weather_code) || !finite(current.time, 1, Number.MAX_SAFE_INTEGER / 1000) || (current.is_day !== 0 && current.is_day !== 1)) throw new Error('O serviço retornou uma leitura de clima inválida.');
  const first = (value: unknown) => Array.isArray(value) ? temp(value[0]) : null;
  const low = first(daily.temperature_2m_min), high = first(daily.temperature_2m_max);
  return { cityId, temperature: current.temperature_2m as number, low, high: low !== null && high !== null && high < low ? null : high, code: current.weather_code, isDay: current.is_day === 1, observedAt: current.time * 1000, fetchedAt: now };
}

export function parseWeatherSettings(value: unknown): HomeWeatherSettings {
  const raw = object(value), city = raw.version === 1 ? parseWeatherCity(raw.city) : null;
  const reading = object(raw.reading);
  const valid = city && reading.cityId === city.id && temp(reading.temperature) !== null && finite(reading.code, 0, 99) && Number.isInteger(reading.code) && typeof reading.isDay === 'boolean' && finite(reading.observedAt, 1, Date.now() + 86400000) && finite(reading.fetchedAt, 1, Date.now() + 5 * 60_000);
  return { version: 1, city, reading: valid ? { cityId: city.id, temperature: reading.temperature as number, code: reading.code as number, isDay: reading.isDay as boolean, low: temp(reading.low), high: temp(reading.high), observedAt: reading.observedAt as number, fetchedAt: reading.fetchedAt as number } : null };
}

export function weatherCondition(code: number, isDay: boolean): { label: string; icon: 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { label: isDay ? 'Céu limpo' : 'Noite limpa', icon: isDay ? 'sun' : 'moon' };
  if (code === 1 || code === 2) return { label: code === 1 ? 'Poucas nuvens' : 'Parcialmente nublado', icon: isDay ? 'cloud-sun' : 'cloud-moon' };
  if (code === 3) return { label: 'Nublado', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Nevoeiro', icon: 'fog' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Garoa', icon: 'rain' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Chuva', icon: 'rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Neve', icon: 'snow' };
  if ([95, 96, 99].includes(code)) return { label: 'Trovoadas', icon: 'storm' };
  return { label: 'Condição indisponível', icon: 'cloud' };
}

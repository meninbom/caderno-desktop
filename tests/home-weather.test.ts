import { describe, expect, it } from 'vitest';
import { parseCityResults, parseWeatherCity, parseWeatherResponse, parseWeatherSettings, weatherCityLabel, weatherCondition } from '../shared/home-weather';
const city = { id: 3459712, name: 'Joinville', admin1: 'Santa Catarina', country: 'Brasil', latitude: -26.3044, longitude: -48.8487 };
const forecast = { current: { temperature_2m: 23.4, weather_code: 3, is_day: 1, time: 1793563200 }, daily: { temperature_2m_min: [18.5], temperature_2m_max: [27.6] } };

describe('cidade configurada', () => {
  it('normaliza cidades e diferencia estado e país', () => {
    expect(weatherCityLabel(parseWeatherCity(city)!)).toBe('Joinville, Santa Catarina, Brasil');
    expect(parseWeatherCity({ ...city, name: '  Joinville  ' })?.name).toBe('Joinville');
  });
  it('rejeita coordenadas, nomes e ids inválidos', () => {
    for (const value of [null, {}, { ...city, latitude: 91 }, { ...city, longitude: NaN }, { ...city, name: '' }, { ...city, id: 1.5 }]) expect(parseWeatherCity(value)).toBeNull();
  });
  it('descarta resultados inválidos e duplicados sem criar cidades fictícias', () => {
    expect(parseCityResults({ results: [city, city, { name: 'x' }, { ...city, id: 99, feature_code: 'AIRP' }] })).toHaveLength(1);
    expect(parseCityResults({})).toEqual([]);
  });
});
describe('leitura e cache de clima', () => {
  it('usa a temperatura atual e a mínima/máxima do dia, com instante Unix', () => {
    expect(parseWeatherResponse(forecast, city.id, 1234)).toEqual({ cityId: city.id, temperature: 23.4, low: 18.5, high: 27.6, code: 3, isDay: true, observedAt: 1793563200000, fetchedAt: 1234 });
  });
  it('não interpreta nulo ou resposta incompleta como zero graus', () => {
    for (const value of [{}, { current: {} }, { ...forecast, current: { ...forecast.current, temperature_2m: null } }, { ...forecast, current: { ...forecast.current, time: '2026-11-01' } }]) expect(() => parseWeatherResponse(value, city.id)).toThrow();
  });
  it('aceita ausência de mínima e máxima sem inventar valores', () => {
    const result = parseWeatherResponse({ current: forecast.current }, city.id);
    expect(result.low).toBeNull(); expect(result.high).toBeNull();
  });
  it('cache é vinculado à cidade e não mistura a leitura de outra', () => {
    const reading = parseWeatherResponse(forecast, city.id);
    expect(parseWeatherSettings({ version: 1, city, reading }).reading).toEqual(reading);
    expect(parseWeatherSettings({ version: 1, city: { ...city, id: 9 }, reading }).reading).toBeNull();
  });
  it('versão desconhecida ou dados corrompidos voltam à configuração vazia', () => {
    for (const value of [null, 3, { version: 2, city }, { version: 1, city: {} }]) expect(parseWeatherSettings(value)).toEqual({ version: 1, city: null, reading: null });
    expect(parseWeatherSettings({ version: 1, city, reading: { temperature: 'NaN' } }).reading).toBeNull();
  });
  it('ignora cache com data de gravação futura inválida', () => {
    expect(parseWeatherSettings({ version: 1, city, reading: { ...parseWeatherResponse(forecast, city.id), fetchedAt: Date.now() + 86400000 } }).reading).toBeNull();
  });
});
describe('condições WMO', () => {
  it('diferencia dia/noite e todos os grupos documentados', () => {
    expect(weatherCondition(0, false).icon).toBe('moon');
    expect(weatherCondition(0, true).icon).toBe('sun');
    for (const [code, icon] of [[2, 'cloud-sun'], [3, 'cloud'], [45, 'fog'], [55, 'rain'], [65, 'rain'], [80, 'rain'], [71, 'snow'], [95, 'storm']] as const) expect(weatherCondition(code, true).icon).toBe(icon);
    expect(weatherCondition(4, true).label).toBe('Condição indisponível');
  });
});

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, MapPin, Moon, RotateCw, Search, Sun, X } from 'lucide-react';
import { WEATHER_FRESH_MS, weatherCityLabel, weatherCondition, type HomeWeatherSettings, type WeatherCity } from '../../shared/home-weather';
import { fetchCityWeather, loadHomeWeather, saveHomeWeather, searchWeatherCities } from '../lib/homeWeather';
import { client } from '../api/client';

const ICONS = { sun: Sun, moon: Moon, 'cloud-sun': CloudSun, 'cloud-moon': CloudMoon, cloud: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const degrees = (n: number) => `${Math.round(n)}°`;
const hour = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Rede apenas depois de escolher uma cidade. Sem geolocalização nem atualização por timer. */
export function HomeWeatherBody({ now }: { now: number }) {
  const [settings, setSettings] = useState(loadHomeWeather), [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(''), [results, setResults] = useState<WeatherCity[] | null>(null);
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [saveError, setSaveError] = useState(false);
  const current = useRef(settings), refresh = useRef<() => void>(() => {}), searchRequest = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null), opener = useRef<HTMLButtonElement>(null);
  const commit = useCallback((value: HomeWeatherSettings) => { current.current = value; setSettings(value); setSaveError(!saveHomeWeather(value)); }, []);
  const cityId = settings.city?.id;

  useEffect(() => {
    const controller = new AbortController();
    let busy = false, attemptedAt = 0;
    const load = async (force = false) => {
      const { city, reading } = current.current;
      if (!city || document.hidden || busy || controller.signal.aborted) return;
      const fresh = reading && Date.now() - reading.fetchedAt < WEATHER_FRESH_MS;
      if (!force && (fresh || Date.now() - attemptedAt < 60_000)) return;
      attemptedAt = Date.now(); busy = true; setLoading(true); setError('');
      try {
        const reading = await fetchCityWeather(city, controller.signal);
        if (!controller.signal.aborted) commit({ version: 1, city, reading });
      } catch {
        if (!controller.signal.aborted) setError('Sem atualização. Verifique sua conexão e tente novamente.');
      } finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    const resume = () => { void load(); };
    refresh.current = () => { void load(true); };
    // Não mantém o indicador da cidade anterior quando a escolha é removida.
    setLoading(false); setError('');
    resume();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); refresh.current = () => {}; window.removeEventListener('focus', resume); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [cityId, commit]);

  useEffect(() => () => { searchRequest.current?.abort(); }, []);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const close = () => { searchRequest.current?.abort(); setSearching(false); setEditing(false); window.requestAnimationFrame(() => opener.current?.focus()); };
  const choose = (city: WeatherCity | null) => {
    if (city && city.id === current.current.city?.id) { close(); if (!current.current.reading) refresh.current(); return; }
    commit({ version: 1, city, reading: null }); close();
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    setSearching(true); setResults(null); setSearchError('');
    try { const cities = await searchWeatherCities(query, controller.signal); if (!controller.signal.aborted) setResults(cities); }
    catch { if (!controller.signal.aborted) setSearchError('Não foi possível buscar cidades. Tente novamente.'); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  };
  const { city, reading } = settings;
  const condition = reading ? weatherCondition(reading.code, reading.isDay) : null, Icon = condition ? ICONS[condition.icon] : CloudSun;
  const stale = reading && now - reading.fetchedAt >= WEATHER_FRESH_MS;

  return <div className="home-weather" aria-busy={loading || searching} title={reading ? `Última leitura: ${new Date(reading.observedAt).toLocaleString('pt-BR')}` : undefined}>
    {editing ? <div className="home-weather-editor" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="home-weather-editor-title"><b>Escolher cidade</b><button type="button" className="home-weather-icon" aria-label="Cancelar escolha de cidade" onClick={close}><X size={13} /></button></div>
      <form className="home-city-search" onSubmit={event => void search(event)}>
        <input ref={input} value={query} type="search" maxLength={80} placeholder="Cidade, estado ou país" aria-label="Buscar cidade para o clima" onChange={event => { searchRequest.current?.abort(); setSearching(false); setQuery(event.target.value); setResults(null); setSearchError(''); }} />
        <button type="submit" className="home-weather-icon" aria-label="Buscar cidade" disabled={searching || query.trim().length < 2}><Search size={14} /></button>
      </form>
      <p className="home-weather-hint">Busca online. Sua localização não é acessada.</p>
      {searching && <p className="home-weather-hint" role="status">Buscando cidades…</p>}
      {searchError && <p className="home-weather-error" role="alert">{searchError}</p>}
      {results && (results.length ? <ul className="home-city-results" aria-label="Cidades encontradas">{results.map(city => <li key={city.id}><button type="button" onClick={() => choose(city)}>{weatherCityLabel(city)}</button></li>)}</ul> : <p className="home-weather-hint" role="status">Nenhuma cidade encontrada. Inclua o estado ou país.</p>)}
      {city && <button type="button" className="home-link-button" onClick={() => choose(null)}>Remover cidade</button>}
    </div> : <>
      <div className="home-weather-city-row">
        <button ref={opener} type="button" className="home-weather-city" aria-label={city ? 'Alterar cidade do clima' : 'Configurar cidade do clima'} title={city ? weatherCityLabel(city) : 'Escolher uma cidade'} onClick={() => { setQuery(city?.name ?? ''); setResults(null); setSearchError(''); setEditing(true); }}><MapPin size={12} aria-hidden="true" /><span>{city?.name ?? 'Escolher cidade'}</span></button>
        {city && <button type="button" className="home-weather-icon" aria-label="Atualizar clima" title="Atualizar clima" disabled={loading} onClick={() => refresh.current()}><RotateCw size={12} /></button>}
      </div>
      {reading && condition ? <>
        <div className="home-weather-reading"><Icon size={28} strokeWidth={1.4} aria-hidden="true" /><strong aria-label={`${Math.round(reading.temperature)} graus Celsius`}>{degrees(reading.temperature)}<small>C</small></strong><span>{condition.label}</span></div>
        {(reading.low !== null || reading.high !== null) && <p className="home-weather-range">{reading.low !== null && <span>Mín. {degrees(reading.low)}</span>}{reading.high !== null && <span>Máx. {degrees(reading.high)}</span>}</p>}
        <p className="home-weather-hint" title={`Leitura de ${new Date(reading.observedAt).toLocaleString('pt-BR')}`}>{loading ? 'Atualizando…' : `${stale ? 'Última leitura' : 'Atualizado'} às ${hour.format(reading.fetchedAt)}`}</p>
      </> : <p className="home-weather-hint" role={loading ? 'status' : undefined}>{loading ? 'Consultando clima…' : city ? 'Clima indisponível no momento.' : 'Adicione sua cidade para ver o clima.'}</p>}
      {error && <p className="home-weather-error" role="status">{error}</p>}
    </>}
    {saveError && <p className="home-weather-error" role="alert">A cidade não pôde ser salva neste computador.</p>}
    <button type="button" className="home-weather-credit" title="Dados meteorológicos do Open-Meteo" onClick={() => void client.openExternal('https://open-meteo.com/')}>Open-Meteo</button>
  </div>;
}

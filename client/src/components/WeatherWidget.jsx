import { useState, useEffect } from 'react';
import { fetchWeatherForParish } from '../api/weather';

// Jamaica time (America/Jamaica = EST, UTC-5, no DST)
function useJamaicaTime() {
  const format = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/Jamaica', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [time, setTime] = useState(format);
  useEffect(() => {
    const id = setInterval(() => setTime(format()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function WeatherWidget({ parishSlug }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const jamaicaTime = useJamaicaTime();

  useEffect(() => {
    if (!parishSlug) {
      setWeather(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchWeatherForParish(parishSlug)
      .then(setWeather)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [parishSlug]);

  if (!parishSlug) return null;
  if (loading) {
    return (
      <div className="weather-widget weather-widget-loading">
        <span className="weather-widget-label">Weather</span>
        <span className="weather-widget-value">Loading…</span>
        <div className="weather-widget-time-block">
          <span className="weather-widget-label">Jamaica time</span>
          <span className="weather-widget-time" title="Jamaica time (EST, UTC−5)">{jamaicaTime}</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="weather-widget weather-widget-error">
        <span className="weather-widget-label">Weather</span>
        <span className="weather-widget-value">Unavailable</span>
        <div className="weather-widget-time-block">
          <span className="weather-widget-label">Jamaica time</span>
          <span className="weather-widget-time" title="Jamaica time (EST, UTC−5)">{jamaicaTime}</span>
        </div>
      </div>
    );
  }
  if (!weather) return null;

  return (
    <div className="weather-widget">
      <span className="weather-widget-label">Weather</span>
      <div className="weather-widget-row">
        <span className="weather-widget-temp">{Math.round(weather.temperature)}°C</span>
        <span className="weather-widget-desc">{weather.description}</span>
      </div>
      <div className="weather-widget-meta">
        <span>Humidity {weather.humidity}%</span>
        <span>Wind {weather.windSpeed} km/h</span>
      </div>
      <div className="weather-widget-time-block">
        <span className="weather-widget-label">Jamaica time</span>
        <span className="weather-widget-time" title="Jamaica time (EST, UTC−5)">{jamaicaTime}</span>
      </div>
    </div>
  );
}

export default WeatherWidget;

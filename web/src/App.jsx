import { useState } from 'react';
import Overview from './pages/Overview.jsx';
import Map from './pages/Map.jsx';

const PAGES = {
  overview: { label: 'Overview', component: Overview },
  map: { label: 'Map', component: Map },
};

export default function App() {
  const [page, setPage] = useState('overview');
  const Page = PAGES[page].component;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Fleet Monitor</h1>
        <p>Per-service vitals, polling the metrics API every 15s.</p>
        <nav className="app-nav">
          {Object.entries(PAGES).map(([key, { label }]) => (
            <a
              key={key}
              href={`#${key}`}
              className={key === page ? 'active' : ''}
              onClick={(e) => {
                e.preventDefault();
                setPage(key);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <Page />
      </main>
    </div>
  );
}

import Overview from './pages/Overview.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Fleet Monitor</h1>
        <p>Per-service vitals, polling the metrics API every 15s.</p>
      </header>
      <main>
        <Overview />
      </main>
    </div>
  );
}

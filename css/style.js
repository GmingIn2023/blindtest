/* === DESIGN DARK GLOBAL === */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

body {
  background: linear-gradient(135deg, #0a0c0e 0%, #1a1d24 100%);
  color: #eef2f5;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1.5rem;
}

#app {
  max-width: 700px;
  width: 100%;
  background: linear-gradient(145deg, #15181c 0%, #1a1e24 100%);
  border-radius: 2.5rem;
  box-shadow: 0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05);
  padding: 2rem 1.8rem;
  position: relative;
  overflow: hidden;
}

#app::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #b2f0e4, #a0d9ff, #d4a5ff);
  opacity: 0.6;
}

h1 {
  font-size: 2.2rem;
  background: linear-gradient(145deg, #b2f0e4, #a0d9ff, #d4a5ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 1.5rem;
  text-align: center;
}

button, .btn-like {
  background: linear-gradient(135deg, #3b6eff 0%, #5584ff 100%);
  border: none;
  border-radius: 60px;
  padding: 0.85rem 1.4rem;
  color: white;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s;
  font-size: 1rem;
  width: 100%;
  margin: 0.5rem 0;
}
button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(59,110,255,0.4);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.primary {
  background: linear-gradient(135deg, #3b6eff 0%, #5584ff 100%);
}

.home-buttons {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 2rem 0;
}

/* À compléter au fur et à mesure */

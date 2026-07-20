import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import MesSeletor from './components/MesSeletor';
import DashboardCCTs from './components/DashboardCCTs';
import Configuracoes from './components/Configuracoes';
import './App.css';

function App() {
  const [mesSelecionado, setMesSelecionado] = useState(() => {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  });

  const [abaSelecionada, setAbaSelecionada] = useState('resumo');
  const [sindicatos, setSindicatos] = useState([]);
  const [ccts, setCcts] = useState([]);

  useEffect(() => {
    const sindLocal = localStorage.getItem('sindicatos');
    const cctsLocal = localStorage.getItem('ccts');
    
    if (sindLocal) setSindicatos(JSON.parse(sindLocal));
    if (cctsLocal) setCcts(JSON.parse(cctsLocal));
  }, []);

  return (
    <div className="app">
      <Header />
      <nav className="abas">
        <button className={abaSelecionada === 'resumo' ? 'aba ativa' : 'aba'} 
          onClick={() => setAbaSelecionada('resumo')}>📊 Resumo</button>
        <button className={abaSelecionada === 'config' ? 'aba ativa' : 'aba'} 
          onClick={() => setAbaSelecionada('config')}>⚙️ Configurações</button>
      </nav>
      <div className="conteudo">
        {abaSelecionada === 'resumo' && (
          <>
            <MesSeletor mesSelecionado={mesSelecionado} setMesSelecionado={setMesSelecionado} />
            <DashboardCCTs mesSelecionado={mesSelecionado} ccts={ccts} />
          </>
        )}
        {abaSelecionada === 'config' && <Configuracoes sindicatos={sindicatos} setSindicatos={setSindicatos} />}
      </div>
    </div>
  );
}

export default App;

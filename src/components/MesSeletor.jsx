import React from 'react';

export default function MesSeletor({ mesSelecionado, setMesSelecionado }) {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  const [ano, mes] = mesSelecionado.split('-');
  const mesNumero = parseInt(mes) - 1;

  const mudarMes = (delta) => {
    let novoMes = mesNumero + delta;
    let novoAno = parseInt(ano);
    
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    
    setMesSelecionado(`${novoAno}-${String(novoMes + 1).padStart(2, '0')}`);
  };

  return (
    <div className="mes-seletor">
      <button onClick={() => mudarMes(-1)}>◀ Anterior</button>
      <div className="mes-display">
        <h2>{meses[mesNumero]} {ano}</h2>
      </div>
      <button onClick={() => mudarMes(1)}>Próximo ▶</button>
    </div>
  );
}

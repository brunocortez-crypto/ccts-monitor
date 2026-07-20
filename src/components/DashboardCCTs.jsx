import React from 'react';

export default function DashboardCCTs({ mesSelecionado, ccts }) {
  const cctsDoMes = ccts.filter(cct => cct.dataBase?.startsWith(mesSelecionado));
  
  return (
    <div className="dashboard">
      <h2>CCTs do Mês</h2>
      {cctsDoMes.length === 0 ? (
        <p className="info">Nenhuma CCT neste mês</p>
      ) : (
        <div className="ccts-lista">
          {cctsDoMes.map(cct => (
            <div key={cct.id} className="card-cct">
              <h3>{cct.categoria}</h3>
              <p><strong>Sindicato:</strong> {cct.sindicatoPatronal}</p>
              <p><strong>Piso:</strong> {cct.economico?.pisoSalarial?.novo || 'N/A'}</p>
              <p><strong>Status:</strong> {cct.status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

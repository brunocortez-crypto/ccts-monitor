import React, { useState } from 'react';

export default function Configuracoes({ sindicatos, setSindicatos }) {
  const [novoSind, setNovoSind] = useState({ nome: '', cnpj: '', dataBase: '', categoria: '' });

  const adicionar = () => {
    if (novoSind.nome && novoSind.cnpj) {
      setSindicatos([...sindicatos, { id: 'sid_' + Date.now(), ...novoSind }]);
      localStorage.setItem('sindicatos', JSON.stringify([...sindicatos, { id: 'sid_' + Date.now(), ...novoSind }]));
      setNovoSind({ nome: '', cnpj: '', dataBase: '', categoria: '' });
    }
  };

  return (
    <div className="configuracoes">
      <h2>⚙️ Gerenciar Sindicatos</h2>
      <div className="form-novo">
        <input placeholder="Nome" value={novoSind.nome} onChange={e => setNovoSind({...novoSind, nome: e.target.value})} />
        <input placeholder="CNPJ" value={novoSind.cnpj} onChange={e => setNovoSind({...novoSind, cnpj: e.target.value})} />
        <input placeholder="Data-base (ex: 15/01)" value={novoSind.dataBase} onChange={e => setNovoSind({...novoSind, dataBase: e.target.value})} />
        <input placeholder="Categoria" value={novoSind.categoria} onChange={e => setNovoSind({...novoSind, categoria: e.target.value})} />
        <button onClick={adicionar}>➕ Adicionar</button>
      </div>
      <table className="tabela-sindicatos">
        <thead>
          <tr><th>Nome</th><th>CNPJ</th><th>Data-base</th><th>Categoria</th></tr>
        </thead>
        <tbody>
          {sindicatos.map(s => (
            <tr key={s.id}>
              <td>{s.nome}</td>
              <td>{s.cnpj}</td>
              <td>{s.dataBase}</td>
              <td>{s.categoria}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

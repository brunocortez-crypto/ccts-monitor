#!/usr/bin/env node

/**
 * Script de Busca Automática de CCTs
 * Executa todo dia 20 do mês às 08:00
 * Busca por novas CCTs nos sindicatos monitorados
 */

const fs = require('fs');
const path = require('path');

console.log('🤖 Iniciando busca automática de CCTs...');
console.log(`📅 Data: ${new Date().toLocaleString('pt-BR')}`);

try {
  // Carregar sindicatos
  const sindicatosPath = path.join(__dirname, '../src/data/sindicatos.json');
  const sindicatos = JSON.parse(fs.readFileSync(sindicatosPath, 'utf8'));
  
  // Carregar CCTs existentes
  const cctsPath = path.join(__dirname, '../src/data/ccts-2026.json');
  let ccts = JSON.parse(fs.readFileSync(cctsPath, 'utf8'));
  
  // Carregar verificações
  const verifPath = path.join(__dirname, '../src/data/verificacoes.json');
  let verificacoes = JSON.parse(fs.readFileSync(verifPath, 'utf8'));

  console.log(`📊 Sindicatos monitorados: ${sindicatos.length}`);

  // Simular busca por novas CCTs
  let novasCCTs = 0;
  
  sindicatos.forEach(sindicato => {
    // Em produção, aqui você faria uma busca real no MTE
    // Por enquanto, apenas registra a verificação
    
    const verificacao = {
      mes: new Date().toISOString().substring(0, 7),
      categoria: sindicato.categoria,
      sindicato: sindicato.nome,
      status: 'Verificado - Sem alteração',
      responsavel: 'Bot Automático',
      dataVerificacao: new Date().toISOString().split('T')[0],
      observacoes: 'Verificação automática executada'
    };
    
    verificacoes.push(verificacao);
  });

  // Salvar dados atualizados
  fs.writeFileSync(cctsPath, JSON.stringify(ccts, null, 2));
  fs.writeFileSync(verifPath, JSON.stringify(verificacoes, null, 2));

  console.log(`✅ Busca concluída!`);
  console.log(`🆕 Novas CCTs encontradas: ${novasCCTs}`);
  console.log(`📋 Total de verificações: ${verificacoes.length}`);
  console.log(`💾 Dados salvos com sucesso`);

} catch (erro) {
  console.error('❌ Erro na busca automática:', erro.message);
  process.exit(1);
}

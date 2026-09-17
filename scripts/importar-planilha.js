/**
 * Planilha do escritório -> data/sindicatos.json
 *
 * Uso:  node scripts/importar-planilha.js [caminho-da-planilha.xlsx]
 *
 * Critério de aceite (PROMPT-SISTEMA-CCT.md §8.1): 63 sindicatos, 109 data-bases.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lerPlanilha } from './lib/planilha.js';

const PADRAO = 'C:\\Users\\bruno\\OneDrive\\Desktop\\Convenções\\Sindicatos_Data_Base (2).xlsx';

// 109 linhas != 109 data-bases. Um mesmo CNPJ repete o mesmo mês em várias linhas
// porque a coluna "Sindicato" é anotação do escritório sobre a empresa cliente
// ("- ACAI 01/2023", "/ARAQUARI"). Data-base distinta por sindicato: 91.
// As 109 linhas continuam preservadas em `variantes`, nada é descartado.
const ESPERADO = { linhas: 109, sindicatos: 63, data_bases: 91 };

const caminho = process.argv[2] || PADRAO;

if (!existsSync(caminho)) {
  console.error(`\nPlanilha não encontrada:\n  ${caminho}\n`);
  console.error('Passe o caminho como argumento:');
  console.error('  node scripts/importar-planilha.js "C:\\caminho\\para\\planilha.xlsx"\n');
  process.exit(1);
}

console.log(`Lendo ${caminho}\n`);
const { sindicatos, avisos, totais } = await lerPlanilha(caminho);

console.log('Totais');
console.log(`  linhas na planilha .............. ${totais.linhas}`);
console.log(`  sindicatos (CNPJs distintos) .... ${totais.sindicatos}`);
console.log(`  data-bases distintas ............ ${totais.data_bases}`);
console.log(`  variantes preservadas ........... ${totais.variantes}`);
console.log(`  com mais de uma data-base ....... ${totais.com_multiplas_data_bases}`);
console.log(`  sem CNPJ válido ................. ${totais.sem_cnpj_valido}`);
console.log(`  marcados para revisão ........... ${totais.a_revisar}`);

if (avisos.length) {
  console.log(`\nAvisos (${avisos.length}):`);
  for (const a of avisos) console.log(`  - ${a}`);
}

const semCnpj = sindicatos.filter((s) => !s.cnpj_valido);
if (semCnpj.length) {
  console.log('\nSem CNPJ válido — não dá para consultar no Mediador:');
  for (const s of semCnpj) console.log(`  - ${s.sigla} (${s.cnpj})`);
}

const multi = sindicatos.filter((s) => s.data_bases.length > 1);
if (multi.length) {
  console.log(`\nMais de uma data-base (${multi.length}) — todas viram alerta:`);
  for (const s of multi) {
    console.log(`  ${String(s.sigla).padEnd(24)} ${s.data_bases.map((d) => d.mes).join(', ')}`);
  }
}

const revisar = sindicatos.filter((s) => s.revisar);
if (revisar.length) {
  console.log(`\nMarcados para revisão (${revisar.length}) — anotação diz "DESATIVADO":`);
  for (const s of revisar) {
    const nota = s.variantes.find((v) => /desativad/i.test(String(v.nome ?? '')));
    console.log(`  ${String(s.sigla).padEnd(24)} linha ${nota.linha}: ${nota.nome}`);
  }
  console.log('  (continuam sendo monitorados — confirme com o escritório antes de remover)');
}

const saida = sindicatos.map(({ linhas_planilha, ...s }) => ({
  ...s,
  importado_em: new Date().toISOString().slice(0, 10),
  origem_planilha: path.basename(caminho)
}));

await mkdir('data', { recursive: true });
await writeFile('data/sindicatos.json', JSON.stringify(saida, null, 2) + '\n', 'utf8');
console.log('\nGravado: data/sindicatos.json');

// Falhar alto. Um import silenciosamente incompleto foi o que derrubou a versão
// anterior para 40 sindicatos com um mês cada.
const problemas = [];
for (const [chave, esperado] of Object.entries(ESPERADO)) {
  if (totais[chave] !== esperado) {
    problemas.push(`${chave}: esperava ${esperado}, saiu ${totais[chave]}`);
  }
}
// Nenhuma linha da planilha pode sumir no caminho.
if (totais.variantes !== totais.linhas) {
  problemas.push(`variantes (${totais.variantes}) != linhas (${totais.linhas}) — linha perdida`);
}

if (problemas.length) {
  console.error('\nCRITÉRIO DE ACEITE FALHOU:');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error('\nSe a planilha mudou de propósito, atualize ESPERADO neste arquivo.\n');
  process.exit(1);
}

console.log(`Aceite OK: ${totais.sindicatos} sindicatos, ${totais.data_bases} data-bases.\n`);

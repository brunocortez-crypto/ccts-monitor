/**
 * Planilha do escritório -> data/sindicatos.json
 *
 * Uso:  node scripts/importar-planilha.js [caminho-da-planilha.xlsx]
 *
 * Critério de aceite (PROMPT-SISTEMA-CCT.md §8.1): 63 sindicatos, 109 data-bases.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lerPlanilha, digitos, cnpjValido } from './lib/planilha.js';

const IGNORADOS = 'data/sindicatos-ignorados.json';
const EXTRAS = 'data/sindicatos-extras.json';

/**
 * A planilha e a fonte das linhas dela, mas nao e a unica fonte de verdade.
 *
 * Este script reescreve data/sindicatos.json inteiro. Sem os dois arquivos abaixo,
 * toda decisao manual morreria no proximo import: um sindicato excluido voltaria,
 * um sindicato incluido a mao sumiria — e ninguem perceberia, porque o import
 * termina dizendo "Aceite OK".
 *
 *  - sindicatos-ignorados.json: CNPJs que o escritorio decidiu nao monitorar.
 *  - sindicatos-extras.json: sindicatos que entraram fora da planilha.
 */
async function lerLista(caminho) {
  if (!existsSync(caminho)) return [];
  try {
    const j = JSON.parse(await readFile(caminho, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    throw new Error(`${caminho} está corrompido: ${e.message}`);
  }
}

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

const ignorados = await lerLista(IGNORADOS);
const extras = await lerLista(EXTRAS);
const cnpjsIgnorados = new Set(ignorados.map((i) => digitos(i.cnpj)));

const daPlanilha = sindicatos
  .filter((s) => !cnpjsIgnorados.has(s.cnpj_digitos))
  .map(({ linhas_planilha, ...s }) => ({
    ...s,
    origem: 'planilha',
    importado_em: new Date().toISOString().slice(0, 10),
    origem_planilha: path.basename(caminho)
  }));

const jaTem = new Set(daPlanilha.map((s) => s.cnpj_digitos));
const extrasValidos = [];
for (const e of extras) {
  const chave = digitos(e.cnpj);
  if (cnpjsIgnorados.has(chave)) continue;
  if (jaTem.has(chave)) {
    console.log(`  (extra ${e.sigla} já está na planilha — usando a linha da planilha)`);
    continue;
  }
  jaTem.add(chave);
  extrasValidos.push({
    ...e,
    cnpj_digitos: chave,
    cnpj_valido: cnpjValido(chave),
    data_bases: e.data_bases ?? [],
    variantes: e.variantes ?? [],
    revisar: false,
    origem: 'incluido-a-mao'
  });
}

if (ignorados.length) {
  console.log(`
Ignorados por decisão do escritório (${ignorados.length}):`);
  for (const i of ignorados) console.log(`  ${String(i.sigla).padEnd(24)} ${i.cnpj} — ${i.motivo}`);
}
if (extrasValidos.length) {
  console.log(`
Incluídos fora da planilha (${extrasValidos.length}):`);
  for (const e of extrasValidos) console.log(`  ${String(e.sigla).padEnd(24)} ${e.cnpj}`);
}

const saida = [...daPlanilha, ...extrasValidos]
  .map((s) => ({ ...s, id: s.id ?? `sid_${s.cnpj_digitos}` }))
  .sort((a, b) => String(a.sigla).localeCompare(String(b.sigla), 'pt'));

await mkdir('data', { recursive: true });
await writeFile('data/sindicatos.json', JSON.stringify(saida, null, 2) + '\n', 'utf8');
console.log('\nGravado: data/sindicatos.json');

// Falhar alto. Um import silenciosamente incompleto foi o que derrubou a versão
// anterior para 40 sindicatos com um mês cada.
const problemas = [];
for (const [chave, esperado] of Object.entries(ESPERADO)) {
  if (totais[chave] !== esperado) {
    problemas.push(`${chave}: esperava ${esperado} na planilha, saiu ${totais[chave]}`);
  }
}
// O aceite mede a LEITURA da planilha. Ignorados e extras entram depois, por
// decisao do escritorio, e sao conferidos por contagem propria.
const esperadoNoArquivo = totais.sindicatos - ignorados.filter(
  (i) => sindicatos.some((s) => s.cnpj_digitos === digitos(i.cnpj))
).length + extrasValidos.length;
if (saida.length !== esperadoNoArquivo) {
  problemas.push(`sindicatos.json ficou com ${saida.length}, esperava ${esperadoNoArquivo}`);
}
// Nenhuma linha da planilha pode sumir no caminho.
if (totais.variantes !== totais.linhas) {
  problemas.push(`variantes (${totais.variantes}) != linhas (${totais.linhas}) — linha perdida`);
}

if (problemas.length) {
  console.error('\nCRITÉRIO DE ACEITE FALHOU:');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error('\nSe a planilha mudou de propósito, atualize ESPERADO neste arquivo.\n');
  process.exitCode = 1;
} else {
  const ignoradosDaPlanilha = totais.sindicatos - daPlanilha.length;
  console.log(`\nAceite OK: ${totais.sindicatos} sindicatos na planilha, ` +
              `${totais.data_bases} data-bases.`);
  console.log(`Gravados: ${saida.length} (${daPlanilha.length} da planilha` +
              `${extrasValidos.length ? ` + ${extrasValidos.length} incluído(s) à mão` : ''}` +
              `${ignoradosDaPlanilha ? `, ${ignoradosDaPlanilha} ignorado(s)` : ''}).\n`);
}

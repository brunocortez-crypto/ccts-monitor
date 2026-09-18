/**
 * Inclui um sindicato que não está na planilha, ou tira um do monitoramento.
 *
 * Existe porque o importador reescreve data/sindicatos.json inteiro a partir da
 * planilha. Editar aquele arquivo na mão funciona até alguém rodar `npm run
 * importar` — aí a alteração some sem avisar. Este script grava nos dois arquivos
 * que o importador respeita:
 *
 *   data/sindicatos-extras.json     incluídos fora da planilha
 *   data/sindicatos-ignorados.json  tirados por decisão do escritório
 *
 * Uso:
 *   node scripts/adicionar-sindicato.js --cnpj 12.345.678/0001-90 \
 *        --sigla SINDXYZ --nome "SINDICATO DOS ..." --uf MG \
 *        --meses "Janeiro,Maio" [--municipio "Uberlândia"] [--site https://...]
 *
 *   node scripts/adicionar-sindicato.js --ignorar 00.000.000/0000-00 \
 *        --motivo "CNPJ de preenchimento"
 *
 *   node scripts/adicionar-sindicato.js --listar
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { digitos, cnpjValido, MESES } from './lib/planilha.js';

const EXTRAS = 'data/sindicatos-extras.json';
const IGNORADOS = 'data/sindicatos-ignorados.json';

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

async function ler(caminho) {
  if (!existsSync(caminho)) return [];
  const j = JSON.parse(await readFile(caminho, 'utf8'));
  return Array.isArray(j) ? j : [];
}

async function gravar(caminho, lista) {
  await mkdir('data', { recursive: true });
  await writeFile(caminho, JSON.stringify(lista, null, 2) + '\n', 'utf8');
}

const hoje = new Date().toISOString().slice(0, 10);

/* ── listar ─────────────────────────────────────── */

if (process.argv.includes('--listar')) {
  const extras = await ler(EXTRAS);
  const ignorados = await ler(IGNORADOS);

  console.log(`\nIncluídos fora da planilha (${extras.length}):`);
  for (const e of extras) {
    console.log(`  ${String(e.sigla).padEnd(24)} ${e.cnpj}  ` +
                `${(e.data_bases || []).map((d) => d.mes).join(', ')}`);
  }
  if (!extras.length) console.log('  (nenhum)');

  console.log(`\nIgnorados (${ignorados.length}):`);
  for (const i of ignorados) {
    console.log(`  ${String(i.sigla).padEnd(24)} ${i.cnpj}  — ${i.motivo}`);
  }
  if (!ignorados.length) console.log('  (nenhum)');
  console.log('');
  process.exit(0);
}

/* ── ignorar ────────────────────────────────────── */

const paraIgnorar = argumento('ignorar');
if (paraIgnorar) {
  const motivo = argumento('motivo');
  if (!motivo) {
    console.error('--ignorar exige --motivo. Daqui a seis meses ninguém lembra por quê.');
    process.exit(1);
  }
  const chave = digitos(paraIgnorar);
  const ignorados = await ler(IGNORADOS);
  if (ignorados.some((i) => digitos(i.cnpj) === chave)) {
    console.error(`${paraIgnorar} já está na lista de ignorados.`);
    process.exit(1);
  }

  const sindicatos = existsSync('data/sindicatos.json')
    ? JSON.parse(await readFile('data/sindicatos.json', 'utf8')) : [];
  const alvo = sindicatos.find((s) => s.cnpj_digitos === chave);

  ignorados.push({
    cnpj: paraIgnorar,
    sigla: argumento('sigla', alvo?.sigla ?? '(desconhecido)'),
    motivo,
    ignorado_em: hoje,
    decidido_por: argumento('por', 'escritório')
  });
  await gravar(IGNORADOS, ignorados);
  console.log(`\nIgnorado: ${paraIgnorar}`);
  console.log('Rode `npm run importar` para aplicar em data/sindicatos.json.\n');
  process.exit(0);
}

/* ── incluir ────────────────────────────────────── */

const cnpj = argumento('cnpj');
const sigla = argumento('sigla');
const nome = argumento('nome');
const meses = argumento('meses');

if (!cnpj || !sigla || !nome || !meses) {
  console.error('\nFaltou argumento. O mínimo é:');
  console.error('  --cnpj  --sigla  --nome  --meses');
  console.error('\nExemplo:');
  console.error('  node scripts/adicionar-sindicato.js \\');
  console.error('    --cnpj 12.345.678/0001-90 --sigla SINDXYZ \\');
  console.error('    --nome "SINDICATO DOS TRABALHADORES EM ..." \\');
  console.error('    --uf MG --meses "Janeiro,Maio"\n');
  process.exit(1);
}

const chave = digitos(cnpj);

// Um CNPJ invalido aqui vira uma consulta que nunca acha nada, e o sindicato
// aparece no painel como "sem convencao" — indistinguivel de quem de fato nao tem.
if (!cnpjValido(chave)) {
  console.error(`\nCNPJ inválido: ${cnpj}`);
  console.error('Sem CNPJ válido não dá para consultar o Mediador, e o sindicato');
  console.error('apareceria como "sem convenção" para sempre.\n');
  process.exit(1);
}

const listaMeses = [];
for (const bruto of meses.split(',')) {
  const txt = bruto.trim();
  if (!txt) continue;
  const i = MESES.findIndex((m) => m.toLowerCase() === txt.toLowerCase());
  if (i === -1) {
    console.error(`\nMês não reconhecido: "${txt}"`);
    console.error(`Use: ${MESES.join(', ')}\n`);
    process.exit(1);
  }
  if (!listaMeses.some((d) => d.mes_numero === i + 1)) {
    listaMeses.push({ mes: MESES[i], mes_numero: i + 1 });
  }
}
listaMeses.sort((a, b) => a.mes_numero - b.mes_numero);

const extras = await ler(EXTRAS);
if (extras.some((e) => digitos(e.cnpj) === chave)) {
  console.error(`\n${cnpj} já está em ${EXTRAS}.\n`);
  process.exit(1);
}

const sindicatos = existsSync('data/sindicatos.json')
  ? JSON.parse(await readFile('data/sindicatos.json', 'utf8')) : [];
const jaExiste = sindicatos.find((s) => s.cnpj_digitos === chave);
if (jaExiste) {
  console.error(`\n${cnpj} já é monitorado (${jaExiste.sigla}), veio da planilha.`);
  console.error('Para mudar as data-bases dele, edite a planilha e reimporte.\n');
  process.exit(1);
}

const site = argumento('site');
extras.push({
  cnpj,
  sigla,
  nome,
  entidade: argumento('entidade'),
  municipio: argumento('municipio'),
  uf: argumento('uf'),
  site: site && /^https?:\/\//i.test(site) ? site : (site ? `https://${site}` : null),
  data_bases: listaMeses,
  incluido_em: hoje,
  incluido_por: argumento('por', 'escritório')
});

await gravar(EXTRAS, extras);

console.log(`\nIncluído em ${EXTRAS}:`);
console.log(`  ${sigla}  ${cnpj}`);
console.log(`  data-base: ${listaMeses.map((d) => d.mes).join(', ')}`);
console.log('\nPróximos passos:');
console.log('  npm run importar    aplica em data/sindicatos.json');
console.log(`  node scripts/buscar-mediador.js --sigla ${sigla}    busca as convenções dele`);
console.log('');

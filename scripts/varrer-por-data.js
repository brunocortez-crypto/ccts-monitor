/**
 * VARREDURA DIÁRIA — tudo que foi registrado no país na janela, filtrado depois.
 *
 * Complementa a busca por CNPJ em vez de substituí-la, por dois motivos:
 *
 *  1. Não depende de como o MTE indexa as partes. O SESCAP/PE, por exemplo, tem
 *     convenção que a busca por CNPJ não encontra nem por razão social.
 *  2. Uma consulta por dia cobre o país inteiro (~12 convenções/dia), então dá para
 *     rodar diariamente em vez de uma vez por mês.
 *
 * O resultado da busca traz só o NOME das partes. Para saber se é da carteira do
 * escritório é preciso baixar o extrato, que traz os CNPJs — por isso a varredura
 * baixa cada documento novo e casa por CNPJ, que é chave exata, não por nome.
 *
 * Uso:
 *   node scripts/varrer-por-data.js                 (ontem e hoje)
 *   node scripts/varrer-por-data.js --dias 7        (últimos 7 dias)
 *   node scripts/varrer-por-data.js --de 01/09/2026 --ate 17/09/2026
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  consultarPorPeriodo, urlDocumento, pausa, UA_NAVEGADOR, VIGENCIA, TIPO
} from './lib/mediador.js';
import { processarDocumento } from './lib/extrair.js';

const PASTA = 'docs/MTE';

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const ddmmaaaa = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const dias = Number(argumento('dias', 1)) || 1;
const hojeData = new Date();
const inicioData = new Date(hojeData);
inicioData.setDate(inicioData.getDate() - dias);

const de = argumento('de', ddmmaaaa(inicioData));
const ate = argumento('ate', ddmmaaaa(hojeData));

if (!/^\d{2}\/\d{2}\/\d{4}$/.test(de) || !/^\d{2}\/\d{2}\/\d{4}$/.test(ate)) {
  console.error('Datas devem ser dd/mm/aaaa. Recebi: ' + de + ' e ' + ate);
  process.exit(1);
}

if (!existsSync('data/sindicatos.json')) {
  console.error('data/sindicatos.json não existe. Rode antes: npm run importar');
  process.exit(1);
}

const sindicatos = JSON.parse(await readFile('data/sindicatos.json', 'utf8'));
const documentos = existsSync('data/documentos.json')
  ? JSON.parse(await readFile('data/documentos.json', 'utf8')) : [];

const porCnpj = new Map(sindicatos.map((s) => [s.cnpj_digitos, s]));
const ufsDaCarteira = new Set(sindicatos.map((s) => s.uf).filter(Boolean).map((u) => u.toUpperCase()));
const jaConhecidos = new Set(documentos.map((d) => d.nr_solicitacao));

console.log(`Varredura por data de registro: ${de} a ${ate}`);
console.log(`Carteira: ${porCnpj.size} sindicatos · já conhecidos: ${jaConhecidos.size} documentos\n`);

const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({
  userAgent: UA_NAVEGADOR, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1366, height: 900 }
});
const page = await contexto.newPage();

const hoje = new Date().toISOString().slice(0, 10);
const falhas = [];
const daCarteira = [];
let examinados = 0;
let foraDaCarteira = 0;
let descartadosPorUf = 0;
const inicio = Date.now();

async function baixarPelaPagina(nrSolicitacao) {
  const r = await page.evaluate(async (url) => {
    const resp = await fetch(url, { credentials: 'include' });
    const bytes = new Uint8Array(await resp.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return { status: resp.status, tipo: resp.headers.get('content-type') || '', base64: btoa(bin) };
  }, urlDocumento(nrSolicitacao));

  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!/msword|octet-stream/i.test(r.tipo)) throw new Error(`Content-Type ${r.tipo}`);
  return Buffer.from(r.base64, 'base64');
}

try {
  const r = await consultarPorPeriodo(page, de, ate, {
    vigencia: VIGENCIA.VIGENTES, tipo: TIPO.CONVENCAO
  });

  console.log(`O Mediador registrou ${r.total_declarado} convenção(ões) vigente(s) no período.`);
  console.log(`Extraí ${r.instrumentos.length}. Verificando quais são da carteira...\n`);

  const inéditos = r.instrumentos.filter((i) => !jaConhecidos.has(i.nr_solicitacao));

  // Pré-filtro por UF de registro. O nº de registro começa com a sigla da SRT que
  // registrou ("MG000058/2026", "SP008859/2026") ou "SR" para registro nacional.
  //
  // Sem isso, descobrir que uma convenção de Santa Catarina não é da carteira custa
  // um download — cerca de 700 por mês só para descartar. Baixar só o que pode ser
  // nosso reduz isso em dois terços e é mais educado com um serviço público.
  //
  // O preço é uma suposição: que o sindicato registra na UF onde atua. Se algum
  // registrar fora, a varredura diária não pega — mas a rodada mensal por CNPJ pega,
  // que é justamente o papel dela.
  const novos = inéditos.filter((i) => {
    const uf = String(i.nr_registro_mte || '').slice(0, 2).toUpperCase();
    return !uf || uf === 'SR' || ufsDaCarteira.has(uf);
  });
  descartadosPorUf = inéditos.length - novos.length;

  console.log(`${inéditos.length} ainda não estão na base.`);
  if (descartadosPorUf) {
    console.log(`${descartadosPorUf} descartado(s) por UF fora da carteira ` +
                `(${[...ufsDaCarteira].sort().join(', ')} + SR), sem baixar.`);
  }
  console.log(`${novos.length} para examinar: baixo o extrato de cada um porque o`);
  console.log('resultado da busca traz só o nome das partes, sem CNPJ.\n');

  for (const [n, i] of novos.entries()) {
    const rotulo = `[${String(n + 1).padStart(3)}/${novos.length}] ${String(i.nr_registro_mte).padEnd(16)}`;
    try {
      const buffer = await baixarPelaPagina(i.nr_solicitacao);
      const p = processarDocumento(buffer);
      examinados++;

      const cnpjsNoDocumento = [...new Set(
        [...p.texto.matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g)]
          .map((m) => m[1].replace(/\D/g, ''))
      )];
      const casados = cnpjsNoDocumento.filter((c) => porCnpj.has(c));

      if (!casados.length) {
        foraDaCarteira++;
        console.log(`${rotulo} fora da carteira`);
      } else {
        const s = porCnpj.get(casados[0]);
        await mkdir(PASTA, { recursive: true });
        const arquivo = path.posix.join(PASTA, `${i.nr_solicitacao.replace(/[\\/]/g, '-')}.doc`);
        await writeFile(arquivo, buffer);

        const registro = {
          nr_solicitacao: i.nr_solicitacao,
          nr_registro_mte: i.nr_registro_mte,
          sindicato_id: s.id,
          sindicato_sigla: s.sigla,
          cnpj_sindicato: s.cnpj,
          tipo: i.tipo,
          vigencia_inicio: i.vigencia.inicio,
          vigencia_fim: i.vigencia.fim,
          vigencia_texto: i.vigencia.texto,
          partes: i.partes,
          origem: 'mte',
          achado_por: 'varredura-por-data',
          descoberto_em: hoje,
          visto_em: hoje,
          vigente: true,
          arquivo_local: arquivo,
          arquivo_bytes: buffer.length,
          texto_extraido: p.texto,
          tamanho_texto: p.tamanho_texto,
          clausulas: p.clausulas,
          indicadores: p.indicadores,
          coletado_em: hoje,
          data_registro: p.cabecalho.data_registro ?? null,
          nr_processo: p.cabecalho.nr_processo ?? null
        };
        documentos.push(registro);
        daCarteira.push(registro);
        console.log(`${rotulo} ${s.sigla} — DA CARTEIRA, ${p.clausulas.length} cláusula(s)`);
      }
    } catch (erro) {
      console.log(`${rotulo} FALHOU: ${erro.message}`);
      falhas.push({ nr_solicitacao: i.nr_solicitacao, motivo: erro.message });
    }
    await pausa(1500);
  }
} catch (erro) {
  console.error(`\nA varredura falhou: ${erro.message}`);
  falhas.push({ periodo: `${de}–${ate}`, motivo: erro.message });
} finally {
  await navegador.close();
}

await mkdir('data', { recursive: true });
await writeFile('data/documentos.json', JSON.stringify(documentos, null, 2) + '\n', 'utf8');

const execucoes = existsSync('data/execucoes.json')
  ? JSON.parse(await readFile('data/execucoes.json', 'utf8')) : [];
await writeFile('data/execucoes.json', JSON.stringify([{
  data: new Date().toISOString(),
  estagio: 'varredura-por-data',
  periodo: `${de} a ${ate}`,
  documentos_examinados: examinados,
  descartados_por_uf: descartadosPorUf,
  da_carteira: daCarteira.length,
  fora_da_carteira: foraDaCarteira,
  duracao_segundos: Math.round((Date.now() - inicio) / 1000),
  falhas
}, ...execucoes], null, 2) + '\n', 'utf8');

console.log('\n─────────────────────────────────────────');
console.log(`descartados por UF ....... ${descartadosPorUf} (sem baixar)`);
console.log(`examinados ............... ${examinados}`);
console.log(`DA CARTEIRA (novos) ...... ${daCarteira.length}`);
console.log(`fora da carteira ......... ${foraDaCarteira}`);
console.log(`duração .................. ${Math.round((Date.now() - inicio) / 1000)}s`);

if (daCarteira.length) {
  console.log('\nNOVIDADES PARA O ESCRITÓRIO:');
  for (const d of daCarteira) {
    console.log(`  ${String(d.sindicato_sigla).padEnd(24)} ${d.nr_registro_mte}  ` +
                `vigência ${d.vigencia_inicio} a ${d.vigencia_fim}`);
  }
}

if (falhas.length) {
  console.log(`\nFALHAS (${falhas.length}) — em data/execucoes.json:`);
  for (const f of falhas) console.log(`  ${f.nr_solicitacao ?? f.periodo}: ${f.motivo}`);
  process.exitCode = 1;
}

console.log('');

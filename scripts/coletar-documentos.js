/**
 * ESTÁGIO 2 — baixa os documentos e extrai o texto.
 *
 * O download no Mediador é GET puro, sem token e sem sessão — mas o Cloudflare
 * gateia por reputação. Medido em 17/09/2026: depois de algumas dezenas de
 * requisições no dia, a mesma URL que respondia 200 passou a devolver 403 com
 * desafio ("Just a moment..."), inclusive para documento já baixado antes.
 *
 * Não basta usar o cliente HTTP do Playwright (context.request): ele tem pilha
 * própria e o Cloudflare fingerprinta o TLS — também leva 403. O que funciona é
 * fazer o fetch DE DENTRO da página, que usa a pilha e os cookies do próprio
 * navegador. Medido: 200, application/msword, 142 KB.
 *
 * Uso:
 *   node scripts/coletar-documentos.js
 *   node scripts/coletar-documentos.js --limite 5
 *   node scripts/coletar-documentos.js --refazer     (rebaixa tudo)
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { URL_CONSULTA, UA_NAVEGADOR, urlDocumento, pausa } from './lib/mediador.js';
import { processarDocumento } from './lib/extrair.js';

const PASTA = 'docs/MTE';
const PAUSA_ENTRE = 1200;
const TENTATIVAS = 3;

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}
const limite = Number(argumento('limite', 0)) || 0;
const refazer = process.argv.includes('--refazer');
// Reextrai a partir dos arquivos já em disco, sem tocar no MTE. Serve para quando
// o extrator melhora — reprocessar 87 documentos locais leva segundos e não gasta
// nem uma requisição no serviço público.
const reprocessar = process.argv.includes('--reprocessar');

if (!existsSync('data/documentos.json')) {
  console.error('data/documentos.json não existe. Rode antes: npm run buscar');
  process.exit(1);
}
const documentos = JSON.parse(await readFile('data/documentos.json', 'utf8'));

/** "MR000649/2026" -> "MR000649-2026" (a barra não pode virar nome de arquivo) */
const nomeArquivo = (nr) => `${String(nr).replace(/[\\/]/g, '-')}.doc`;

async function baixar(pagina, nrSolicitacao) {
  let ultimo;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      const resultado = await pagina.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return { status: r.status, tipo: r.headers.get('content-type') || '', base64: btoa(bin) };
      }, urlDocumento(nrSolicitacao));

      if (resultado.status !== 200) throw new Error(`HTTP ${resultado.status}`);

      const tipo = resultado.tipo;
      const buffer = Buffer.from(resultado.base64, 'base64');

      if (/just a moment|challenge-platform/i.test(buffer.subarray(0, 600).toString('latin1'))) {
        throw new Error('desafio do Cloudflare — reduza o ritmo');
      }

      // O MTE serve o extrato como application/msword. Se vier text/html "puro"
      // é página de erro, não documento — justamente o modo de falha que deixou
      // 123 links quebrados devolvendo HTTP 200 na versão anterior.
      if (!/msword|octet-stream|vnd\.openxml/i.test(tipo)) {
        throw new Error(`Content-Type inesperado: ${tipo}`);
      }
      if (buffer.length < 2000) {
        throw new Error(`resposta muito curta (${buffer.length} bytes)`);
      }
      return { buffer, tipo };
    } catch (erro) {
      ultimo = erro;
      if (t < TENTATIVAS) await pausa(t * 5000);
    }
  }
  throw new Error(`${ultimo.message} (após ${TENTATIVAS} tentativas)`);
}

const alvos = reprocessar
  ? documentos.filter((d) => d.arquivo_local && existsSync(d.arquivo_local))
  : documentos.filter((d) => refazer || !d.coletado_em);
const lista = limite ? alvos.slice(0, limite) : alvos;

console.log(`Coleta — ${lista.length} de ${documentos.length} documento(s)`);
console.log(`Já coletados: ${documentos.filter((d) => d.coletado_em).length}\n`);

await mkdir(PASTA, { recursive: true });

// Abre a página uma vez para o contexto receber o cookie de liberação do Cloudflare.
const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({
  userAgent: UA_NAVEGADOR,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo'
});
const pagina = await contexto.newPage();
await pagina.goto(URL_CONSULTA, { waitUntil: 'domcontentloaded', timeout: 90000 });

const hoje = new Date().toISOString().slice(0, 10);
const falhas = [];
let baixados = 0;
let semClausula = 0;
const inicio = Date.now();

for (const [n, d] of lista.entries()) {
  const rotulo = `[${String(n + 1).padStart(3)}/${lista.length}] ${String(d.nr_registro_mte || d.nr_solicitacao).padEnd(16)}`;

  try {
    const arquivo = path.posix.join(PASTA, nomeArquivo(d.nr_solicitacao));
    let buffer;
    if (reprocessar) {
      buffer = await readFile(d.arquivo_local);
    } else {
      buffer = (await baixar(pagina, d.nr_solicitacao)).buffer;
      await writeFile(arquivo, buffer);
    }

    const r = processarDocumento(buffer);

    d.arquivo_local = arquivo;
    d.arquivo_bytes = buffer.length;
    d.texto_extraido = r.texto;
    d.tamanho_texto = r.tamanho_texto;
    d.clausulas = r.clausulas;
    d.indicadores = r.indicadores;
    d.coletado_em = hoje;

    // O cabeçalho do próprio documento confirma o registro que a busca trouxe.
    if (r.cabecalho.nr_registro_mte && d.nr_registro_mte &&
        r.cabecalho.nr_registro_mte !== d.nr_registro_mte) {
      falhas.push({
        nr_solicitacao: d.nr_solicitacao,
        motivo: `registro divergente: busca disse ${d.nr_registro_mte}, ` +
                `documento diz ${r.cabecalho.nr_registro_mte}`
      });
    }
    if (r.cabecalho.data_registro) d.data_registro = r.cabecalho.data_registro;
    if (r.cabecalho.nr_processo) d.nr_processo = r.cabecalho.nr_processo;

    baixados++;
    if (!r.clausulas.length) semClausula++;
    console.log(
      `${rotulo} ${String(buffer.length).padStart(6)} bytes  ` +
      `${String(r.clausulas.length).padStart(2)} cláusula(s)  ${r.tamanho_texto} chars`
    );
  } catch (erro) {
    console.log(`${rotulo} FALHOU: ${erro.message}`);
    falhas.push({ nr_solicitacao: d.nr_solicitacao, sigla: d.sindicato_sigla, motivo: erro.message });
  }

  if (!reprocessar && n < lista.length - 1) await pausa(PAUSA_ENTRE);
}

await writeFile('data/documentos.json', JSON.stringify(documentos, null, 2) + '\n', 'utf8');

const execucoes = existsSync('data/execucoes.json')
  ? JSON.parse(await readFile('data/execucoes.json', 'utf8')) : [];
await writeFile('data/execucoes.json', JSON.stringify([{
  data: new Date().toISOString(),
  estagio: 'coletar-documentos',
  alvo: lista.length,
  baixados,
  sem_clausula_reconhecida: semClausula,
  duracao_segundos: Math.round((Date.now() - inicio) / 1000),
  falhas
}, ...execucoes], null, 2) + '\n', 'utf8');

console.log('\n─────────────────────────────────────────');
console.log(`baixados ................. ${baixados}/${lista.length}`);
console.log(`sem cláusula reconhecida . ${semClausula}`);
console.log(`total já coletado ........ ${documentos.filter((d) => d.coletado_em).length}/${documentos.length}`);
console.log(`duração .................. ${Math.round((Date.now() - inicio) / 1000)}s`);

if (falhas.length) {
  console.log(`\nFALHAS (${falhas.length}) — em data/execucoes.json:`);
  for (const f of falhas.slice(0, 20)) console.log(`  ${f.nr_solicitacao}: ${f.motivo}`);
  if (falhas.length > 20) console.log(`  ... mais ${falhas.length - 20}`);
  process.exitCode = 1;
} else {
  // Fora do else, esta linha já imprimiu "Sem falhas" logo depois de listar 87
  // falhas. Mensagem de sucesso que não depende do resultado não é mensagem.
  console.log('\nSem falhas. Confira os links com: npm run verificar');
}

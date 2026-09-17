/**
 * ESTÁGIO 1 — busca no Mediador do MTE.
 *
 * Percorre os sindicatos de data/sindicatos.json, consulta cada CNPJ e grava o que
 * encontrou em data/documentos.json. Não baixa arquivo: isso é o estágio 2, que não
 * precisa de navegador.
 *
 * Uso:
 *   node scripts/buscar-mediador.js
 *   node scripts/buscar-mediador.js --limite 5          (teste rápido)
 *   node scripts/buscar-mediador.js --sigla FECCOEMG    (um sindicato só)
 *   node scripts/buscar-mediador.js --vigencia todos    (inclui não vigentes)
 *   node scripts/buscar-mediador.js --visivel           (janela aberta, para depurar)
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { consultarCnpj, pausa, UA_NAVEGADOR, VIGENCIA, TIPO } from './lib/mediador.js';

const PAUSA_ENTRE_SINDICATOS = 4000;

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const limite = Number(argumento('limite', 0)) || 0;
const sigla = argumento('sigla');
const visivel = process.argv.includes('--visivel');
const vigenciaArg = String(argumento('vigencia', 'vigentes')).toLowerCase();
const vigencia = { vigentes: VIGENCIA.VIGENTES, todos: VIGENCIA.TODOS,
                   'nao-vigentes': VIGENCIA.NAO_VIGENTES }[vigenciaArg];

if (!vigencia) {
  console.error(`--vigencia inválida: "${vigenciaArg}". Use vigentes, todos ou nao-vigentes.`);
  process.exit(1);
}

// Escopo do escritório: Convenção Coletiva, vigentes. Acordo coletivo é negociação
// empresa a empresa e fica de fora.
const tipoArg = String(argumento('tipo', 'convencao')).toLowerCase();
const tipo = { convencao: TIPO.CONVENCAO, acordo: TIPO.ACORDO, todos: TIPO.TODOS,
               'aditivo-convencao': TIPO.TERMO_ADITIVO_CONVENCAO }[tipoArg];

if (tipo === undefined) {
  console.error(`--tipo inválido: "${tipoArg}". Use convencao, acordo, aditivo-convencao ou todos.`);
  process.exit(1);
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

const TENTATIVAS = 3;
const ESPERA_TENTATIVA = [6000, 20000];

// CNPJ da FECCOEMG: tem instrumento vigente de sobra e serve de canário.
const CNPJ_CANARIO = '17219585000138';

const ERRO_DE_SERVIDOR = /HTTP (500|502|503|504)/;

/**
 * O Mediador responde HTTP 500 quando a consulta não tem resultado — na tela do
 * navegador ela simplesmente volta vazia, sem mensagem. Confirmado contra a
 * captura de 21/07/2026: os CNPJs que dão 500 são os mesmos marcados lá como
 * "NENHUM VIGENTE".
 *
 * Só que aceitar isso de olhos fechados criaria a pior falha possível: uma queda
 * real do MTE viraria "nenhum sindicato tem instrumento", e o painel ficaria
 * verde mentindo. Então, ao receber erro de servidor, perguntamos por um CNPJ que
 * sabidamente tem resultado. Se o canário responde, o serviço está de pé e o erro
 * significa vazio. Se o canário também falha, é indisponibilidade — e vira falha.
 */
const VALIDADE_CANARIO = 5 * 60 * 1000;
let canarioCache = { em: 0, ok: false };

async function canarioResponde(page) {
  // Revalidamos a cada 5 min em vez de a cada CNPJ vazio: verificar uma vez por
  // sindicato dobraria a carga no MTE, e uma janela de 5 minutos é curta o
  // bastante para pegar uma queda no meio da rodada.
  if (Date.now() - canarioCache.em < VALIDADE_CANARIO) return canarioCache.ok;
  try {
    const r = await consultarCnpj(page, CNPJ_CANARIO, { vigencia: VIGENCIA.VIGENTES, tipo });
    canarioCache = { em: Date.now(), ok: r.instrumentos.length > 0 };
  } catch {
    canarioCache = { em: Date.now(), ok: false };
  }
  return canarioCache.ok;
}

/**
 * Retentativa para falhas transitórias — timeout de rede, página que não terminou
 * de carregar. Erro de servidor sai daqui na primeira ocorrência: quem decide o
 * que ele significa é o canário, e insistir num 500 só gasta tempo.
 */
async function comTentativas(fn, rotulo) {
  let ultimo;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      return await fn();
    } catch (erro) {
      ultimo = erro;
      // Erro de servidor tem tratamento próprio (canário) e não se resolve
      // insistindo: 500 aqui quer dizer "consulta sem resultado".
      if (ERRO_DE_SERVIDOR.test(erro.message)) throw erro;
      if (t < TENTATIVAS) {
        const espera = ESPERA_TENTATIVA[t - 1];
        console.log(`${rotulo} tentativa ${t}/${TENTATIVAS} falhou (${erro.message.slice(0, 60)}), ` +
                    `repetindo em ${espera / 1000}s`);
        await pausa(espera);
      }
    }
  }
  throw new Error(`${ultimo.message} (após ${TENTATIVAS} tentativas)`);
}

async function lerJson(caminho, padrao) {
  if (!existsSync(caminho)) return padrao;
  try {
    return JSON.parse(await readFile(caminho, 'utf8'));
  } catch (e) {
    throw new Error(`${caminho} está corrompido: ${e.message}`);
  }
}

const sindicatos = await lerJson('data/sindicatos.json', null);
if (!sindicatos) {
  console.error('data/sindicatos.json não existe. Rode antes: npm run importar');
  process.exit(1);
}

let alvos = sindicatos;
if (sigla) {
  alvos = sindicatos.filter((s) => String(s.sigla).toUpperCase().includes(sigla.toUpperCase()));
  if (!alvos.length) {
    console.error(`Nenhum sindicato com sigla contendo "${sigla}".`);
    process.exit(1);
  }
}
if (limite) alvos = alvos.slice(0, limite);

const anteriores = Array.isArray(await lerJson('data/documentos.json', []))
  ? await lerJson('data/documentos.json', []) : [];
const compativeis = anteriores.filter((d) => d?.nr_solicitacao);
const incompativeis = anteriores.length - compativeis.length;

// O documentos.json de julho/2026 foi montado por outro método e não tem
// nr_solicitacao — sem essa chave não dá para baixar o documento no Mediador.
// Descartar em silêncio seria repetir o defeito que este sistema veio corrigir.
if (incompativeis) {
  const arquivo = `data/documentos.formato-antigo-${hojeIso()}.json`;
  await mkdir('data', { recursive: true });
  await writeFile(arquivo, JSON.stringify(anteriores, null, 2) + '\n', 'utf8');
  console.log(`AVISO: ${incompativeis} de ${anteriores.length} registros existentes não têm`);
  console.log('       nr_solicitacao (formato anterior a esta versão) e não serão reaproveitados.');
  console.log(`       Cópia integral salva em ${arquivo}`);
  console.log('       Eles voltam nesta busca, agora com a chave que permite o download.\n');
}

const porSolicitacao = new Map(compativeis.map((d) => [d.nr_solicitacao, d]));

console.log(`Mediador MTE — ${alvos.length} sindicato(s), tipo "${tipoArg}", vigência "${vigenciaArg}"`);
console.log(`Já conhecidos: ${porSolicitacao.size} documento(s)`);
console.log(`Navegador: ${visivel ? 'visível' : 'headless'}\n`);

const navegador = await chromium.launch({ headless: !visivel });
const contexto = await navegador.newContext({
  userAgent: UA_NAVEGADOR,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1366, height: 900 }
});
const page = await contexto.newPage();

const hoje = new Date().toISOString().slice(0, 10);

/**
 * Escreve em arquivo temporário e renomeia. Se o processo morrer no meio da
 * escrita, o documentos.json anterior continua íntegro em vez de virar JSON pela
 * metade — que é irrecuperável e passa despercebido até alguém tentar ler.
 */
async function gravarDocumentos() {
  const documentos = [...porSolicitacao.values()].sort((a, b) =>
    String(a.sindicato_sigla).localeCompare(String(b.sindicato_sigla), 'pt') ||
    String(a.nr_registro_mte).localeCompare(String(b.nr_registro_mte))
  );
  await mkdir('data', { recursive: true });
  const temporario = 'data/documentos.json.tmp';
  await writeFile(temporario, JSON.stringify(documentos, null, 2) + '\n', 'utf8');
  await rename(temporario, 'data/documentos.json');
  return documentos;
}

const falhas = [];
// Sindicatos cuja consulta respondeu (com ou sem resultado). Só para estes é
// seguro concluir que um documento ausente saiu de vigência — ver baixarBandeira().
const consultadosComSucesso = new Set();
const vistosNestaRodada = new Set();
let novos = 0;
let semCnpj = 0;
let semInstrumento = 0;
let consultados = 0;

const inicio = Date.now();

for (const [n, s] of alvos.entries()) {
  const rotulo = `[${String(n + 1).padStart(2)}/${alvos.length}] ${String(s.sigla).padEnd(24).slice(0, 24)}`;

  if (!s.cnpj_valido) {
    semCnpj++;
    console.log(`${rotulo} CNPJ inválido (${s.cnpj}) — não dá para consultar`);
    falhas.push({ sindicato_id: s.id, sigla: s.sigla, motivo: 'CNPJ inválido na planilha' });
    continue;
  }

  try {
    const r = await comTentativas(() => consultarCnpj(page, s.cnpj_digitos, { vigencia, tipo }), rotulo);
    consultados++;
    consultadosComSucesso.add(s.id);

    if (!r.instrumentos.length) {
      semInstrumento++;
      console.log(`${rotulo} nenhum instrumento`);
    } else {
      let novosDaVez = 0;
      for (const i of r.instrumentos) {
        const existente = porSolicitacao.get(i.nr_solicitacao);
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
          descoberto_em: existente?.descoberto_em ?? hoje,
          visto_em: hoje,
          // preenchidos pelo estágio 2
          arquivo_local: existente?.arquivo_local ?? null,
          texto_extraido: existente?.texto_extraido ?? null,
          clausulas: existente?.clausulas ?? null,
          coletado_em: existente?.coletado_em ?? null
        };
        if (!existente) {
          novos++;
          novosDaVez++;
        }
        vistosNestaRodada.add(i.nr_solicitacao);
        porSolicitacao.set(i.nr_solicitacao, registro);
      }
      // Trava de escopo: se o filtro de tipo escapar, o painel enche de acordo de
      // empresa e ninguém percebe olhando os números.
      if (tipo === TIPO.CONVENCAO) {
        const fora = r.instrumentos.filter((i) => !/conven[çc][ãa]o coletiva/i.test(i.tipo || ''));
        if (fora.length) {
          falhas.push({
            sindicato_id: s.id, sigla: s.sigla,
            motivo: `${fora.length} instrumento(s) fora do tipo Convenção Coletiva: ` +
                    [...new Set(fora.map((i) => i.tipo))].join(', ')
          });
        }
      }

      const aviso = r.instrumentos.length !== r.total_declarado
        ? `  ATENÇÃO: site declarou ${r.total_declarado}`
        : '';
      console.log(
        `${rotulo} ${String(r.instrumentos.length).padStart(3)} instrumento(s)` +
        `${novosDaVez ? `, ${novosDaVez} novo(s)` : ''}${aviso}`
      );
      if (aviso) {
        falhas.push({
          sindicato_id: s.id, sigla: s.sigla,
          motivo: `extraiu ${r.instrumentos.length} de ${r.total_declarado} declarados`
        });
      }
    }
  } catch (erro) {
    if (ERRO_DE_SERVIDOR.test(erro.message)) {
      await pausa(3000);
      if (await canarioResponde(page)) {
        semInstrumento++;
        consultados++;
        consultadosComSucesso.add(s.id);
        console.log(`${rotulo} nenhum instrumento (erro 500 = vazio; canário confirmou o serviço no ar)`);
        continue;
      }
      console.log(`${rotulo} FALHOU: Mediador indisponível (o canário também não respondeu)`);
      falhas.push({
        sindicato_id: s.id, sigla: s.sigla,
        motivo: `Mediador indisponível: ${erro.message}`
      });
      continue;
    }
    console.log(`${rotulo} FALHOU: ${erro.message}`);
    falhas.push({ sindicato_id: s.id, sigla: s.sigla, motivo: erro.message });
  }

  // Grava a cada sindicato. A rodada leva ~20 minutos; guardar só no fim faria
  // uma queda no 55º jogar fora o trabalho dos 54 anteriores.
  await gravarDocumentos();

  if (n < alvos.length - 1) await pausa(PAUSA_ENTRE_SINDICATOS);
}

await navegador.close();

/**
 * Marca como "saiu de vigência" os documentos que estavam no arquivo e não voltaram
 * nesta rodada.
 *
 * A regra que importa: isso só vale para sindicato cuja consulta RESPONDEU. Se a
 * busca falhou, não sabemos nada sobre ele — e concluir "sumiu" a partir de uma
 * falha apagaria dado bom por causa de instabilidade do MTE. Nesse caso os
 * documentos ficam como estão, e a falha aparece no painel.
 *
 * Nada é removido do arquivo: o histórico continua lá, só deixa de contar como vigente.
 */
const saiuDeVigencia = [];
if (!sigla && !limite) {
  for (const d of porSolicitacao.values()) {
    if (!consultadosComSucesso.has(d.sindicato_id)) continue;
    if (vistosNestaRodada.has(d.nr_solicitacao)) {
      if (d.vigente === false) delete d.saiu_de_vigencia_em;
      d.vigente = true;
      continue;
    }
    if (d.vigente !== false) {
      d.vigente = false;
      d.saiu_de_vigencia_em = hoje;
      saiuDeVigencia.push(d);
    }
  }
} else {
  console.log('(rodada parcial: --sigla/--limite não marcam saída de vigência)');
}

const documentos = await gravarDocumentos();

const execucoes = await lerJson('data/execucoes.json', []);
const registro = {
  data: new Date().toISOString(),
  estagio: 'busca-mediador',
  tipo: tipoArg,
  vigencia: vigenciaArg,
  sindicatos_alvo: alvos.length,
  sindicatos_consultados: consultados,
  sem_cnpj_valido: semCnpj,
  sem_instrumento: semInstrumento,
  documentos_novos: novos,
  documentos_que_sairam_de_vigencia: saiuDeVigencia.length,
  documentos_total: documentos.length,
  documentos_vigentes: documentos.filter((d) => d.vigente !== false).length,
  duracao_segundos: Math.round((Date.now() - inicio) / 1000),
  falhas
};
await writeFile(
  'data/execucoes.json',
  JSON.stringify([registro, ...(Array.isArray(execucoes) ? execucoes : [])], null, 2) + '\n',
  'utf8'
);

console.log('\n─────────────────────────────────────────');
console.log(`consultados .......... ${consultados}/${alvos.length}`);
console.log(`sem CNPJ válido ...... ${semCnpj}`);
console.log(`sem instrumento ...... ${semInstrumento}`);
console.log(`documentos novos ..... ${novos}`);
console.log(`saíram de vigência ... ${saiuDeVigencia.length}`);
console.log(`vigentes agora ....... ${documentos.filter((d) => d.vigente !== false).length}`);
console.log(`no arquivo (histórico) ${documentos.length}`);
console.log(`duração .............. ${registro.duracao_segundos}s`);

if (falhas.length) {
  console.log(`\nFALHAS (${falhas.length}) — registradas em data/execucoes.json:`);
  for (const f of falhas) console.log(`  ${String(f.sigla).padEnd(24)} ${f.motivo}`);
  console.log('\nRodada com falha não é rodada concluída. Reveja antes de confiar no painel.');
  process.exit(1);
}

console.log('\nSem falhas. Próximo passo: npm run coletar');

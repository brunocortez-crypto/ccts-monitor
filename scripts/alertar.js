/**
 * Monta o aviso da rodada: o que apareceu de novo e o que está vencendo.
 *
 * O sistema já descobria convenção nova sozinho e ninguém ficava sabendo até
 * alguém abrir o painel. Descobrir sem avisar é meio caminho.
 *
 * Escreve Markdown em data/alerta.md e imprime na saída padrão. Quem entrega é o
 * workflow: abre uma issue no GitHub, e o GitHub manda o e-mail para quem
 * acompanha o repositório. Assim não precisa de servidor de e-mail nem de senha
 * guardada em lugar nenhum.
 *
 * Uso:
 *   node scripts/alertar.js                 (janela padrão de 60 dias)
 *   node scripts/alertar.js --dias 90
 *   node scripts/alertar.js --desde 2026-09-17
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SAIDA = 'data/alerta.md';
const DIA = 86400000;

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const janela = Number(argumento('dias', 60)) || 60;
const hoje = new Date();
const hojeIso = hoje.toISOString().slice(0, 10);
const desde = argumento('desde', new Date(hoje - DIA).toISOString().slice(0, 10));

async function ler(caminho, padrao) {
  if (!existsSync(caminho)) return padrao;
  try {
    const j = JSON.parse(await readFile(caminho, 'utf8'));
    return Array.isArray(j) ? j : padrao;
  } catch {
    return padrao;
  }
}

const documentos = await ler('data/documentos.json', []);
const sindicatos = await ler('data/sindicatos.json', []);
const execucoes = await ler('data/execucoes.json', []);
const divergencias = await ler('data/divergencias.json', []);

const porId = new Map(sindicatos.map((s) => [s.id, s]));
const dataBr = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

function diasAteVencer(d) {
  if (!d.vigencia_fim) return null;
  return Math.round((new Date(d.vigencia_fim + 'T00:00:00') -
    new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / DIA);
}

const novos = documentos.filter((d) => d.descoberto_em && d.descoberto_em >= desde);

const vencendo = documentos
  .map((d) => ({ d, dias: diasAteVencer(d) }))
  .filter((x) => x.dias !== null && x.dias <= janela)
  .sort((a, b) => a.dias - b.dias);

// Falhas da rodada mais recente de CADA estágio, com a data dela.
//
// Sem a data, uma falha de ontem entra no aviso de hoje como se fosse de hoje —
// e quem le sai procurando um problema que ja foi visto. As de hoje sao o alerta;
// as anteriores continuam listadas, mas como pendencia datada.
const ultimaPorEstagio = new Map();
for (const e of execucoes) {
  if (!ultimaPorEstagio.has(e.estagio)) ultimaPorEstagio.set(e.estagio, e);
}
const todasFalhas = [...ultimaPorEstagio.values()].flatMap((e) =>
  (e.falhas || []).map((f) => ({ ...f, estagio: e.estagio, quando: e.data.slice(0, 10) })));

const falhas = todasFalhas.filter((f) => f.quando >= desde);
const pendencias = todasFalhas.filter((f) => f.quando < desde);

const porConferir = divergencias.filter((d) => !d.conferido);

const linhas = [];
const L = (t = '') => linhas.push(t);

const temNovidade = novos.length > 0;
const temUrgencia = vencendo.some((x) => x.dias <= 30);

L(`# Monitor de CCTs — ${dataBr(hojeIso)}`);
L();

if (!temNovidade && !vencendo.length && !falhas.length && !porConferir.length) {
  L('Nada a reportar: nenhuma convenção nova, nada vencendo na janela, sem falhas.');
  L();
  L('_Rodada sem achado é resultado. Rodada com falha é outra coisa, e apareceria aqui._');
} else {
  L('| | |');
  L('|---|---|');
  L(`| Convenções novas desde ${dataBr(desde)} | **${novos.length}** |`);
  L(`| Vencendo em até ${janela} dias | **${vencendo.length}** |`);
  L(`| Divergências a conferir | ${porConferir.length} |`);
  L(`| Falhas nesta rodada | ${falhas.length} |`);
  if (pendencias.length) L(`| Pendências de rodadas anteriores | ${pendencias.length} |`);
  L();
}

if (novos.length) {
  L(`## Convenções novas (${novos.length})`);
  L();
  // Detalhar 15 ja da o recado; a lista inteira esta no painel. Um aviso com 87
  // blocos ninguem le ate o fim, e o que importa fica escondido no meio.
  if (novos.length > 15) {
    L(`_Detalhando as 15 primeiras. As ${novos.length} estão no painel._`);
    L();
  }
  for (const d of novos.slice(0, 15)) {
    const s = porId.get(d.sindicato_id);
    const piso = d.indicadores?.piso_mensal;
    const reajuste = d.indicadores?.reajuste?.[0]?.valor;
    L(`### ${d.sindicato_sigla} — ${d.nr_registro_mte}`);
    L(`- Vigência: ${dataBr(d.vigencia_inicio)} a ${dataBr(d.vigencia_fim)}`);
    if (s) L(`- Data-base: ${(s.data_bases || []).map((x) => x.mes).join(', ') || '—'}`);
    if (piso) L(`- Piso: R$ ${piso}`);
    if (reajuste) L(`- Reajuste: ${reajuste}%`);
    L(`- Partes: ${(d.partes || []).join(' × ')}`);
    L();
  }
}

if (vencendo.length) {
  L(`## Vencendo em até ${janela} dias`);
  L();
  L('| Sindicato | Registro | Vence em | Data | Piso |');
  L('|---|---|---|---|---|');
  for (const { d, dias } of vencendo.slice(0, 25)) {
    const prazo = dias < 0 ? `venceu há ${Math.abs(dias)}d`
      : dias === 0 ? 'hoje' : `${dias} dias`;
    const destaque = dias <= 30 ? '**' : '';
    L(`| ${d.sindicato_sigla} | ${d.nr_registro_mte} | ${destaque}${prazo}${destaque} | ` +
      `${dataBr(d.vigencia_fim)} | ${d.indicadores?.piso_mensal ? 'R$ ' + d.indicadores.piso_mensal : '—'} |`);
  }
  if (vencendo.length > 25) L(`\n_… mais ${vencendo.length - 25}._`);
  L();
}

if (porConferir.length) {
  L('## Publicado no site, sem registro no MTE');
  L();
  for (const d of porConferir) {
    L(`- **${d.sigla}** — ${d.descricao}`);
    for (const l of (d.links || []).slice(0, 2)) L(`  - ${l.url}`);
  }
  L();
}

function listarFalhas(titulo, lista, nota) {
  if (!lista.length) return;
  L(`## ${titulo}`);
  L();
  if (nota) { L(nota); L(); }
  for (const f of lista.slice(0, 20)) {
    L(`- \`${f.estagio}\` (${dataBr(f.quando)}) — ` +
      `${f.sigla ?? f.nr_solicitacao ?? f.periodo ?? '?'}: ${f.motivo}`);
  }
  if (lista.length > 20) {
    L();
    L(`_… mais ${lista.length - 20}._`);
  }
  L();
}

listarFalhas('Falhas nesta rodada', falhas,
  '_Enquanto houver falha, o retrato está incompleto: o estado desses é' +
  ' desconhecido, não "em dia"._');

listarFalhas('Pendências de rodadas anteriores', pendencias,
  '_Não são de hoje. Continuam aqui porque ninguém resolveu ainda._');

L('---');
L();
L('Painel: https://ccts-monitor.vercel.app');

const markdown = linhas.join('\n') + '\n';
await mkdir('data', { recursive: true });
await writeFile(SAIDA, markdown, 'utf8');

// O workflow le estes valores para decidir se abre a issue e com que titulo.
const titulo = temNovidade
  ? `${novos.length} convenção(ões) nova(s) — ${dataBr(hojeIso)}`
  : temUrgencia
    ? `Convenção vencendo em menos de 30 dias — ${dataBr(hojeIso)}`
    : falhas.length
      ? `Rodada com ${falhas.length} falha(s) — ${dataBr(hojeIso)}`
      : `Sem novidades — ${dataBr(hojeIso)}`;

const vale = temNovidade || temUrgencia || falhas.length > 0;

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `avisar=${vale}\ntitulo=${titulo}\n`);
}

console.log(markdown);
console.error(`\n[alertar] ${vale ? 'VALE avisar' : 'nada urgente'} — "${titulo}"`);

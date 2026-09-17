/**
 * ESTÁGIO 3 — sites dos sindicatos.
 *
 * Existe porque o sindicato às vezes publica a CCT no próprio site antes de
 * homologar no MTE — ou publica algo que nunca é homologado. Esse descompasso é
 * o que o escritório precisa enxergar.
 *
 * O que este script NÃO faz: afirmar que achou uma CCT. Cada site tem um layout.
 * Ele levanta CANDIDATOS (links que cheiram a convenção do ano corrente) e marca
 * divergência para conferência humana. Chute apresentado como certeza seria pior
 * que não ter o estágio.
 *
 * Uso:  node scripts/verificar-sites.js [--limite N] [--ano 2026]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CABECALHOS_HTTP, pausa } from './lib/mediador.js';
import { decodificarEntidades } from './lib/extrair.js';

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}
const limite = Number(argumento('limite', 0)) || 0;
const ano = Number(argumento('ano', new Date().getFullYear()));
const PAUSA_ENTRE = 1500;

const RE_INTERESSE = /conven[çc][ãa]o|acordo\s+coletivo|\bcct\b|\bact\b|instrumento\s+coletivo|piso\s+salarial|campanha\s+salarial/i;
const RE_DOCUMENTO = /\.(pdf|docx?|odt)(\?|$)/i;

if (!existsSync('data/sindicatos.json')) {
  console.error('data/sindicatos.json não existe. Rode antes: npm run importar');
  process.exit(1);
}
const sindicatos = JSON.parse(await readFile('data/sindicatos.json', 'utf8'));
const documentos = existsSync('data/documentos.json')
  ? JSON.parse(await readFile('data/documentos.json', 'utf8')) : [];

const comSite = sindicatos.filter((s) => s.site);
const alvos = limite ? comSite.slice(0, limite) : comSite;

console.log(`Sites — ${alvos.length} de ${sindicatos.length} sindicato(s) têm site na planilha`);
console.log(`Procurando referências a ${ano}\n`);

function extrairLinks(html, urlBase) {
  const achados = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const rotulo = decodificarEntidades(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;

    const alvo = `${rotulo} ${href}`;
    if (!RE_INTERESSE.test(alvo)) continue;

    let absoluta;
    try {
      absoluta = new URL(href, urlBase).href;
    } catch {
      continue;
    }

    achados.push({
      url: absoluta,
      rotulo: rotulo.slice(0, 160) || '(sem texto)',
      e_arquivo: RE_DOCUMENTO.test(absoluta),
      menciona_ano: new RegExp(String(ano)).test(alvo)
    });
  }

  const vistos = new Set();
  return achados.filter((a) => (vistos.has(a.url) ? false : vistos.add(a.url)));
}

const resultados = [];
const falhas = [];
const inicio = Date.now();

for (const [n, s] of alvos.entries()) {
  const rotulo = `[${String(n + 1).padStart(2)}/${alvos.length}] ${String(s.sigla).padEnd(24).slice(0, 24)}`;

  try {
    const resp = await fetch(s.site, {
      headers: CABECALHOS_HTTP,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const tipo = resp.headers.get('content-type') || '';
    if (!/text\/html/i.test(tipo)) throw new Error(`Content-Type ${tipo}`);

    const html = await resp.text();
    const links = extrairLinks(html, resp.url);
    const doAno = links.filter((l) => l.menciona_ano);
    const arquivos = links.filter((l) => l.e_arquivo);

    resultados.push({
      sindicato_id: s.id,
      sigla: s.sigla,
      site: s.site,
      url_final: resp.url,
      verificado_em: new Date().toISOString(),
      status: 'ok',
      total_links_relevantes: links.length,
      links: links.slice(0, 30),
      candidatos_do_ano: doAno.length,
      arquivos_encontrados: arquivos.length
    });

    console.log(
      `${rotulo} ${String(links.length).padStart(3)} link(s) relevante(s)` +
      `${doAno.length ? `, ${doAno.length} citando ${ano}` : ''}` +
      `${arquivos.length ? `, ${arquivos.length} arquivo(s)` : ''}`
    );
  } catch (erro) {
    const motivo = erro.name === 'TimeoutError' ? 'tempo esgotado' : erro.message;
    console.log(`${rotulo} FALHOU: ${motivo}`);
    resultados.push({
      sindicato_id: s.id, sigla: s.sigla, site: s.site,
      verificado_em: new Date().toISOString(), status: 'falha', motivo
    });
    falhas.push({ sigla: s.sigla, site: s.site, motivo });
  }

  if (n < alvos.length - 1) await pausa(PAUSA_ENTRE);
}

// Divergência: o site tem candidato do ano corrente e o MTE não tem nada
// registrado com vigência que alcance o ano. Sinal para conferir, não veredito.
const porSindicato = new Map();
for (const d of documentos) {
  if (!porSindicato.has(d.sindicato_id)) porSindicato.set(d.sindicato_id, []);
  porSindicato.get(d.sindicato_id).push(d);
}

const divergencias = [];
for (const r of resultados) {
  if (r.status !== 'ok') continue;
  const noMte = porSindicato.get(r.sindicato_id) ?? [];
  const mteAlcancaAno = noMte.some((d) => {
    const fim = d.vigencia_fim || '';
    const ini = d.vigencia_inicio || '';
    return fim.slice(0, 4) >= String(ano) || ini.slice(0, 4) === String(ano);
  });

  if (r.candidatos_do_ano > 0 && !mteAlcancaAno) {
    divergencias.push({
      sindicato_id: r.sindicato_id,
      sigla: r.sigla,
      tipo: 'no-site-sem-registro-no-mte',
      descricao: `site cita ${ano} mas o Mediador não tem instrumento vigente alcançando ${ano}`,
      documentos_no_mte: noMte.length,
      links: r.links.filter((l) => l.menciona_ano).slice(0, 5),
      detectado_em: new Date().toISOString().slice(0, 10),
      conferido: false
    });
  }
}

await writeFile('data/sites.json', JSON.stringify(resultados, null, 2) + '\n', 'utf8');
await writeFile('data/divergencias.json', JSON.stringify(divergencias, null, 2) + '\n', 'utf8');

const execucoes = existsSync('data/execucoes.json')
  ? JSON.parse(await readFile('data/execucoes.json', 'utf8')) : [];
await writeFile('data/execucoes.json', JSON.stringify([{
  data: new Date().toISOString(),
  estagio: 'verificar-sites',
  ano_procurado: ano,
  sites_alvo: alvos.length,
  sites_ok: resultados.filter((r) => r.status === 'ok').length,
  divergencias: divergencias.length,
  duracao_segundos: Math.round((Date.now() - inicio) / 1000),
  falhas
}, ...execucoes], null, 2) + '\n', 'utf8');

console.log('\n─────────────────────────────────────────');
console.log(`sites acessíveis ......... ${resultados.filter((r) => r.status === 'ok').length}/${alvos.length}`);
console.log(`sem site na planilha ..... ${sindicatos.length - comSite.length}`);
console.log(`divergências a conferir .. ${divergencias.length}`);

if (divergencias.length) {
  console.log('\nPara conferir na mão (site cita o ano, MTE não tem registro):');
  for (const d of divergencias) console.log(`  ${String(d.sigla).padEnd(24)} ${d.links[0]?.url ?? ''}`);
}
if (falhas.length) {
  console.log(`\nSites inacessíveis (${falhas.length}) — em data/execucoes.json:`);
  for (const f of falhas) console.log(`  ${String(f.sigla).padEnd(24)} ${f.motivo}`);
}
console.log('');

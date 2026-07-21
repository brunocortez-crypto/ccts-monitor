#!/usr/bin/env node
/**
 * CCT MONITOR v3.0 — BUSCA AGRESSIVA
 * 1. DuckDuckGo (internet completa, sem API key)
 * 2. Crawling profundo: homepage + páginas internas dos sites
 * 3. MTE/Mediador via busca dirigida
 * 4. Download de PDFs + extração de texto + RESUMO automático
 */
const fs = require('fs');
const path = require('path');

// ===== ENCONTRAR PASTA DATA =====
let DATA_DIR = null;
for (const dir of [
  path.join(process.cwd(), 'data'),
  path.join(__dirname, '..', 'data'),
  path.join(__dirname, '..', '..', 'data')
]) {
  if (fs.existsSync(dir)) { DATA_DIR = dir; break; }
}
if (!DATA_DIR) { console.error('❌ Pasta data não encontrada'); process.exit(1); }
console.log(`✅ Pasta data: ${DATA_DIR}\n`);

const ARQ_SIND = path.join(DATA_DIR, 'sindicatos.json');
const ARQ_ACHADOS = path.join(DATA_DIR, 'ccts-encontradas.json');
const ARQ_LOG = path.join(DATA_DIR, 'log-execucoes.json');

const ANO = new Date().getFullYear();
const TIMEOUT = 25000;
const MAX_PDF_RESUMO = 25; // máx de PDFs para baixar e resumir por execução
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function carregar(a, p) { try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch { return p; } }
function salvar(a, d) { fs.writeFileSync(a, JSON.stringify(d, null, 2), 'utf8'); }

async function fetchTexto(url, tipo = 'text') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return tipo === 'buffer' ? Buffer.from(await resp.arrayBuffer()) : await resp.text();
  } catch { clearTimeout(timer); return null; }
}

function absolutizar(href, base) {
  try {
    if (href.startsWith('http')) return href;
    const u = new URL(base);
    if (href.startsWith('//')) return u.protocol + href;
    if (href.startsWith('/')) return u.origin + href;
    return base.replace(/\/[^/]*$/, '/') + href;
  } catch { return null; }
}

const RE_RELEVANTE = /(cct|conven[cç][aã]o|acordo\s*coletivo|dissidio|diss[ií]dio|reajuste|negocia[cç][aã]o|piso|salarial)/i;

// ===== FONTE 1: DUCKDUCKGO (internet completa, grátis) =====
async function buscarDuckDuckGo(query) {
  const resultados = [];
  const html = await fetchTexto('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  if (!html) return resultados;
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null && resultados.length < 6) {
    let url = m[1];
    // DuckDuckGo usa redirect uddg=
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    const titulo = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (url.startsWith('http') && !url.includes('duckduckgo.com')) {
      resultados.push({ titulo: titulo.substring(0, 160), url, resumo: 'Encontrado via busca na internet (DuckDuckGo)' });
    }
  }
  return resultados;
}

// ===== FONTE 2: CRAWLING PROFUNDO DO SITE =====
function extrairLinks(html, baseUrl) {
  const links = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = absolutizar(m[1], baseUrl);
    if (!url) continue;
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ url, texto });
  }
  return links;
}

async function rasparSiteProfundo(urlSite) {
  const achados = [];
  const html = await fetchTexto(urlSite);
  if (!html) return achados;

  const vistos = new Set();
  const linksHome = extrairLinks(html, urlSite);

  const coletar = (links, origem) => {
    for (const l of links) {
      const ehPdf = /\.pdf(\?|$)/i.test(l.url);
      const rel = RE_RELEVANTE.test(l.url + ' ' + l.texto);
      const temAno = new RegExp(`${ANO}|${ANO - 1}|${ANO + 1}`).test(l.url + ' ' + l.texto);
      if ((ehPdf && (rel || temAno)) || (rel && temAno)) {
        if (!vistos.has(l.url) && achados.length < 30) {
          vistos.add(l.url);
          achados.push({
            titulo: l.texto.substring(0, 160) || (ehPdf ? 'PDF de CCT' : 'Página sobre CCT'),
            url: l.url,
            resumo: origem,
            ehPdf
          });
        }
      }
    }
  };

  coletar(linksHome, 'Encontrado no site do sindicato');

  // NÍVEL 2: entrar em páginas internas relevantes (convenções, documentos, notícias...)
  const paginasInternas = linksHome
    .filter(l => /(conven|cct|documento|acordo|negocia|noticia|informativo|download|arquivo)/i.test(l.url + ' ' + l.texto))
    .filter(l => { try { return new URL(l.url).hostname === new URL(urlSite).hostname; } catch { return false; } })
    .slice(0, 5);

  for (const pag of paginasInternas) {
    const htmlInt = await fetchTexto(pag.url);
    if (htmlInt) coletar(extrairLinks(htmlInt, pag.url), 'Encontrado em página interna: ' + pag.texto.substring(0, 40));
    await sleep(200);
  }

  return achados;
}

// ===== RESUMO AUTOMÁTICO DO PDF =====
let pdfParse = null;
try { pdfParse = require('pdf-parse'); console.log('✅ pdf-parse carregado (resumos ativados)\n'); }
catch { console.log('⚠️ pdf-parse não instalado — resumos desativados\n'); }

function gerarResumo(texto) {
  const t = texto.replace(/\s+/g, ' ');
  const partes = [];

  const vig = t.match(/vig[êe]ncia[^.]{0,120}?(\d{2}\/\d{2}\/\d{4})[^.]{0,40}?(\d{2}\/\d{2}\/\d{4})/i);
  if (vig) partes.push(`📅 Vigência: ${vig[1]} a ${vig[2]}`);

  const db = t.match(/data[- ]base[^.]{0,60}?(\d{1,2}[ºo°]?\s*(de\s*)?[a-zç]+)/i);
  if (db) partes.push(`🗓️ Data-base: ${db[1]}`);

  const pisos = [...t.matchAll(/R\$\s*([\d.]{3,10},\d{2})/g)].slice(0, 5).map(x => 'R$ ' + x[1]);
  if (pisos.length) partes.push(`💰 Valores citados: ${[...new Set(pisos)].join(' | ')}`);

  const reaj = t.match(/reajuste[^.]{0,80}?([\d,.]+)\s*%/i);
  if (reaj) partes.push(`📈 Reajuste: ${reaj[1]}%`);

  const beneficios = [];
  if (/vale[- ]?refei[çc][ãa]o|ticket/i.test(t)) beneficios.push('Vale-refeição');
  if (/vale[- ]?alimenta[çc][ãa]o|cesta b[áa]sica/i.test(t)) beneficios.push('Vale-alimentação/cesta');
  if (/plano de sa[úu]de|assist[êe]ncia m[ée]dica/i.test(t)) beneficios.push('Plano de saúde');
  if (/seguro de vida/i.test(t)) beneficios.push('Seguro de vida');
  if (/participa[çc][ãa]o nos (lucros|resultados)|plr/i.test(t)) beneficios.push('PLR');
  if (/adicional noturno/i.test(t)) beneficios.push('Adicional noturno');
  if (/hora extra/i.test(t)) beneficios.push('Horas extras');
  if (beneficios.length) partes.push(`🎁 Benefícios: ${beneficios.join(', ')}`);

  const homolog = t.match(/(MR\d{6}\/\d{4}|n[úu]mero\s*(de)?\s*registro[^.]{0,40}?\d{3,})/i);
  if (homolog) partes.push(`🔖 Registro: ${homolog[1]}`);

  return partes.length ? partes.join('\n') : null;
}

async function resumirPdf(url) {
  if (!pdfParse) return null;
  try {
    const buf = await fetchTexto(url, 'buffer');
    if (!buf || buf.length < 1000 || buf.length > 15 * 1024 * 1024) return null;
    const dados = await pdfParse(buf, { max: 20 });
    if (!dados.text || dados.text.length < 200) return null;
    return gerarResumo(dados.text);
  } catch { return null; }
}

function extrairDados(texto) {
  const dados = {};
  const piso = texto.match(/piso\s*(salarial)?\s*(de)?\s*:?\s*R?\$?\s*([\d.,]+)/i);
  if (piso) dados.piso = 'R$ ' + piso[3];
  const reajuste = texto.match(/reajuste\s*(de)?\s*:?\s*([\d.,]+)\s*%/i);
  if (reajuste) dados.reajuste = reajuste[2] + '%';
  return dados;
}

// ===== PRINCIPAL =====
(async () => {
  console.log('🔥 CCT Monitor v3.0 — BUSCA AGRESSIVA iniciada');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);

  const sindicatos = carregar(ARQ_SIND, []);
  const achadosAnteriores = carregar(ARQ_ACHADOS, []);
  const urlsConhecidas = new Set(achadosAnteriores.map(a => a.url));
  const novos = [];

  console.log(`📊 Sindicatos: ${sindicatos.length} | Achados anteriores: ${achadosAnteriores.length}\n`);

  let i = 0;
  for (const s of sindicatos) {
    i++;
    const nome = s.sigla || s.nome;
    console.log(`[${i}/${sindicatos.length}] 🔍 ${nome}`);
    const resultados = [];

    // 1. DuckDuckGo internet completa
    const q1 = await buscarDuckDuckGo(`CCT convenção coletiva ${ANO} "${nome}"`);
    q1.forEach(r => resultados.push({ ...r, fonte: 'Internet (DuckDuckGo)' }));
    await sleep(600);

    // 2. DuckDuckGo dirigido ao MTE/Mediador
    const q2 = await buscarDuckDuckGo(`"${nome}" convenção coletiva site:mte.gov.br OR site:sistemas.mte.gov.br ${ANO}`);
    q2.forEach(r => resultados.push({ ...r, fonte: 'MTE/Mediador' }));
    await sleep(600);

    // 3. Crawling profundo do site do sindicato
    if (s.link) {
      const q3 = await rasparSiteProfundo(s.link);
      q3.forEach(r => resultados.push({ ...r, fonte: 'Site do sindicato' }));
      await sleep(300);
    }

    for (const r of resultados) {
      if (!urlsConhecidas.has(r.url)) {
        urlsConhecidas.add(r.url);
        const extra = extrairDados(r.titulo + ' ' + (r.resumo || ''));
        novos.push({
          id: 'achado_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          sindicatoId: s.id,
          sindicato: nome,
          categoria: s.categoria || 'Geral',
          mesBase: s.mesBase,
          titulo: r.titulo,
          url: r.url,
          resumo: r.resumo,
          fonte: r.fonte,
          ehPdf: r.ehPdf || /\.pdf(\?|$)/i.test(r.url),
          ...extra,
          dataDescoberta: new Date().toISOString().slice(0, 10),
          status: 'Revisar'
        });
        console.log(`   ✅ NOVO [${r.fonte}]: ${r.titulo.substring(0, 55)}`);
      }
    }
  }

  // ===== RESUMIR PDFs NOVOS =====
  const pdfsNovos = novos.filter(n => n.ehPdf).slice(0, MAX_PDF_RESUMO);
  if (pdfsNovos.length && pdfParse) {
    console.log(`\n📄 Gerando resumos de ${pdfsNovos.length} PDF(s)...`);
    for (const n of pdfsNovos) {
      const resumoCct = await resumirPdf(n.url);
      if (resumoCct) {
        n.resumoCct = resumoCct;
        console.log(`   📝 Resumo gerado: ${n.titulo.substring(0, 50)}`);
      }
      await sleep(400);
    }
  }

  const todosAchados = [...novos, ...achadosAnteriores].slice(0, 800);
  salvar(ARQ_ACHADOS, todosAchados);

  const logs = carregar(ARQ_LOG, []);
  logs.unshift({
    data: new Date().toISOString(),
    versao: '3.0-agressiva',
    sindicatosVerificados: sindicatos.length,
    novosAchados: novos.length,
    resumosGerados: novos.filter(n => n.resumoCct).length,
    totalAcumulado: todosAchados.length
  });
  salvar(ARQ_LOG, logs.slice(0, 60));

  console.log(`\n🏁 Concluído! ${novos.length} novo(s) achado(s), ${novos.filter(n => n.resumoCct).length} resumo(s) de CCT.`);
})();

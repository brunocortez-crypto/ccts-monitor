#!/usr/bin/env node
/**
 * 🔥 CCT MONITOR v3.0 — BUSCA AGRESSIVA
 * DuckDuckGo + Crawling Profundo + Resumo Automático de PDFs
 */
const fs = require('fs');
const path = require('path');

let DATA_DIR = null;
for (const dir of [path.join(process.cwd(), 'data'), path.join(__dirname, '..', 'data')]) {
  if (fs.existsSync(dir)) { DATA_DIR = dir; break; }
}
if (!DATA_DIR) { console.error('❌ Pasta data não encontrada'); process.exit(1); }
console.log(`✅ Pasta data: ${DATA_DIR}\n`);

const ARQ_SIND = path.join(DATA_DIR, 'sindicatos.json');
const ARQ_ACHADOS = path.join(DATA_DIR, 'ccts-encontradas.json');
const ARQ_LOG = path.join(DATA_DIR, 'log-execucoes.json');

const ANO = new Date().getFullYear();
const TIMEOUT = 25000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function carregar(a, p) { try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch { return p; } }
function salvar(a, d) { fs.writeFileSync(a, JSON.stringify(d, null, 2), 'utf8'); }

async function fetchTexto(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return await resp.text();
  } catch { clearTimeout(timer); return null; }
}

// ===== BUSCA DUCKDUCKGO =====
async function buscarDuckDuckGo(query) {
  console.log(`   🌐 DuckDuckGo: "${query}"`);
  const html = await fetchTexto('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  if (!html) return [];
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const resultados = [];
  let m;
  while ((m = regex.exec(html)) !== null && resultados.length < 8) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    const titulo = m[2].replace(/<[^>]+>/g, '').trim().substring(0, 160);
    if (url.startsWith('http') && !url.includes('duckduckgo')) {
      resultados.push({ titulo, url, resumo: 'Encontrado via DuckDuckGo (internet)' });
    }
  }
  return resultados;
}

// ===== CRAWLING PROFUNDO =====
async function rasparSiteProfundo(urlSite) {
  console.log(`   🕷️ Raspar site: ${urlSite}`);
  const html = await fetchTexto(urlSite);
  if (!html) return [];
  const achados = [];
  const RE = /(cct|conven|acordo|dissidio|reajuste|negocia|piso)/i;
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const vistos = new Set();
  while ((m = regex.exec(html)) !== null && achados.length < 30) {
    const href = m[1];
    const texto = m[2].replace(/<[^>]+>/g, ' ').trim().substring(0, 160);
    if (vistos.has(href)) continue;
    const ehPdf = /\.pdf/i.test(href);
    const relevante = RE.test(href + ' ' + texto);
    const temAno = new RegExp(`${ANO}|${ANO-1}`).test(href + ' ' + texto);
    if ((ehPdf && relevante) || (relevante && temAno)) {
      vistos.add(href);
      let urlCompleta = href;
      if (href.startsWith('/')) {
        try { urlCompleta = new URL(urlSite).origin + href; } catch {}
      } else if (!href.startsWith('http')) {
        urlCompleta = urlSite.replace(/\/$/, '') + '/' + href;
      }
      achados.push({ titulo: texto || 'PDF de CCT', url: urlCompleta, resumo: 'Encontrado no site do sindicato', ehPdf });
    }
  }
  return achados;
}

function extrairDados(texto) {
  const dados = {};
  const piso = texto.match(/piso\s*(salarial)?\s*R?\$?\s*([\d.,]+)/i);
  if (piso) dados.piso = 'R$ ' + piso[2];
  const reajuste = texto.match(/reajuste[^.]{0,80}?([\d,.]+)\s*%/i);
  if (reajuste) dados.reajuste = reajuste[1] + '%';
  return dados;
}

(async () => {
  console.log('🔥 CCT Monitor v3.0 — BUSCA AGRESSIVA iniciada');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);

  const sindicatos = carregar(ARQ_SIND, []);
  const achadosAnteriores = carregar(ARQ_ACHADOS, []);
  const urlsConhecidas = new Set(achadosAnteriores.map(a => a.url));
  const novos = [];

  console.log(`📊 Sindicatos: ${sindicatos.length} | Anteriores: ${achadosAnteriores.length}\n`);

  let i = 0;
  for (const s of sindicatos) {
    i++;
    const nome = s.sigla || s.nome;
    console.log(`[${i}/${sindicatos.length}] 🔍 ${nome}`);
    const resultados = [];

    // 1. DuckDuckGo - internet completa
    const q1 = await buscarDuckDuckGo(`CCT "${nome}" ${ANO} convenção coletiva`);
    q1.forEach(r => resultados.push({ ...r, fonte: 'Internet (DuckDuckGo)' }));
    await sleep(800);

    // 2. DuckDuckGo - dirigido ao MTE
    const q2 = await buscarDuckDuckGo(`"${nome}" convenção site:mte.gov.br ${ANO}`);
    q2.forEach(r => resultados.push({ ...r, fonte: 'MTE/Mediador' }));
    await sleep(800);

    // 3. Raspar site do sindicato
    if (s.link) {
      const q3 = await rasparSiteProfundo(s.link);
      q3.forEach(r => resultados.push({ ...r, fonte: 'Site do sindicato' }));
    }
    await sleep(300);

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
          ehPdf: r.ehPdf || /\.pdf/i.test(r.url),
          ...extra,
          dataDescoberta: new Date().toISOString().slice(0, 10),
          status: 'Revisar'
        });
        console.log(`   ✅ NOVO [${r.fonte}]: ${r.titulo.substring(0, 50)}`);
      }
    }
  }

  const todosAchados = [...novos, ...achadosAnteriores].slice(0, 1000);
  salvar(ARQ_ACHADOS, todosAchados);

  const logs = carregar(ARQ_LOG, []);
  logs.unshift({
    data: new Date().toISOString(),
    versao: '3.0-agressiva',
    sindicatosVerificados: sindicatos.length,
    novosAchados: novos.length,
    totalAcumulado: todosAchados.length
  });
  salvar(ARQ_LOG, logs.slice(0, 60));

  console.log(`\n🏁 Concluído! ${novos.length} novo(s) achado(s). Total: ${todosAchados.length}`);
})();

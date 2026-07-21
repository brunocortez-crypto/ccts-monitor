#!/usr/bin/env node
/**
 * BOT DE BUSCA AUTOMÁTICA DE CCTs — Grupo-E / Escritorial
 * Roda todo dia 20, 08:00 (BRT) via GitHub Actions.
 *
 * Fontes de busca (100% gratuitas):
 *   1. Google Custom Search API (100 buscas/dia grátis) — internet geral
 *   2. Google restrito ao Mediador/MTE (site:mte.gov.br)
 *   3. Scraping direto dos sites dos 63 sindicatos (procura PDFs/páginas de CCT)
 *
 * O bot compara com os achados anteriores e registra apenas o que é NOVO.
 * Se houver novidades e o Gmail estiver configurado, envia e-mail para a DP.
 */

const fs = require('fs');
const path = require('path');

const GOOGLE_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_CX = process.env.GOOGLE_CX || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
const EMAIL_DESTINO = process.env.EMAIL_DESTINO || '';

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARQ_SIND = path.join(DATA_DIR, 'sindicatos.json');
const ARQ_ACHADOS = path.join(DATA_DIR, 'ccts-encontradas.json');
const ARQ_LOG = path.join(DATA_DIR, 'log-execucoes.json');

const ANO = new Date().getFullYear();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function carregar(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

// ---------- 1. GOOGLE CUSTOM SEARCH (internet geral) ----------
async function buscarGoogle(query) {
  if (!GOOGLE_KEY || !GOOGLE_CX) return [];
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5&lr=lang_pt`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log(`   ⚠️ Google API ${resp.status} para: ${query}`);
      return [];
    }
    const json = await resp.json();
    return (json.items || []).map((it) => ({
      titulo: it.title,
      url: it.link,
      resumo: (it.snippet || '').substring(0, 250),
    }));
  } catch (e) {
    console.log(`   ⚠️ Erro Google: ${e.message}`);
    return [];
  }
}

// ---------- 2. SCRAPING DO SITE DO SINDICATO ----------
async function rasparSite(urlSite) {
  const achados = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(urlSite, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CCTMonitor/1.0)' },
    });
    clearTimeout(timer);
    if (!resp.ok) return achados;
    const html = await resp.text();

    // Procurar links <a href="..."> cujo href ou texto indique CCT/convenção/acordo
    const regexLink = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const palavras = /(cct|conven[cç][aã]o|acordo\s*coletivo|dissidio|diss[ií]dio|negocia[cç][aã]o\s*coletiva)/i;
    let m;
    while ((m = regexLink.exec(html)) !== null && achados.length < 10) {
      const href = m[1];
      const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const ehPdf = /\.pdf(\?|$)/i.test(href);
      const relevante = palavras.test(href) || palavras.test(texto);
      const mencionaAno = new RegExp(`${ANO}|${ANO + 1}`).test(href + ' ' + texto);
      if ((ehPdf && relevante) || (relevante && mencionaAno)) {
        let urlCompleta = href;
        if (href.startsWith('/')) {
          const base = new URL(urlSite);
          urlCompleta = base.origin + href;
        } else if (!href.startsWith('http')) {
          urlCompleta = urlSite.replace(/\/$/, '') + '/' + href;
        }
        achados.push({
          titulo: texto.substring(0, 150) || 'Documento CCT',
          url: urlCompleta,
          resumo: ehPdf ? 'PDF encontrado no site do sindicato' : 'Página sobre CCT no site do sindicato',
        });
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Site inacessível (${e.name === 'AbortError' ? 'timeout' : e.message})`);
  }
  return achados;
}

// ---------- EXTRAÇÃO BÁSICA DE DADOS (sem IA, via regex) ----------
function extrairDados(texto) {
  const dados = {};
  const piso = texto.match(/piso\s*(salarial)?\s*(de)?\s*:?\s*R?\$?\s*([\d.,]+)/i);
  if (piso) dados.piso = 'R$ ' + piso[3];
  const reajuste = texto.match(/reajuste\s*(de)?\s*:?\s*([\d.,]+)\s*%/i);
  if (reajuste) dados.reajuste = reajuste[2] + '%';
  return dados;
}

// ---------- EMAIL (opcional) ----------
async function enviarEmail(novos) {
  if (!GMAIL_USER || !GMAIL_PASS || !EMAIL_DESTINO) {
    console.log('📧 Email não configurado (opcional) — pulando.');
    return;
  }
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
    const linhas = novos
      .map((n) => `• [${n.sindicato}] ${n.titulo}\n  ${n.url}`)
      .join('\n\n');
    await transporter.sendMail({
      from: `"CCT Monitor Grupo-E" <${GMAIL_USER}>`,
      to: EMAIL_DESTINO,
      subject: `🔔 ${novos.length} novo(s) achado(s) de CCT — ${new Date().toLocaleDateString('pt-BR')}`,
      text: `O robô encontrou ${novos.length} novo(s) resultado(s) sobre CCTs:\n\n${linhas}\n\nAcesse o painel: https://ccts-monitor.vercel.app`,
    });
    console.log(`📧 Email enviado para ${EMAIL_DESTINO}`);
  } catch (e) {
    console.log(`⚠️ Falha no email: ${e.message}`);
  }
}

// ---------- PRINCIPAL ----------
(async () => {
  console.log('🤖 CCT Monitor — busca automática iniciada');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);

  const sindicatos = carregar(ARQ_SIND, []);
  const achadosAnteriores = carregar(ARQ_ACHADOS, []);
  const urlsConhecidas = new Set(achadosAnteriores.map((a) => a.url));
  const novos = [];

  console.log(`📊 Sindicatos a verificar: ${sindicatos.length}`);
  console.log(`📂 Achados anteriores: ${achadosAnteriores.length}\n`);

  let i = 0;
  for (const s of sindicatos) {
    i++;
    const nome = s.sigla || s.nome;
    console.log(`[${i}/${sindicatos.length}] 🔍 ${nome}`);

    const resultados = [];

    // FONTE 1: Google — internet geral
    const q1 = `CCT ${ANO} "${nome}" convenção coletiva de trabalho`;
    const r1 = await buscarGoogle(q1);
    r1.forEach((r) => resultados.push({ ...r, fonte: 'Google (internet)' }));
    await sleep(400);

    // FONTE 2: Google restrito ao MTE/Mediador
    const q2 = `${nome} convenção coletiva site:mte.gov.br OR site:gov.br mediador ${ANO}`;
    const r2 = await buscarGoogle(q2);
    r2.forEach((r) => resultados.push({ ...r, fonte: 'MTE/Mediador' }));
    await sleep(400);

    // FONTE 3: site do próprio sindicato
    if (s.link) {
      const r3 = await rasparSite(s.link);
      r3.forEach((r) => resultados.push({ ...r, fonte: 'Site do sindicato' }));
    }

    // Filtrar apenas o que é NOVO
    for (const r of resultados) {
      if (!urlsConhecidas.has(r.url)) {
        urlsConhecidas.add(r.url);
        const extra = extrairDados(r.titulo + ' ' + r.resumo);
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
          ...extra,
          dataDescoberta: new Date().toISOString().slice(0, 10),
          status: 'Revisar',
        });
        console.log(`   ✅ NOVO: ${r.titulo.substring(0, 70)}`);
      }
    }
  }

  // Salvar achados (novos no topo)
  const todosAchados = [...novos, ...achadosAnteriores].slice(0, 500);
  fs.writeFileSync(ARQ_ACHADOS, JSON.stringify(todosAchados, null, 2));

  // Log de execução
  const logs = carregar(ARQ_LOG, []);
  logs.unshift({
    data: new Date().toISOString(),
    sindicatosVerificados: sindicatos.length,
    novosAchados: novos.length,
    totalAcumulado: todosAchados.length,
  });
  fs.writeFileSync(ARQ_LOG, JSON.stringify(logs.slice(0, 60), null, 2));

  console.log(`\n🏁 Concluído! ${novos.length} novo(s) achado(s).`);

  if (novos.length > 0) await enviarEmail(novos);
})();

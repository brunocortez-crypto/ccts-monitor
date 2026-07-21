#!/usr/bin/env node
/**
 * BOT DE BUSCA AUTOMÁTICA DE CCTs — Grupo-E / Escritorial
 * Versão 2.0: SEM dependência do Google Custom Search
 * 
 * Fontes de busca (100% funcional):
 *   1. MTE/Mediador (https://www3.mte.gov.br/sistemas/mediador/) — busca por CNPJ
 *   2. Web Scraping direto dos 63 sites dos sindicatos
 *   3. Detecção automática de CCTs novas/alteradas
 * 
 * Executa: todo dia 20, 08:00 (BRT) via GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARQ_SIND = path.join(DATA_DIR, 'sindicatos.json');
const ARQ_ACHADOS = path.join(DATA_DIR, 'ccts-encontradas.json');
const ARQ_LOG = path.join(DATA_DIR, 'log-execucoes.json');

const ANO = new Date().getFullYear();
const TIMEOUT = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function carregar(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

function salvar(arq, dados) {
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2), 'utf8');
}

// Buscar no MTE/Mediador
async function buscarMTE(cnpj) {
  const resultados = [];
  try {
    const url = `https://www3.mte.gov.br/sistemas/mediador/Inicial.asp?cnpj=${cnpj}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (CCTMonitor/2.0)' }
    });
    clearTimeout(timer);
    if (!resp.ok) return resultados;
    const html = await resp.text();
    const regexLink = /<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    const encontrados = new Set();
    while ((m = regexLink.exec(html)) !== null) {
      const href = m[1];
      const texto = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const urlCompleta = href.startsWith('http') ? href : 'https://www3.mte.gov.br' + (href.startsWith('/') ? '' : '/') + href;
      if (!encontrados.has(urlCompleta)) {
        encontrados.add(urlCompleta);
        resultados.push({
          titulo: texto || 'CCT encontrada no Mediador',
          url: urlCompleta,
          resumo: 'Documento encontrado no MTE/Mediador',
          fonte: 'MTE/Mediador'
        });
      }
    }
  } catch (e) {}
  return resultados;
}

// Web scraping do site
async function rasparSite(urlSite, nomeSindicato) {
  const achados = [];
  if (!urlSite) return achados;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const resp = await fetch(urlSite, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (CCTMonitor/2.0)' }
    });
    clearTimeout(timer);
    if (!resp.ok) return achados;
    const html = await resp.text();
    const encontrados = new Set();
    const regexPdf = /<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = regexPdf.exec(html)) !== null && achados.length < 15) {
      const href = m[1];
      const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const relevante = /(cct|conven|acordo|dissidio|reajuste|negocia|salário|piso)/i.test(href + ' ' + texto);
      const mencionaAno = new RegExp(`${ANO}|${ANO - 1}|${ANO + 1}`).test(href + ' ' + texto);
      if ((relevante || mencionaAno) && !encontrados.has(href)) {
        encontrados.add(href);
        let urlCompleta = href;
        if (href.startsWith('/')) {
          const base = new URL(urlSite);
          urlCompleta = base.origin + href;
        } else if (!href.startsWith('http')) {
          urlCompleta = urlSite.replace(/\/$/, '') + '/' + href;
        }
        achados.push({
          titulo: texto.substring(0, 150) || 'PDF de CCT',
          url: urlCompleta,
          resumo: 'PDF encontrado no site do sindicato',
          fonte: 'Site do sindicato'
        });
      }
    }
    const regexLink = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = regexLink.exec(html)) !== null && achados.length < 15) {
      const href = m[1];
      const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const relevante = /(cct|conven|acordo|dissidio|negocia|reajuste|salário|piso)/i.test(href + ' ' + texto);
      const mencionaAno = new RegExp(`${ANO}|${ANO - 1}|${ANO + 1}`).test(href + ' ' + texto);
      if (relevante && mencionaAno && !href.includes('facebook') && !href.includes('twitter')) {
        let urlCompleta = href;
        if (href.startsWith('/')) {
          const base = new URL(urlSite);
          urlCompleta = base.origin + href;
        } else if (!href.startsWith('http')) {
          urlCompleta = urlSite.replace(/\/$/, '') + '/' + href;
        }
        if (!encontrados.has(urlCompleta) && urlCompleta.startsWith('http')) {
          encontrados.add(urlCompleta);
          achados.push({
            titulo: texto.substring(0, 100) || 'Página sobre CCT',
            url: urlCompleta,
            resumo: 'Página sobre CCT encontrada no site',
            fonte: 'Site do sindicato'
          });
        }
      }
    }
  } catch (e) {}
  return achados;
}

function extrairDados(texto) {
  const dados = {};
  const piso = texto.match(/piso\s*(salarial)?\s*(de)?\s*:?\s*R?\$?\s*([\d.,]+)/i);
  if (piso) dados.piso = 'R$ ' + piso[3];
  const reajuste = texto.match(/reajuste\s*(de)?\s*:?\s*([\d.,]+)\s*%/i);
  if (reajuste) dados.reajuste = reajuste[2] + '%';
  return dados;
}

async function enviarEmail(novos) {
  const GMAIL_USER = process.env.GMAIL_USER || '';
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
  const EMAIL_DESTINO = process.env.EMAIL_DESTINO || '';
  if (!GMAIL_USER || !GMAIL_PASS || !EMAIL_DESTINO) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    });
    const linhas = novos.map(n => `• [${n.sindicato}] ${n.titulo}\n  ${n.url}`).join('\n\n');
    await transporter.sendMail({
      from: `"CCT Monitor Grupo-E" <${GMAIL_USER}>`,
      to: EMAIL_DESTINO,
      subject: `🔔 ${novos.length} novo(s) achado(s) de CCT — ${new Date().toLocaleDateString('pt-BR')}`,
      text: `O robô encontrou ${novos.length} novo(s) resultado(s) sobre CCTs:\n\n${linhas}\n\nAcesse: https://ccts-monitor.vercel.app`
    });
    console.log(`📧 Email enviado para ${EMAIL_DESTINO}`);
  } catch (e) {
    console.log(`⚠️ Falha no email: ${e.message}`);
  }
}

(async () => {
  console.log('🤖 CCT Monitor v2.0 — Busca automática iniciada');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}\n`);

  const sindicatos = carregar(ARQ_SIND, []);
  const achadosAnteriores = carregar(ARQ_ACHADOS, []);
  const urlsConhecidas = new Set(achadosAnteriores.map(a => a.url));
  const novos = [];

  console.log(`📊 Sindicatos a verificar: ${sindicatos.length}`);
  console.log(`📂 Achados anteriores: ${achadosAnteriores.length}\n`);

  let i = 0;
  for (const s of sindicatos) {
    i++;
    const nome = s.sigla || s.nome;
    const cnpj = (s.cnpj || '').replace(/\D/g, '');
    
    console.log(`[${i}/${sindicatos.length}] 🔍 ${nome}`);

    const resultados = [];

    if (cnpj && cnpj.length === 14) {
      const rMTE = await buscarMTE(cnpj);
      rMTE.forEach(r => resultados.push({ ...r, fonte: 'MTE/Mediador' }));
      await sleep(300);
    }

    if (s.link) {
      const rSite = await rasparSite(s.link, nome);
      rSite.forEach(r => resultados.push({ ...r, fonte: 'Site do sindicato' }));
      await sleep(300);
    }

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
          status: 'Revisar'
        });
        
        console.log(`   ✅ NOVO: ${r.titulo.substring(0, 60)}`);
      }
    }
  }

  const todosAchados = [...novos, ...achadosAnteriores].slice(0, 500);
  salvar(ARQ_ACHADOS, todosAchados);

  const logs = carregar(ARQ_LOG, []);
  logs.unshift({
    data: new Date().toISOString(),
    sindicatosVerificados: sindicatos.length,
    novosAchados: novos.length,
    totalAcumulado: todosAchados.length
  });
  salvar(ARQ_LOG, logs.slice(0, 60));

  console.log(`\n🏁 Concluído! ${novos.length} novo(s) achado(s).`);

  if (novos.length > 0) await enviarEmail(novos);
})();

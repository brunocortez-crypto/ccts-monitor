#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ===== ENCONTRAR PASTA DATA =====
let DATA_DIR = null;
const tentativas = [
  path.join(process.cwd(), 'data'),
  path.join(__dirname, '..', 'data'),
  path.join(__dirname, '..', '..', 'data'),
  '/home/runner/work/ccts-monitor/ccts-monitor/data'
];

for (const dir of tentativas) {
  if (fs.existsSync(dir)) {
    DATA_DIR = dir;
    break;
  }
}

if (!DATA_DIR) {
  console.error('❌ ERRO CRÍTICO: Pasta "data" não encontrada!');
  console.error('Tentei em:', tentativas);
  process.exit(1);
}

console.log(`✅ Pasta data encontrada: ${DATA_DIR}\n`);

const ARQ_SIND = path.join(DATA_DIR, 'sindicatos.json');
const ARQ_ACHADOS = path.join(DATA_DIR, 'ccts-encontradas.json');
const ARQ_LOG = path.join(DATA_DIR, 'log-execucoes.json');

const ANO = new Date().getFullYear();
const TIMEOUT = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function carregar(arq, padrao) {
  try { 
    const conteudo = JSON.parse(fs.readFileSync(arq, 'utf8')); 
    return conteudo;
  } catch (e) { 
    return padrao; 
  }
}

function salvar(arq, dados) {
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2), 'utf8');
}

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

async function rasparSite(urlSite) {
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
      rMTE.forEach(r => resultados.push(r));
      await sleep(300);
    }

    if (s.link) {
      const rSite = await rasparSite(s.link);
      rSite.forEach(r => resultados.push(r));
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
})();

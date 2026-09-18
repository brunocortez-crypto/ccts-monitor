/**
 * Confere a integridade dos dados e dos links antes de publicar.
 *
 * Critério de aceite §8.4 — todo link de documento tem que responder com
 * Content-Type de documento, NUNCA text/html.
 *
 * O defeito que este script existe para impedir: na versão anterior, 123 links
 * apontavam para docs/MTE/... que não existia no repositório. A Vercel, com
 * outputDirectory ".", respondia com o próprio index.html e HTTP 200. Quem
 * clicava baixava a página achando que era a CCT. Nada errava.
 *
 * Uso:
 *   node scripts/verificar-links.js                    (arquivos locais)
 *   node scripts/verificar-links.js --url https://...  (site publicado)
 */
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// A Vercel liga o "Security Checkpoint" quando leva uma rajada de requisicoes.
// Medido em 18/09/2026: 87 GETs seguidos contra o site publicado derrubaram tudo
// em HTTP 403 por alguns minutos - inclusive para o navegador. Verificar link nao
// pode virar ataque ao proprio site, entao a checagem remota vai devagar e por
// amostra. A checagem local nao tem esse limite e cobre os 87.
const PAUSA_REMOTA = 700;
const AMOSTRA_REMOTA = 12;

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}
const base = argumento('url');
const limite = Number(argumento('limite', 0)) || 0;

if (!existsSync('data/documentos.json')) {
  console.error('data/documentos.json não existe. Rode antes: npm run buscar && npm run coletar');
  process.exit(1);
}

const documentos = JSON.parse(await readFile('data/documentos.json', 'utf8'));
const comArquivo = documentos.filter((d) => d.arquivo_local);
const semArquivo = documentos.filter((d) => !d.arquivo_local);

/* ── integridade das ligações ──────────────────────────────────
 *
 * Em 18/09/2026 o id do sindicato era posicional e reatribuído a cada import.
 * Remover um sindicato deslocou todos os seguintes e cada documento passou a
 * apontar para o vizinho. Zero órfãos, zero erros — só o documento certo embaixo
 * do sindicato errado, e o painel mostrando "sem convenção" para quem tinha duas.
 *
 * Esta checagem existe porque aquele defeito passou por tudo que havia: rodou,
 * gravou, publicou e ninguém viu até alguém olhar a tela.
 */
const problemasDados = [];
if (existsSync('data/sindicatos.json')) {
  const sindicatos = JSON.parse(await readFile('data/sindicatos.json', 'utf8'));
  const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
  const porId = new Map();

  for (const s of sindicatos) {
    if (porId.has(s.id)) problemasDados.push(`id repetido: ${s.id} (${s.sigla})`);
    porId.set(s.id, s);
    if (s.id !== `sid_${s.cnpj_digitos}`) {
      problemasDados.push(`${s.sigla}: id "${s.id}" não deriva do CNPJ — ids posicionais quebram ao remover alguém`);
    }
  }

  for (const d of documentos) {
    const dono = porId.get(d.sindicato_id);
    if (!dono) {
      problemasDados.push(`${d.nr_registro_mte}: sindicato_id "${d.sindicato_id}" não existe`);
    } else if (d.cnpj_sindicato && soDigitos(dono.cnpj) !== soDigitos(d.cnpj_sindicato)) {
      problemasDados.push(
        `${d.nr_registro_mte} (${d.sindicato_sigla}) está ligado a ${dono.sigla} — ` +
        `CNPJ do documento ${d.cnpj_sindicato} != CNPJ do sindicato ${dono.cnpj}`
      );
    }
  }

  console.log(`Sindicatos ................ ${sindicatos.length}`);
  console.log(`Ligações conferidas ....... ${documentos.length}` +
              (problemasDados.length ? `  (${problemasDados.length} problema(s))` : '  OK'));
}

console.log(`Documentos ................ ${documentos.length}`);
console.log(`Com arquivo apontado ...... ${comArquivo.length}`);
console.log(`Sem arquivo ainda ......... ${semArquivo.length}`);
console.log(base
  ? `Verificando ${limite || AMOSTRA_REMOTA} de ${comArquivo.length} em ${base}\n` +
    `(amostra, ${PAUSA_REMOTA}ms entre requisições — a checagem completa é a local)\n`
  : 'Verificando todos os arquivos locais\n');

// Sem --limite, a checagem remota usa amostra; a local cobre tudo.
const padraoRemoto = base ? AMOSTRA_REMOTA : comArquivo.length;
const alvos = comArquivo.slice(0, limite || padraoRemoto);
const problemas = [];
const inconclusivos = [];

if (!base) {
  for (const d of alvos) {
    if (!existsSync(d.arquivo_local)) {
      problemas.push({ doc: d.nr_solicitacao, motivo: `arquivo não existe: ${d.arquivo_local}` });
      continue;
    }
    const info = await stat(d.arquivo_local);
    if (info.size < 2000) {
      problemas.push({ doc: d.nr_solicitacao, motivo: `arquivo com ${info.size} bytes — curto demais` });
      continue;
    }
    const inicio = (await readFile(d.arquivo_local)).subarray(0, 400).toString('latin1');
    // O extrato do MTE é HTML com cabeçalho do Word. A página de erro da Vercel
    // é HTML sem esse cabeçalho — é assim que se distingue uma da outra.
    const ehExtrato = /schemas-microsoft-com:office/i.test(inicio) ||
                      /Mediador\s*-\s*Extrato/i.test(inicio);
    const ehPainel = /<title>\s*Monitor de CCTs/i.test(inicio);
    if (ehPainel) {
      problemas.push({ doc: d.nr_solicitacao, motivo: 'o arquivo é o painel, não o documento' });
    } else if (!ehExtrato) {
      problemas.push({ doc: d.nr_solicitacao, motivo: 'não parece extrato do Mediador' });
    }
  }
} else {
  for (const [n, d] of alvos.entries()) {
    if (n > 0) await pausa(PAUSA_REMOTA);
    const url = new URL(d.arquivo_local, base.endsWith('/') ? base : base + '/').href;
    try {
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
      const tipo = resp.headers.get('content-type') || '';
      const tamanho = Number(resp.headers.get('content-length') || 0);

      // O desafio da Vercel chega como 403, então precisa ser testado ANTES de
      // "não respondeu OK". Sem isso o script grita "link quebrado" quando o link
      // está perfeito e quem está barrado é o verificador — e alguém vai caçar um
      // problema que não existe. Isso é inconclusivo, não é defeito.
      const ehDesafio = resp.headers.has('x-vercel-challenge-token') ||
        (/text\/html/i.test(tipo) &&
         /vercel security checkpoint/i.test(await resp.clone().text().catch(() => '')));

      if (ehDesafio) {
        inconclusivos.push({ doc: d.nr_solicitacao, url });
      } else if (!resp.ok) {
        problemas.push({ doc: d.nr_solicitacao, motivo: `HTTP ${resp.status} em ${url}` });
      } else if (/text\/html/i.test(tipo)) {
        // Este é o caso que importa: HTTP 200 servindo HTML no lugar do documento.
        problemas.push({
          doc: d.nr_solicitacao,
          motivo: `HTTP 200 mas Content-Type text/html — a Vercel devolveu a página, não o documento (${url})`
        });
      } else if (tamanho && tamanho < 2000) {
        problemas.push({ doc: d.nr_solicitacao, motivo: `só ${tamanho} bytes em ${url}` });
      }
    } catch (erro) {
      problemas.push({ doc: d.nr_solicitacao, motivo: `${erro.message} em ${url}` });
    }
    if ((n + 1) % 25 === 0) console.log(`  ... ${n + 1}/${alvos.length}`);
  }
}

if (problemasDados.length) {
  console.error('\nLIGAÇÕES QUEBRADAS ENTRE DOCUMENTO E SINDICATO:');
  for (const p of problemasDados.slice(0, 15)) console.error(`  ${p}`);
  if (problemasDados.length > 15) console.error(`  ... mais ${problemasDados.length - 15}`);
  console.error('\nUm documento embaixo do sindicato errado não dá erro em lugar nenhum:');
  console.error('o painel só mostra a convenção do vizinho como se fosse dele.');
  console.error('Para religar pelo CNPJ: node scripts/migrar-ids.js --aplicar\n');
  process.exitCode = 1;
}

console.log('─────────────────────────────────────────');
console.log(`verificados .............. ${alvos.length}`);
console.log(`problemas ................ ${problemas.length}`);
if (inconclusivos.length) console.log(`inconclusivos ............ ${inconclusivos.length}`);

if (problemas.length) {
  console.error('\nLINKS QUEBRADOS:');
  for (const p of problemas.slice(0, 25)) console.error(`  ${p.doc}: ${p.motivo}`);
  if (problemas.length > 25) console.error(`  ... mais ${problemas.length - 25}`);
  console.error('\nCritério §8.4 FALHOU. Não publique assim.\n');
  process.exitCode = 1;
}

if (inconclusivos.length) {
  console.log(`\nA Vercel respondeu com desafio anti-bot em ${inconclusivos.length} de ${alvos.length}.`);
  console.log('Isso NÃO quer dizer que o link está quebrado — quer dizer que o verificador');
  console.log('foi barrado. Acontece depois de muitas requisições seguidas; espere alguns');
  console.log('minutos e repita. A checagem que cobre os 87 é a local: npm run verificar');

  // Aprovar sem ter verificado nada seria pior que falhar: o script existe
  // justamente para impedir que "parece ok" passe por "está ok".
  if (inconclusivos.length === alvos.length) {
    console.error('\nNENHUM link pôde ser confirmado nesta rodada. Resultado inconclusivo,');
    console.error('não é aprovação.\n');
    process.exitCode = 2;
  }
}

if (semArquivo.length) {
  console.log(`\nAVISO: ${semArquivo.length} documento(s) ainda sem arquivo. Rode: npm run coletar`);
}

// Só declara aprovação quando houve o que aprovar. "OK nos 0 links confirmados"
// é a frase de um script que não verificou nada e mesmo assim passou.
const confirmados = alvos.length - inconclusivos.length;
if (!problemas.length && !problemasDados.length && confirmados > 0) {
  console.log(`\nCritério §8.4 OK nos ${confirmados} link(s) confirmado(s).`);
}

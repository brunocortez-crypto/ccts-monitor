/**
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

console.log(`Documentos ................ ${documentos.length}`);
console.log(`Com arquivo apontado ...... ${comArquivo.length}`);
console.log(`Sem arquivo ainda ......... ${semArquivo.length}`);
console.log(base ? `Verificando em ${base}\n` : 'Verificando arquivos locais\n');

const alvos = limite ? comArquivo.slice(0, limite) : comArquivo;
const problemas = [];

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
    const url = new URL(d.arquivo_local, base.endsWith('/') ? base : base + '/').href;
    try {
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
      const tipo = resp.headers.get('content-type') || '';
      const tamanho = Number(resp.headers.get('content-length') || 0);

      if (!resp.ok) {
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

console.log('─────────────────────────────────────────');
console.log(`verificados .............. ${alvos.length}`);
console.log(`problemas ................ ${problemas.length}`);

if (problemas.length) {
  console.error('\nLINKS QUEBRADOS:');
  for (const p of problemas.slice(0, 25)) console.error(`  ${p.doc}: ${p.motivo}`);
  if (problemas.length > 25) console.error(`  ... mais ${problemas.length - 25}`);
  console.error('\nCritério §8.4 FALHOU. Não publique assim.\n');
  process.exit(1);
}

if (semArquivo.length) {
  console.log(`\nAVISO: ${semArquivo.length} documento(s) ainda sem arquivo. Rode: npm run coletar`);
}
console.log('\nCritério §8.4 OK: todo link aponta para documento de verdade.');

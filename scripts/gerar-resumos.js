/**
 * Gera o resumo de cada convenção e separa o texto pesado do índice leve.
 *
 * Dois problemas de uma vez:
 *
 *  1. O painel mostrava só o título das cláusulas. Quem quer saber "quanto é o
 *     vale-alimentação desta CCT" tinha que baixar o .doc e ler.
 *  2. data/documentos.json tinha 8,4 MB e o painel baixava tudo a cada abertura.
 *     Metade era `texto_extraido`, que ele nunca mostra, e boa parte do resto era
 *     o corpo das cláusulas, que só aparece quando alguém expande uma.
 *
 * Depois deste script:
 *   data/documentos.json      índice leve: metadados, resumo e títulos de cláusula
 *   data/textos/<NR>.json     texto integral e corpo das cláusulas, sob demanda
 *
 * Uso:  node scripts/gerar-resumos.js
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resumirDocumento, contarTitulos } from './lib/resumir.js';

const PASTA_TEXTOS = 'data/textos';

if (!existsSync('data/documentos.json')) {
  console.error('data/documentos.json não existe. Rode antes: npm run buscar && npm run coletar');
  process.exit(1);
}

const documentos = JSON.parse(await readFile('data/documentos.json', 'utf8'));
const antes = Buffer.byteLength(JSON.stringify(documentos));

// Sem o corpo das cláusulas não dá para resumir. Se o índice já foi separado
// numa execução anterior, reconstruímos a partir dos arquivos de texto.
let comCorpo = 0;
for (const d of documentos) {
  if ((d.clausulas || []).some((c) => c.texto)) { comCorpo++; continue; }
  const arq = path.posix.join(PASTA_TEXTOS, `${String(d.nr_solicitacao).replace(/[\\/]/g, '-')}.json`);
  if (existsSync(arq)) {
    const cheio = JSON.parse(await readFile(arq, 'utf8'));
    d.texto_extraido = cheio.texto_extraido;
    d.clausulas = cheio.clausulas;
    comCorpo++;
  }
}

if (comCorpo < documentos.length) {
  console.error(`\n${documentos.length - comCorpo} documento(s) sem corpo de cláusula.`);
  console.error('Refaça a extração antes: node scripts/coletar-documentos.js --reprocessar\n');
  process.exit(1);
}

const frequencia = contarTitulos(documentos);
console.log(`${documentos.length} documentos · ${frequencia.size} títulos de cláusula distintos\n`);

await mkdir(PASTA_TEXTOS, { recursive: true });

const indice = [];
let comValores = 0;
const porTema = {};

for (const d of documentos) {
  const resumo = resumirDocumento(d, frequencia);
  for (const t of resumo.temas) porTema[t.rotulo] = (porTema[t.rotulo] ?? 0) + 1;
  if (resumo.temas.some((t) => t.valores.length)) comValores++;

  const nome = `${String(d.nr_solicitacao).replace(/[\\/]/g, '-')}.json`;
  await writeFile(path.posix.join(PASTA_TEXTOS, nome), JSON.stringify({
    nr_solicitacao: d.nr_solicitacao,
    nr_registro_mte: d.nr_registro_mte,
    texto_extraido: d.texto_extraido,
    clausulas: d.clausulas
  }, null, 2) + '\n', 'utf8');

  // O índice fica com título de cláusula, não com o corpo: é o que o painel
  // mostra sem expandir nada.
  const { texto_extraido, clausulas, indicadores, ...resto } = d;
  indice.push({
    ...resto,
    indicadores,
    resumo,
    clausulas_titulos: (clausulas || []).map((c) => c.titulo),
    total_clausulas: (clausulas || []).length,
    texto_arquivo: path.posix.join(PASTA_TEXTOS, nome)
  });
}

await writeFile('data/documentos.json', JSON.stringify(indice, null, 2) + '\n', 'utf8');

const depois = Buffer.byteLength(JSON.stringify(indice));
const mb = (n) => (n / 1048576).toFixed(1);

console.log('Temas encontrados (em quantos documentos):');
for (const [rotulo, n] of Object.entries(porTema).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${rotulo}`);
}

console.log('\n─────────────────────────────────────────');
console.log(`documentos com algum valor extraído  ${comValores}/${documentos.length}`);
console.log(`índice: ${mb(antes)} MB -> ${mb(depois)} MB ` +
            `(${Math.round((1 - depois / antes) * 100)}% menor)`);
console.log(`textos: ${documentos.length} arquivo(s) em ${PASTA_TEXTOS}/`);
console.log('\nO painel passa a baixar o índice; o texto vem só quando alguém abre.\n');

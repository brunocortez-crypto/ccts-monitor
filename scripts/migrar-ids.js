/**
 * Religa os documentos aos sindicatos depois da troca de id posicional por id
 * derivado do CNPJ.
 *
 * O que aconteceu: o id era `sid_001`, `sid_002`... reatribuído a cada import.
 * Remover um sindicato deslocou todos os seguintes, e cada documento passou a
 * apontar para o vizinho. Não houve órfão nem erro — só documento certo embaixo
 * do sindicato errado.
 *
 * O religamento é feito por `cnpj_sindicato`, que cada documento já guarda e que
 * não depende de posição nenhuma.
 *
 * Uso:  node scripts/migrar-ids.js [--aplicar]
 *       sem --aplicar, só mostra o que mudaria.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const aplicar = process.argv.includes('--aplicar');
const dig = (v) => String(v ?? '').replace(/\D/g, '');

if (!existsSync('data/sindicatos.json') || !existsSync('data/documentos.json')) {
  console.error('Faltam data/sindicatos.json ou data/documentos.json.');
  process.exit(1);
}

const sindicatos = JSON.parse(await readFile('data/sindicatos.json', 'utf8'));
const documentos = JSON.parse(await readFile('data/documentos.json', 'utf8'));

const porCnpj = new Map(sindicatos.map((s) => [s.cnpj_digitos, s]));
const porId = new Map(sindicatos.map((s) => [s.id, s]));

let corrigidos = 0;
let jaCertos = 0;
const semDono = [];

for (const d of documentos) {
  const chave = dig(d.cnpj_sindicato);
  const dono = porCnpj.get(chave);

  if (!dono) {
    semDono.push(d);
    continue;
  }
  if (d.sindicato_id === dono.id) {
    jaCertos++;
    continue;
  }

  const apontavaPara = porId.get(d.sindicato_id);
  console.log(
    `${String(d.nr_registro_mte).padEnd(16)} ${String(d.sindicato_sigla).padEnd(22).slice(0, 22)}` +
    `  ${d.sindicato_id} -> ${dono.id}` +
    (apontavaPara && apontavaPara.cnpj_digitos !== chave
      ? `   (estava caindo em ${apontavaPara.sigla})` : '')
  );
  if (aplicar) d.sindicato_id = dono.id;
  corrigidos++;
}

console.log('\n─────────────────────────────────────────');
console.log(`já corretos .............. ${jaCertos}`);
console.log(`religados ................ ${corrigidos}`);
console.log(`sem sindicato na carteira  ${semDono.length}`);

if (semDono.length) {
  console.log('\nSem dono (o CNPJ não está mais na carteira):');
  for (const d of semDono.slice(0, 10)) {
    console.log(`  ${d.nr_registro_mte}  ${d.sindicato_sigla}  ${d.cnpj_sindicato}`);
  }
  console.log('\nEsses ficam como estão. Se o sindicato foi ignorado de propósito,');
  console.log('os documentos dele deixam de aparecer no painel — o que é o esperado.');
}

if (!aplicar) {
  console.log('\nNada foi gravado. Rode com --aplicar para religar.\n');
} else {
  await writeFile('data/documentos.json', JSON.stringify(documentos, null, 2) + '\n', 'utf8');
  console.log('\nGravado: data/documentos.json\n');
}

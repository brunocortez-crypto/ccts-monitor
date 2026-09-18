/**
 * Resumo de uma convenção: os pontos que o escritório procura, com a origem junto.
 *
 * Regra que vale para tudo aqui: nenhum valor aparece sem o título da cláusula de
 * onde saiu e o trecho do texto. Um piso ou um percentual errado num resumo vira
 * folha errada — e quem confere precisa poder conferir sem abrir o documento.
 *
 * Os temas foram desenhados a partir dos títulos que existem de verdade nos 87
 * documentos, não de uma lista imaginada: são 1885 títulos distintos para 4216
 * cláusulas, porque cada convenção nomeia as coisas do seu jeito ("PISO SALARIAL",
 * "SALÁRIO DA CATEGORIA", "MENOR SALÁRIO NA FUNÇÃO" e "GARANTIA MÍNIMA" são a
 * mesma cláusula com quatro nomes).
 */

const DINHEIRO = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{2})?|\\d+,\\d{2})';
const PERCENTUAL = '(\\d{1,3}(?:,\\d{1,4})?)';

export const TEMAS = [
  {
    chave: 'salario',
    rotulo: 'Salários',
    titulo: /piso|sal[áa]rio|remunera|reajuste|corre[çc][ãa]o|aumento|garantia m[íi]nima/i,
    valores: [
      { nome: 'Piso', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1000, 30000] },
      { nome: 'Reajuste', padrao: `${PERCENTUAL}\\s*%`, sufixo: '%', faixa: [0.1, 60] }
    ]
  },
  {
    chave: 'alimentacao',
    rotulo: 'Alimentação',
    titulo: /alimenta|refei|cesta|ticket|vale.?ref/i,
    valores: [{ nome: 'Valor', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1, 5000] }]
  },
  {
    chave: 'transporte',
    rotulo: 'Transporte',
    titulo: /vale.?transporte|deslocamento|condu[çc][ãa]o/i,
    valores: [
      { nome: 'Valor', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1, 3000] },
      { nome: 'Desconto', padrao: `${PERCENTUAL}\\s*%`, sufixo: '%', faixa: [0.1, 100] }
    ]
  },
  {
    chave: 'saude',
    rotulo: 'Saúde e assistência',
    titulo: /plano de sa[úu]de|assist[êe]ncia m[ée]dica|odontol|conv[êe]nio m[ée]dic/i,
    valores: [{ nome: 'Valor', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1, 5000] }]
  },
  {
    chave: 'seguro',
    rotulo: 'Seguro de vida',
    titulo: /seguro de vida|seguro em grupo/i,
    valores: [{ nome: 'Cobertura', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1000, 500000] }]
  },
  {
    chave: 'jornada',
    rotulo: 'Jornada e horas extras',
    titulo: /hora[s]? extra|jornada|banco de hora|adicional noturno|intervalo/i,
    valores: [{ nome: 'Adicional', padrao: `${PERCENTUAL}\\s*%`, sufixo: '%', faixa: [1, 200] }]
  },
  {
    chave: 'estabilidade',
    rotulo: 'Estabilidades',
    titulo: /estabilidad|garantia de emprego|pr[ée].?aposent/i,
    valores: []
  },
  {
    chave: 'creche',
    rotulo: 'Creche e dependentes',
    titulo: /creche|aux[íi]lio.?bab|filho/i,
    valores: [{ nome: 'Valor', padrao: `R\\$\\s*${DINHEIRO}`, faixa: [1, 5000] }]
  },
  {
    chave: 'sindical',
    rotulo: 'Contribuições sindicais',
    titulo: /contribui[çc][ãa]o|mensalidade|assistencial|negocia[çc][ãa]o coletiva/i,
    valores: [{ nome: 'Percentual', padrao: `${PERCENTUAL}\\s*%`, sufixo: '%', faixa: [0.1, 100] }]
  },
  {
    chave: 'rescisao',
    rotulo: 'Rescisão',
    titulo: /rescis|aviso pr[ée]vio|homologa|demiss/i,
    valores: [{ nome: 'Multa', padrao: `${PERCENTUAL}\\s*%`, sufixo: '%', faixa: [1, 100] }]
  }
];

const paraNumero = (v) => {
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/** Valores plausíveis dentro do texto de uma cláusula, com o trecho de origem. */
function extrairValores(texto, spec, tituloClausula, limite = 3) {
  const saida = [];
  const rx = new RegExp(spec.padrao, 'gi');
  let m;
  while ((m = rx.exec(texto)) !== null && saida.length < limite) {
    const n = paraNumero(m[1]);
    // A faixa e o que separa "piso de R$ 1.715,99" de "multa de R$ 2,00":
    // sem ela, qualquer numero perto da palavra certa vira indicador.
    if (spec.faixa && (!(n >= spec.faixa[0]) || !(n <= spec.faixa[1]))) continue;
    if (saida.some((v) => v.valor === m[1])) continue;
    saida.push({
      rotulo: spec.nome,
      valor: m[1] + (spec.sufixo ?? ''),
      clausula: tituloClausula,
      trecho: texto.slice(Math.max(0, m.index - 70), m.index + 110)
        .replace(/\s+/g, ' ').trim()
    });
  }
  return saida;
}

/** Texto da cláusula cujo título casa, usado para campos descritivos. */
function textoDe(clausulas, re, limite = 320) {
  const c = clausulas.find((x) => re.test(String(x.titulo ?? '')));
  if (!c) return null;
  const t = String(c.texto ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > limite ? t.slice(0, limite).trimEnd() + '…' : t) : null;
}

/**
 * Monta o resumo.
 *
 * `frequenciaTitulos` é opcional: um Map de título -> em quantos documentos ele
 * aparece. Com ele, o resumo consegue apontar o que ESTA convenção tem de
 * diferente das outras — que é a pergunta que ninguém consegue responder lendo
 * uma convenção isolada.
 */
export function resumirDocumento(doc, frequenciaTitulos = null) {
  const clausulas = doc.clausulas || [];

  const temas = [];
  for (const tema of TEMAS) {
    const doTema = clausulas.filter((c) => tema.titulo.test(String(c.titulo ?? '')));
    if (!doTema.length) continue;

    const valores = [];
    for (const c of doTema) {
      for (const spec of tema.valores) {
        valores.push(...extrairValores(String(c.texto ?? ''), spec, c.titulo,
          3 - valores.filter((v) => v.rotulo === spec.nome).length));
      }
    }

    temas.push({
      chave: tema.chave,
      rotulo: tema.rotulo,
      clausulas: doTema.map((c) => c.titulo),
      valores: valores.slice(0, 6)
    });
  }

  // Cláusulas que aparecem em poucas convenções: o diferencial desta.
  let incomuns = [];
  if (frequenciaTitulos) {
    const chave = (t) => String(t).trim().toUpperCase().replace(/\s+/g, ' ');
    incomuns = clausulas
      .filter((c) => (frequenciaTitulos.get(chave(c.titulo)) ?? 0) <= 2)
      .map((c) => c.titulo)
      .slice(0, 12);
  }

  return {
    abrangencia: textoDe(clausulas, /abrang[êe]ncia/i),
    vigencia_texto: textoDe(clausulas, /vig[êe]ncia e data.?base/i, 220),
    temas,
    incomuns,
    total_clausulas: clausulas.length,
    gerado_em: new Date().toISOString().slice(0, 10)
  };
}

/** Map título -> em quantos documentos aparece. Base para `incomuns`. */
export function contarTitulos(documentos) {
  const cont = new Map();
  for (const d of documentos) {
    const vistos = new Set();
    for (const c of d.clausulas || []) {
      const t = String(c.titulo).trim().toUpperCase().replace(/\s+/g, ' ');
      if (vistos.has(t)) continue;
      vistos.add(t);
      cont.set(t, (cont.get(t) ?? 0) + 1);
    }
  }
  return cont;
}

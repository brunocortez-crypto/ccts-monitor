import ExcelJS from 'exceljs';

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/** Só os dígitos do CNPJ. Usado como chave — a formatação da planilha varia. */
export function digitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Valida os dois dígitos verificadores do CNPJ.
 * A planilha tem entradas de preenchimento ("00.000.000/0000-00" da DOMESTICAS)
 * que não podem ser consultadas no Mediador — precisam ser marcadas, não descartadas.
 */
export function cnpjValido(valor) {
  const d = digitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calcula = (base, pesoInicial) => {
    let soma = 0;
    let peso = pesoInicial;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcula(d.slice(0, 12), 5);
  const dv2 = calcula(d.slice(0, 13), 6);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}

function normalizaMes(valor) {
  const txt = String(valor ?? '').trim();
  if (!txt) return null;
  const alvo = txt.toLowerCase();
  const i = MESES.findIndex((m) => m.toLowerCase() === alvo);
  return i === -1 ? null : { mes: MESES[i], mes_numero: i + 1 };
}

/** "Não localizado" e "N/A" são preenchimento, não valor. */
function vazioOuTexto(valor) {
  const txt = String(valor ?? '').trim();
  if (!txt || /^n[ãa]o\s+localizad[oa]$/i.test(txt) || /^n\/?a$/i.test(txt)) return null;
  return txt;
}

function normalizaSite(valor) {
  const txt = vazioOuTexto(valor);
  if (!txt) return null;
  return /^https?:\/\//i.test(txt) ? txt : `https://${txt}`;
}

function textoDaCelula(celula) {
  const v = celula?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim();
    if (v.richText) return v.richText.map((p) => p.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.hyperlink) return String(v.hyperlink).trim();
    return '';
  }
  return String(v).trim();
}

/**
 * Lê a aba "Sindicatos" e agrupa por CNPJ.
 *
 * A planilha vem do relatório cadastral "Relação Sindical pela Data-Base": um
 * sindicato aparece uma vez POR DATA-BASE. Agrupar por CNPJ guardando só a primeira
 * linha perde meses de alerta sem dar erro — foi o defeito da versão anterior.
 * Por isso cada sindicato sai com uma LISTA de data-bases.
 */
export async function lerPlanilha(caminho) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);

  const aba = wb.getWorksheet('Sindicatos');
  if (!aba) {
    const nomes = wb.worksheets.map((w) => w.name).join(', ');
    throw new Error(`Aba "Sindicatos" não encontrada em ${caminho}. Abas disponíveis: ${nomes}`);
  }

  const cabecalho = [];
  aba.getRow(1).eachCell({ includeEmpty: true }, (celula, col) => {
    cabecalho[col] = textoDaCelula(celula);
  });

  const obrigatorias = ['Sindicato', 'Mês da Data-Base', 'Sigla', 'CNPJ'];
  const faltando = obrigatorias.filter((c) => !cabecalho.includes(c));
  if (faltando.length) {
    throw new Error(
      `Colunas ausentes na aba "Sindicatos": ${faltando.join(', ')}. ` +
      `Encontrei: ${cabecalho.filter(Boolean).join(', ')}`
    );
  }

  const linhas = [];
  aba.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    const reg = {};
    row.eachCell({ includeEmpty: true }, (celula, col) => {
      if (cabecalho[col]) reg[cabecalho[col]] = textoDaCelula(celula);
    });
    if (Object.values(reg).some((v) => v !== '')) linhas.push({ ...reg, _linha: numero });
  });

  return agrupar(linhas);
}

function agrupar(linhas) {
  const porCnpj = new Map();
  const avisos = [];

  for (const l of linhas) {
    const chave = digitos(l['CNPJ']);
    if (!chave) {
      avisos.push(`linha ${l._linha}: sem CNPJ, ignorada (${l['Sigla'] || l['Sindicato']})`);
      continue;
    }

    if (!porCnpj.has(chave)) {
      porCnpj.set(chave, {
        cnpj: l['CNPJ'],
        cnpj_digitos: chave,
        cnpj_valido: cnpjValido(chave),
        nome: l['Sindicato'],
        sigla: l['Sigla'],
        entidade: vazioOuTexto(l['Entidade']),
        municipio: vazioOuTexto(l['Município']),
        uf: vazioOuTexto(l['Estado']),
        site: normalizaSite(l['Site']),
        data_bases: [],
        variantes: [],
        linhas_planilha: []
      });
    }

    const s = porCnpj.get(chave);
    s.linhas_planilha.push(l._linha);

    const mes = normalizaMes(l['Mês da Data-Base']);
    if (!mes) {
      avisos.push(`linha ${l._linha} (${s.sigla}): mês "${l['Mês da Data-Base']}" não reconhecido`);
    } else if (!s.data_bases.some((d) => d.mes_numero === mes.mes_numero)) {
      s.data_bases.push(mes);
    }

    // Um mesmo CNPJ+mês aparece várias vezes porque a coluna "Sindicato" é usada
    // como anotação do escritório sobre a empresa cliente ou a negociação
    // ("- ACAI 01/2023", "/ARAQUARI", "- EM HORAS", "-DESATIVADO !!"). Nenhuma das
    // linhas repetidas é cópia exata, então guardamos todas em vez de descartar:
    // a consulta ao Mediador é por CNPJ, mas essa anotação é do negócio.
    s.variantes.push({
      linha: l._linha,
      nome: l['Sindicato'],
      sigla: l['Sigla'],
      entidade: l['Entidade'] || null,
      mes: mes?.mes ?? null
    });

    // O site costuma vir preenchido em uma linha e vazio nas repetidas.
    if (!s.site) s.site = normalizaSite(l['Site']);
  }

  const sindicatos = [...porCnpj.values()]
    .map((s) => ({
      ...s,
      data_bases: s.data_bases.sort((a, b) => a.mes_numero - b.mes_numero),
      // "DESATIVADO !!" na anotação é sinalização do escritório de que aquela
      // negociação saiu. Marcamos para revisão em vez de decidir sozinhos.
      revisar: s.variantes.some((v) => /desativad/i.test(String(v.nome ?? '')))
    }))
    .sort((a, b) => String(a.sigla).localeCompare(String(b.sigla), 'pt'));

  // O id vem do CNPJ, nao da posicao na lista.
  //
  // Com id posicional (sid_001, sid_002...), reatribuido a cada import, remover um
  // sindicato deslocava todos os seguintes — e cada documento passava a ser
  // atribuido ao vizinho. Sem erro, sem orfao, sem nada piscando: so o documento
  // errado embaixo do sindicato errado. CNPJ nao muda; posicao muda sempre.
  sindicatos.forEach((s) => {
    s.id = `sid_${s.cnpj_digitos}`;
  });

  return {
    sindicatos,
    avisos,
    totais: {
      linhas: linhas.length,
      sindicatos: sindicatos.length,
      data_bases: sindicatos.reduce((n, s) => n + s.data_bases.length, 0),
      variantes: sindicatos.reduce((n, s) => n + s.variantes.length, 0),
      sem_cnpj_valido: sindicatos.filter((s) => !s.cnpj_valido).length,
      com_multiplas_data_bases: sindicatos.filter((s) => s.data_bases.length > 1).length,
      a_revisar: sindicatos.filter((s) => s.revisar).length
    }
  };
}

// Excel do contabilista — escrita com ExcelJS (cores, dropdowns, links).
// Recebe o "pack" puro de buildAccountantSheets (hq/index.html) e devolve
// um Workbook. Não toca no DOM nem no Supabase, por isso corre também em
// Node (tests/scripts). Miguel, 6 Out 2026: «um excel de boa leitura, com
// cores e dropdowns a dizer se tem ou não a fatura, para ver o que falta».
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.accExcelWorkbook = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const NAVY = 'FF1F3B57', WHITE = 'FFFFFFFF', ZEBRA = 'FFF7F9FB', SECTION = 'FFE8EEF4', LINE = 'FFD8DEE6';
  const STATUS_FILL = {
    'Sim': 'FFC6EFCE', 'OK': 'FFC6EFCE',
    'Não': 'FFFFC7CE', 'SEM DOCUMENTO': 'FFFFC7CE',
    'Não existe': 'FFE7E6E6', 'Não é despesa': 'FFE7E6E6',
    'A REVER': 'FFFFEB9C',
  };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin = { style: 'thin', color: { argb: LINE } };
  const MONEY = '#,##0.00 €';

  function colLetter(i){ let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  function writeTable(ws, sh){
    const ncol = sh.header.length;
    ws.columns = sh.header.map((h, i) => ({ header: h, key: 'c' + i, width: (sh.widths || [])[i] || 14 }));
    const head = ws.getRow(1);
    head.height = 24;
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
      cell.fill = fill(NAVY);
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: thin };
    });
    const money = new Set(sh.moneyCols || (sh.totalCol != null ? [sh.totalCol] : []));
    const n = sh.rows.length;
    sh.rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cell.border = { bottom: thin };
        cell.alignment = { vertical: 'top', wrapText: c - 1 === sh.wrapCol };
        if (money.has(c - 1) && typeof cell.value === 'number') cell.numFmt = MONEY;
        if (sh.kind !== 'checklist' && sh.kind !== 'bank' && i % 2 === 1) cell.fill = fill(ZEBRA);
      });
      if (sh.kind === 'checklist' || sh.kind === 'bank') row.height = 18;
    });
    (sh.links || []).forEach(l => {
      const cell = ws.getCell(l.r + 1, l.c + 1);
      cell.value = { text: String(cell.value || 'abrir'), hyperlink: l.url, tooltip: 'Abrir na Drive' };
      cell.font = { color: { argb: 'FF1E6FA8' }, underline: true };
    });
    if (sh.dropdown && n) {
      const col = colLetter(sh.dropdown.col);
      for (let r = 2; r <= n + 1; r++) {
        ws.getCell(`${col}${r}`).dataValidation = {
          type: 'list', allowBlank: true, showErrorMessage: true,
          errorTitle: 'Escolhe uma opção', error: 'Usa o dropdown: ' + sh.dropdown.options.join(' / '),
          formulae: ['"' + sh.dropdown.options.join(',') + '"'],
        };
        ws.getCell(`${col}${r}`).font = { bold: true };
        ws.getCell(`${col}${r}`).alignment = { horizontal: 'center', vertical: 'top' };
      }
    }
    if (sh.statusCol != null && n) {
      const col = colLetter(sh.statusCol), last = colLetter(ncol - 1);
      const opts = (sh.dropdown && sh.dropdown.options) || Object.keys(STATUS_FILL);
      ws.addConditionalFormatting({
        ref: `A2:${last}${n + 1}`,
        rules: opts.filter(o => STATUS_FILL[o]).map((o, i) => ({
          type: 'expression', priority: i + 1,
          formulae: [`$${col}2="${o}"`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: STATUS_FILL[o] } } },
        })),
      });
    }
    if (sh.totalCol != null && n) {
      const col = colLetter(sh.totalCol);
      const v = Math.round(sh.rows.reduce((s, r) => s + Number(r[sh.totalCol] || 0), 0) * 100) / 100;
      ws.addRow([]);
      const tr = ws.addRow([]);
      tr.getCell(Math.max(1, sh.totalCol)).value = 'Total';
      tr.getCell(sh.totalCol + 1).value = { formula: `SUM(${col}2:${col}${n + 1})`, result: v };
      tr.getCell(sh.totalCol + 1).numFmt = MONEY;
      tr.eachCell((cell) => { cell.font = { bold: true }; cell.border = { top: { style: 'medium', color: { argb: NAVY } } }; });
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // Impressão: paisagem, cabeçalho repetido em cada página, largura ajustada.
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1', paperSize: 9 };
    if (n) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: n + 1, column: ncol } };
  }

  function writeResumo(ws, sh){
    ws.columns = [{ width: (sh.widths || [])[0] || 46 }, { width: (sh.widths || [])[1] || 22 }, { width: 60 }];
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    const title = ws.addRow(sh.header);
    title.height = 28;
    title.eachCell((cell) => { cell.font = { bold: true, size: 14, color: { argb: WHITE } }; cell.fill = fill(NAVY); cell.alignment = { vertical: 'middle' }; });
    sh.rows.forEach((r) => {
      const row = ws.addRow(r);
      const a = String(r[0] || ''), b = r[1];
      const isSection = /^[A-ZÀ-Ú]{3,}( [A-ZÀ-Ú]+)*/.test(a) && a.length < 70 && (b === '' || b == null);
      if (isSection) { row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 2) { cell.font = { bold: true, color: { argb: NAVY } }; cell.fill = fill(SECTION); } }); }
      if (typeof b === 'number' && /EUR/.test(a)) row.getCell(2).numFmt = MONEY;
      if (a.length > 70 && (b === '' || b == null)) { row.getCell(1).alignment = { wrapText: true, vertical: 'top' }; ws.mergeCells(row.number, 1, row.number, 3); row.height = 30; }
    });
    (sh.links || []).forEach(l => {
      const cell = ws.getCell(l.r + 1, l.c + 1);
      cell.value = { text: String(cell.value || 'abrir'), hyperlink: l.url, tooltip: 'Abrir na Drive' };
      cell.font = { color: { argb: 'FF1E6FA8' }, underline: true, bold: true };
    });
    (sh.alerts || []).forEach(a => {
      const cell = ws.getCell(a.r + 1, a.c + 1);
      cell.fill = fill(a.level === 'ok' ? STATUS_FILL.Sim : a.level === 'warn' ? STATUS_FILL['A REVER'] : STATUS_FILL['Não']);
      cell.font = { bold: true };
    });
  }

  return function accExcelWorkbook(ExcelJS, pack){
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gota d\'Água HQ';
    wb.created = new Date();
    pack.sheets.forEach(sh => {
      const ws = wb.addWorksheet(sh.name.slice(0, 31), { properties: { tabColor: { argb: sh.kind === 'checklist' ? 'FFFFC7CE' : sh.kind === 'bank' ? 'FFFFEB9C' : sh.kind === 'resumo' ? NAVY : 'FFD8DEE6' } } });
      if (sh.kind === 'resumo') writeResumo(ws, sh); else writeTable(ws, sh);
    });
    return wb;
  };
}));

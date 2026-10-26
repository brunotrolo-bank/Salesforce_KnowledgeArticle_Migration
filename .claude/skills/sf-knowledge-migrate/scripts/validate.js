#!/usr/bin/env node
/**
 * Valida fidelidade e completude de um lote convertido contra o manifest de
 * origem (gerado na etapa de inventário) e contra o CSV/arquivos gerados por
 * convert.js. Imprime um JSON de resultado em stdout — o orquestrador (ou o
 * subagente kb-fidelity-validator) decide o que fazer com cada problema.
 *
 * Verifica, por artigo:
 *   1. Contagem de <img>/<a href>/<ul> do original vs. convertido (fidelidade)
 *   2. Summary presente, <= 1000 caracteres, sem placeholder sobrevivente
 *   3. Question__c presente (arquivo de pergunta), sem placeholder sobrevivente
 *   4. RecordTypeId presente no CSV e com exatamente 15 caracteres (não 18)
 *
 * Uso:
 *   node validate.js --manifest <manifest.json> --converted <pasta-02-processados>
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function countTag(html, re) {
  // Remove comentários antes de contar: um comentário que menciona a tag
  // como texto não deve contar como ocorrência real.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  return (clean.match(re) || []).length;
}

// Parser de CSV completo (não por linha): respeita aspas duplas através de
// TODO o arquivo, inclusive quebras de linha reais dentro de um campo entre
// aspas (RFC 4180, válido — é exatamente o que o template estruturado de
// Summary usa, ver content-authoring-rules.md). Um split('\n') ingênuo antes
// de parsear quebraria qualquer Summary multi-linha no meio do registro.
function parseCsv(content) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"' && content[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\r') { /* ignora CR, trata CRLF como LF */ }
      else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  const convertedDir = args.converted;

  if (!manifestPath || !convertedDir) {
    console.error('Uso: node validate.js --manifest <manifest.json> --converted <pasta-02-processados>');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const csvPath = path.join(convertedDir, 'import.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const allRows = parseCsv(csvContent);
  const header = allRows[0] || [];

  const colIndex = (name) => header.indexOf(name);
  const idxTitle = colIndex('Title');
  const idxSummary = colIndex('Summary');
  const idxRecordType = colIndex('RecordTypeId');
  const idxQuestion = colIndex('Question__c');
  const idxAnswer = colIndex('Answer__c');
  const idxSummaryEnhanced = colIndex('Summary_Enhanced__c');

  const requiredCols = { Title: idxTitle, Summary: idxSummary, RecordTypeId: idxRecordType, Question__c: idxQuestion, Answer__c: idxAnswer };
  const missingCols = Object.entries(requiredCols).filter(([, i]) => i === -1).map(([name]) => name);

  const results = [];
  let ok = true;

  if (missingCols.length > 0) {
    ok = false;
    results.push({
      scope: 'csv-header',
      problem: `Coluna(s) obrigatória(s) ausente(s) no header do CSV: ${missingCols.join(', ')}`,
      severity: 'bloqueante',
    });
  }

  const dataRows = allRows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const num = i + 1;
    const manifestEntry = manifest.articles && manifest.articles[i];
    const articleFile = idxAnswer !== -1 ? row[idxAnswer].replace(/^data\//, '') : null;
    const articlePath = articleFile ? path.join(convertedDir, 'data', articleFile) : null;
    const articleHtml = articlePath && fs.existsSync(articlePath) ? fs.readFileSync(articlePath, 'utf8') : '';

    // 1. Fidelidade de tags vs. manifest de origem
    if (manifestEntry) {
      const convImg = countTag(articleHtml, /<img/gi);
      const convLinks = countTag(articleHtml, /<a href/gi);
      const convLists = countTag(articleHtml, /<ul>|<ol>/gi);
      if (convImg !== manifestEntry.images) {
        ok = false;
        results.push({ scope: `artigo-${num}`, problem: `Contagem de <img> não bate: original=${manifestEntry.images}, convertido=${convImg}`, severity: 'bloqueante' });
      }
      if (convLinks !== manifestEntry.links) {
        ok = false;
        results.push({ scope: `artigo-${num}`, problem: `Contagem de <a href> não bate: original=${manifestEntry.links}, convertido=${convLinks}`, severity: 'bloqueante' });
      }
      if (convLists !== manifestEntry.lists) {
        ok = false;
        results.push({ scope: `artigo-${num}`, problem: `Contagem de <ul> não bate: original=${manifestEntry.lists}, convertido=${convLists}`, severity: 'bloqueante' });
      }
      if (manifestEntry.panels === 1 && manifestEntry.panels !== undefined) {
        results.push({ scope: `artigo-${num}`, problem: `Artigo de origem tem só 1 painel de acordeão — confirme manualmente que não é truncamento (grep 'panel-body' no index.html original) antes de aceitar`, severity: 'aviso' });
      }
    }

    // 2. Summary
    const summary = idxSummary !== -1 ? row[idxSummary] : '';
    if (!summary || summary.includes('__TODO_SUMMARY')) {
      ok = false;
      results.push({ scope: `artigo-${num}`, problem: 'Summary vazio ou com placeholder não substituído — precisa de autoria pelo agente (ver content-authoring-rules.md)', severity: 'bloqueante' });
    } else if (summary.length > 1000) {
      ok = false;
      results.push({ scope: `artigo-${num}`, problem: `Summary excede 1000 caracteres (${summary.length})`, severity: 'bloqueante' });
    }

    // 3. Question__c (via arquivo referenciado)
    const questionFile = idxQuestion !== -1 ? row[idxQuestion].replace(/^data\//, '') : null;
    const questionPath = questionFile ? path.join(convertedDir, 'data', questionFile) : null;
    const questionHtml = questionPath && fs.existsSync(questionPath) ? fs.readFileSync(questionPath, 'utf8') : '';
    if (!questionHtml || questionHtml.includes('__TODO_QUESTION')) {
      ok = false;
      results.push({ scope: `artigo-${num}`, problem: 'Question__c vazio ou com placeholder não substituído — precisa de uma pergunta em linguagem natural (ver content-authoring-rules.md)', severity: 'bloqueante' });
    }

    // 3b. Summary_Enhanced__c (via arquivo referenciado) — gerado por
    // scripts/format-summary-enhanced.js a partir do Summary já autorado
    // (ver content-authoring-rules.md). Coluna opcional só para não quebrar
    // lotes convertidos antes desta feature existir.
    if (idxSummaryEnhanced !== -1) {
      const summaryEnhancedFile = row[idxSummaryEnhanced] ? row[idxSummaryEnhanced].replace(/^data\//, '') : null;
      const summaryEnhancedPath = summaryEnhancedFile ? path.join(convertedDir, 'data', summaryEnhancedFile) : null;
      const summaryEnhancedHtml = summaryEnhancedPath && fs.existsSync(summaryEnhancedPath) ? fs.readFileSync(summaryEnhancedPath, 'utf8') : '';
      if (!summaryEnhancedHtml || summaryEnhancedHtml.includes('__TODO_SUMMARY_ENHANCED')) {
        ok = false;
        results.push({ scope: `artigo-${num}`, problem: 'Summary_Enhanced__c vazio ou com placeholder não substituído — rode scripts/format-summary-enhanced.js com o Summary já autorado (ver content-authoring-rules.md)', severity: 'bloqueante' });
      }
    }

    // 4. RecordType — dois incidentes reais já ocorridos em produção:
    //    (a) coluna ausente: o Import Wizard NÃO acusa erro, só cria o
    //        artigo com o campo em branco;
    //    (b) Id de 18 caracteres em vez de 15: o Import Wizard FALHA com
    //        "A lookup field value is not a lookup ID" — a importação toda
    //        é rejeitada. As duas checagens abaixo cobrem os dois casos.
    const recordType = idxRecordType !== -1 ? row[idxRecordType] : '';
    if (!recordType) {
      ok = false;
      results.push({ scope: `artigo-${num}`, problem: 'RecordTypeId vazio no CSV — o Import Wizard NÃO acusa erro nisso, só cria o artigo com Record Type em branco (incidente já ocorrido)', severity: 'bloqueante' });
    } else if (recordType.length !== 15) {
      ok = false;
      results.push({ scope: `artigo-${num}`, problem: `RecordTypeId com ${recordType.length} caracteres ("${recordType}") — o Import Wizard de Knowledge exige o Id de 15 caracteres, não o de 18. Isso FALHA a importação inteira com "A lookup field value is not a lookup ID" (incidente já ocorrido)`, severity: 'bloqueante' });
    }
  }

  const output = { ok, totalArtigos: dataRows.length, problemas: results };
  console.log(JSON.stringify(output, null, 2));
  process.exit(ok ? 0 : 1);
}

main();

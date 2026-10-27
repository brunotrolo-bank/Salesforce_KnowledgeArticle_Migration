#!/usr/bin/env node
/**
 * Converte o Summary estruturado (texto plano, ver references/
 * content-authoring-rules.md: linha de fato principal + linhas "LABEL: texto")
 * em HTML real para o campo Summary_Enhanced__c (Rich Text Area).
 *
 * Puramente mecânico — não inventa conteúdo, só formata o que o agente já
 * escreveu como Summary: a linha 1 vira um parágrafo, cada linha "LABEL:
 * texto" vira um item de lista com o rótulo em negrito. Isso existe porque o
 * Summary (Text Area simples) e o Summary_Enhanced__c (Rich Text) nascem do
 * MESMO conteúdo autorado uma única vez — nunca se escreve os dois à mão.
 *
 * Uso:
 *   node format-summary-enhanced.js --text "<summary já autorado>"
 *   node format-summary-enhanced.js --in <arquivo.txt>
 *
 * Também exportável como módulo: require('./format-summary-enhanced').toRichHtml(text)
 */
const fs = require('fs');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const LABEL_LINE_RE = /^([A-ZÇÃÕÁÉÍÓÚÀÂÊÎÔÛ][A-ZÇÃÕÁÉÍÓÚÀÂÊÎÔÛ0-9 ]*):\s*(.+)$/;

// Ícone por rótulo: escaneamento visual mais rápido que ler a palavra —
// mesmo princípio da simplificação de linguagem, para um público treinado a
// seguir procedimento, não a interpretar texto (decisão 2026-10-26). Rótulo
// fora desta lista (extensão aberta, ver content-authoring-rules.md) não
// ganha ícone — só o negrito, sem quebrar a formatação.
const LABEL_ICONS = {
  'FAÇA': '✅',
  'NÃO FAÇA': '🚫',
  'ENCAMINHE PARA': '➡️',
  'QUANTO': '💰',
  'QUEM GANHA': '🏆',
};

function toRichHtml(summaryText) {
  const lines = String(summaryText || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  let html = '';
  const listItems = [];
  let firstLineConsumed = false;

  for (const line of lines) {
    const m = line.match(LABEL_LINE_RE);
    if (m) {
      const icon = LABEL_ICONS[m[1].toUpperCase()];
      const labelHtml = icon ? `${icon} <strong>${escapeHtml(m[1])}:</strong>` : `<strong>${escapeHtml(m[1])}:</strong>`;
      listItems.push(`<li>${labelHtml} ${escapeHtml(m[2])}</li>`);
    } else if (!firstLineConsumed) {
      // Linha 1 (fato principal, sem rótulo) — sempre vira um parágrafo em destaque.
      html += `<p><strong>${escapeHtml(line)}</strong></p>`;
      firstLineConsumed = true;
    } else {
      // Linha extra sem rótulo (fora do template) — preserva como parágrafo normal.
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  if (listItems.length > 0) {
    html += `<ul>${listItems.join('')}</ul>`;
  }

  return html;
}

function main() {
  const args = process.argv.slice(2);
  const idx = (flag) => args.indexOf(flag);
  let text = null;

  if (idx('--text') !== -1) {
    text = args[idx('--text') + 1];
  } else if (idx('--in') !== -1) {
    text = fs.readFileSync(args[idx('--in') + 1], 'utf8');
  }

  if (!text) {
    console.error('Uso: node format-summary-enhanced.js --text "<summary>" | --in <arquivo.txt>');
    process.exit(1);
  }

  process.stdout.write(toRichHtml(text));
}

if (require.main === module) {
  main();
}

module.exports = { toRichHtml };

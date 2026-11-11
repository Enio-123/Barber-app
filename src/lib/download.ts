/** Baixa um texto como arquivo (planilha, dados da conta). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  // A marca no começo faz o Excel abrir acentos certo na planilha.
  const blob = new Blob([type.startsWith('text/csv') ? '﻿' + text : text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

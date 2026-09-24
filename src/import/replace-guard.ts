/** Import substitui TODOS os dados; sem --replace, aborta quando já há transações. */
export function replaceGuardError(argv: string[], counts: { transactions: number }): string | null {
  if (counts.transactions === 0 || argv.includes("--replace")) return null;
  return `o banco já tem ${counts.transactions} transações; use --replace para substituir (as edições feitas na UI serão perdidas)`;
}

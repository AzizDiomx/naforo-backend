/**
 * Format Date to local DD/MM/YYYY
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format amount as FCFA currency (XOF)
 * Example: 150 000 FCFA
 */
export function formatCurrency(amount: number | string): string {
  const val = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(val)) return '0 FCFA';
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA';
}

/**
 * Get the full month name in French for a specific month index and year
 * Example: getMonthName(7, 2026) -> 'Juillet 2026'
 */
export function getMonthName(month: number, year: number): string {
  const date = new Date(year, month - 1, 1);
  const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const formatted = formatter.format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Calculate due date for an invoice based on contract payment day
 */
export function getDueDate(paymentDay: number, month: number, year: number): Date {
  // Month is 1-indexed (1-12)
  // Ensure we don't overshoot month length (e.g. 31st of Feb)
  const maxDays = new Date(year, month, 0).getDate();
  const targetDay = Math.min(paymentDay, maxDays);
  return new Date(year, month - 1, targetDay, 12, 0, 0); // Noon to avoid timezone shifts
}

/**
 * Check if a due date is overdue
 */
export function isOverdue(dueDate: Date | string): boolean {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const now = new Date();
  // Strip time for comparison
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return now.getTime() > due.getTime();
}

/**
 * Calculate number of days overdue
 */
export function getDaysOverdue(dueDate: Date | string): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffTime = now.getTime() - due.getTime();
  if (diffTime <= 0) return 0;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

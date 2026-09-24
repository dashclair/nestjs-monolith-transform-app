/** The anonymization domain must never be assigned from user input. */
export function isReservedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith('@deleted.local');
}

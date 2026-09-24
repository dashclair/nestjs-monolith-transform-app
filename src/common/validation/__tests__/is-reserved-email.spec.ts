import { isReservedEmail } from '../is-reserved-email';

describe('isReservedEmail', () => {
  it.each([
    'deleted-victim-id@deleted.local',
    'any-address@deleted.local',
    'user@DELETED.LOCAL',
    '  user@Deleted.Local  ',
  ])('reserves %s regardless of local part, case or whitespace', (email) => {
    expect(isReservedEmail(email)).toBe(true);
  });

  it.each([
    'user@example.com',
    'deleted-victim-id@example.com',
    'user@notdeleted.local',
    'user@deleted.local.example.com',
    'deleted.local@example.com',
  ])('allows an address outside the reserved domain: %s', (email) => {
    expect(isReservedEmail(email)).toBe(false);
  });
});

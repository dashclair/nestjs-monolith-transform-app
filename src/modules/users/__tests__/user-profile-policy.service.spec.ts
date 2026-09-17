import { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';

import { UserProfileFieldsPolicy } from '../services/user-profile-policy.service';
import { UserProfileField } from '../types/user-profile-policy.types';

describe('UserProfileFieldsPolicy', () => {
  let policy: UserProfileFieldsPolicy;

  const buildAccess = (
    overrides: Partial<SelfOrPermissionAccess> = {},
  ): SelfOrPermissionAccess => ({
    type: 'self',
    actorUserId: 'user-1',
    resource: 'users',
    action: 'read',
    ...overrides,
  });

  beforeEach(() => {
    policy = new UserProfileFieldsPolicy();
  });

  it('grants the full field set when viewing your own profile', () => {
    const fields = policy.getAllowedFields(buildAccess({ type: 'self' }));

    expect(fields).toEqual([
      UserProfileField.Id,
      UserProfileField.Email,
      UserProfileField.Photo,
      UserProfileField.IsEmailVerified,
      UserProfileField.CreatedAt,
    ]);
  });

  it('grants a reduced field set (no isEmailVerified) for a users:read grant on someone else’s profile', () => {
    const fields = policy.getAllowedFields(
      buildAccess({ type: 'permission', resource: 'users', action: 'read' }),
    );

    expect(fields).toEqual([
      UserProfileField.Id,
      UserProfileField.Email,
      UserProfileField.Photo,
      UserProfileField.CreatedAt,
    ]);
    expect(fields).not.toContain(UserProfileField.IsEmailVerified);
  });

  it('default-denies (empty field list) for a grant on a different resource', () => {
    const fields = policy.getAllowedFields(
      buildAccess({ type: 'permission', resource: 'rbac', action: 'read' }),
    );

    expect(fields).toEqual([]);
  });

  it('default-denies (empty field list) for a users grant with a different action', () => {
    const fields = policy.getAllowedFields(
      buildAccess({ type: 'permission', resource: 'users', action: 'update' }),
    );

    expect(fields).toEqual([]);
  });
});

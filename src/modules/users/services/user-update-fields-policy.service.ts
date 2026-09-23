import { SelfOrPermissionAccess } from '@/modules/rbac';
import { Injectable } from '@nestjs/common';
import { UpdateUserDto } from '../dto/update-user.dto';

@Injectable()
export class UserUpdateFieldsPolicy {
  getAllowedFields(access: SelfOrPermissionAccess): Array<keyof UpdateUserDto> {
    if (access.type === 'self') {
      return [
        'photo',
        // other self-editable fields
      ];
    }

    if (
      access.type === 'permission' &&
      access.resource === 'users' &&
      access.action === 'update'
    ) {
      return [
        'email',
        'photo',
        // other admin/support editable fields
      ];
    }

    return [];
  }
}

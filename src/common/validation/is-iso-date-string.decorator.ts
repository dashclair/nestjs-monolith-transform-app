import {
  buildMessage,
  isISO8601,
  ValidateBy,
  ValidationOptions,
} from 'class-validator';

export function isIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string' || !isISO8601(value, { strict: true })) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999;
}

export function IsIsoDateString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIsoDateString',
      validator: {
        validate: (value): boolean => isIsoDateString(value),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid ISO 8601 date`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

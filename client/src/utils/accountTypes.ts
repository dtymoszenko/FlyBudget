import { t } from '../i18n';
import { ACCOUNT_TYPES, type AccountTypeInfo } from '../types';

const BY_TYPE = new Map(ACCOUNT_TYPES.map((info) => [info.value, info]));

/** Unknown types (e.g. from a newer version's backup) are treated as other assets */
export function accountTypeInfo(type: string): AccountTypeInfo {
  return BY_TYPE.get(type as AccountTypeInfo['value']) ?? BY_TYPE.get('other_asset')!;
}

export function isLiabilityType(type: string): boolean {
  return accountTypeInfo(type).liability;
}

/** The type's name, like "Credit Card"; an unknown type shows as it is */
export function accountTypeLabel(type: string): string {
  const info = BY_TYPE.get(type as AccountTypeInfo['value']);
  return info ? t(`accounts.types.${info.value}.label`) : type;
}

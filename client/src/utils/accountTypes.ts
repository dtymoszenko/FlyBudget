import { ACCOUNT_TYPES, type AccountTypeInfo } from '../types';

const BY_TYPE = new Map(ACCOUNT_TYPES.map((t) => [t.value, t]));

/** Unknown types (e.g. from a newer version's backup) are treated as other assets */
export function accountTypeInfo(type: string): AccountTypeInfo {
  return BY_TYPE.get(type as AccountTypeInfo['value']) ?? BY_TYPE.get('other_asset')!;
}

export function isLiabilityType(type: string): boolean {
  return accountTypeInfo(type).liability;
}

export function accountTypeLabel(type: string): string {
  return BY_TYPE.get(type as AccountTypeInfo['value'])?.label ?? type;
}

/** Homes, cars and valuables have no statements; their value is updated by hand */
export function isPropertyType(type: string): boolean {
  return accountTypeInfo(type).group === 'property';
}

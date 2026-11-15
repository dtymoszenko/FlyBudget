import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormReset } from '../../hooks/useFormReset';
import { Modal } from '../ui/Modal';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { ConfirmModal } from '../ui/ConfirmModal';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useUpdateAccount, useCloseAccount } from '../../hooks/useAccounts';
import type { Account, AccountType } from '../../types';
import { AccountIcon } from './AccountIcon';
import { AccountTypeSelect } from './AccountTypeSelect';
import { fileToSquareDataUrl } from '../../utils/imageResize';
import { usePreferencesStore } from '../../store/preferencesStore';
import { CurrencySelect } from '../currency/CurrencySelect';
import { useBudgetCurrency, useCurrencySettings } from '../../hooks/useCurrency';

interface Props {
  account: Account | null;
  onClose: () => void;
}

export function EditAccountModal({ account, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [startingBalance, setStartingBalance] = useState(0);
  const [isOffBudget, setIsOffBudget] = useState(false);
  const [currency, setCurrency] = useState<string | null>(null);
  const budgetCurrency = useBudgetCurrency();
  const { data: currencySettings } = useCurrencySettings();
  const [confirmClose, setConfirmClose] = useState(false);
  const canSave = useCanSave();
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const showAccountIcons = usePreferencesStore((s) => s.showAccountIcons);

  const updateAccount = useUpdateAccount();
  const closeAccount = useCloseAccount();

  // Filled once per opening, not on every refetch of the account (that would undo edits)
  useFormReset(account?.id ?? null, () => {
    if (!account) return;
    setName(account.name);
    setType(account.type);
    setStartingBalance(account.startingBalance);
    setIsOffBudget(account.isOffBudget === 1);
    setCurrency(account.currency);
    setLogo(account.logo ?? null);
    setLogoError(null);
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !name.trim()) return;
    await updateAccount.mutateAsync({
      id: account.id,
      data: {
        name: name.trim(),
        type,
        startingBalance,
        isOffBudget: isOffBudget ? 1 : 0,
        ...(logo !== (account.logo ?? null) ? { logo } : {}),
        ...(currency !== account.currency ? { currency } : {}),
      },
    });
    onClose();
  }

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      setLogo(await fileToSquareDataUrl(file));
      setLogoError(null);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : t('accounts.editModal.imageError'));
    }
  }

  async function handleCloseAccount() {
    if (!account) return;
    await closeAccount.mutateAsync(account.id);
    onClose();
  }

  return (
    <>
      <Modal isOpen={!!account} onClose={onClose} title={t('accounts.editModal.title')} size="sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              {t('accounts.editModal.logo')}
            </label>
            <div className="flex items-center gap-3">
              <AccountIcon name={name} type={type} logo={logo} size="lg" force />
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface border border-border rounded-md hover:bg-hover transition-colors cursor-pointer"
                  >
                    {t(logo ? 'accounts.editModal.changeImage' : 'accounts.editModal.uploadImage')}
                  </button>
                  {logo && (
                    <button
                      type="button"
                      onClick={() => setLogo(null)}
                      className="px-3 py-1.5 text-xs font-medium text-text-tertiary hover:text-negative transition-colors cursor-pointer"
                    >
                      {t('accounts.editModal.useInitials')}
                    </button>
                  )}
                </div>
                <p className={`text-xs ${logoError ? 'text-negative' : 'text-text-tertiary'}`}>
                  {logoError ??
                    t(logo ? 'accounts.editModal.cropped' : 'accounts.editModal.showingInitials')}
                </p>
                {!showAccountIcons && (
                  <p className="text-xs text-caution">{t('accounts.editModal.iconsOff')}</p>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleLogoFile}
                className="hidden"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('accounts.form.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('accounts.form.nameLabel')}
              autoFocus
              className="block w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <AccountTypeSelect value={type} onChange={setType} />

          {currency && (
            <div>
              <label
                htmlFor="edit-account-currency"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                {t('accounts.form.currency')}
              </label>
              <CurrencySelect
                id="edit-account-currency"
                value={currency}
                onChange={setCurrency}
                disabled={account?.hasTransactions}
                first={[
                  ...(budgetCurrency ? [budgetCurrency] : []),
                  ...(currencySettings?.foreignCurrencies ?? []),
                ]}
                aria-describedby="edit-account-currency-hint"
              />
              <p id="edit-account-currency-hint" className="mt-1 text-xs text-text-secondary">
                {t(
                  account?.hasTransactions
                    ? 'accounts.editModal.currencyFixed'
                    : 'accounts.form.currencyLocked',
                )}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('accounts.editModal.startingBalance')}
            </label>
            <CurrencyInput
              value={startingBalance}
              onChange={setStartingBalance}
              allowNegative
              aria-label={t('accounts.editModal.startingBalanceLabel')}
              currency={currency}
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isOffBudget}
              onChange={(e) => setIsOffBudget(e.target.checked)}
              className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-text-secondary">{t('accounts.editModal.offBudget')}</span>
          </label>

          <SavingPausedHint className="text-right" />
          <div className="flex items-center justify-between pt-2 border-t border-border-light">
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              className="text-sm text-negative hover:underline font-medium transition-colors"
            >
              {t('accounts.editModal.close')}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-surface border border-border rounded-lg hover:bg-hover transition-colors"
              >
                {t('common.actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={!name.trim() || updateAccount.isPending || !canSave}
                className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {updateAccount.isPending ? t('accounts.saving') : t('common.actions.save')}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleCloseAccount}
        title={t('accounts.closeConfirm.title')}
        message={t('accounts.closeConfirm.message', { name: account?.name ?? '' })}
        confirmLabel={t('accounts.closeConfirm.confirm')}
        danger
      />
    </>
  );
}

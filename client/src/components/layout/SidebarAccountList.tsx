import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { Plus, Building2, Link2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAccounts } from '../../hooks/useAccounts';
import { usePlaidStatus } from '../../hooks/usePlaid';
import { formatCurrency } from '../../utils/currency';
import { AddAccountModal } from '../accounts/AddAccountModal';
import { ConnectBankModal } from '../plaid/ConnectBankModal';
import { PlaidSetupModal } from '../plaid/PlaidSetupModal';
import { SimplefinConnectModal } from '../simplefin/SimplefinConnectModal';
import type { Account } from '../../types';

/** Three 36px rows plus padding */
const MENU_HEIGHT = 116;

function AccountRow({ account }: { account: Account }) {
  const isNegative = account.balance < 0;
  return (
    <NavLink
      to={`/accounts/${account.id}`}
      className={({ isActive }) =>
        `flex items-center justify-between pl-5 pr-3 py-0.5 rounded-md text-[12px] transition-all duration-150 ${
          isActive
            ? 'bg-sidebar-active text-sidebar-text-hi font-medium'
            : 'text-sidebar-text/70 hover:bg-sidebar-hover hover:text-sidebar-text-hi'
        }`
      }
    >
      <span className="truncate">{account.name}</span>
      <span
        className={`ml-2 tabular-nums text-[11px] shrink-0 ${isNegative ? 'text-negative/80' : 'text-sidebar-text/50'}`}
      >
        {formatCurrency(account.balance)}
      </span>
    </NavLink>
  );
}

export function SidebarAccountList() {
  const { data: accounts = [] } = useAccounts();
  const { data: plaidStatus } = usePlaidStatus();
  const plaidConfigured = plaidStatus?.configured ?? false;

  const [forBudgetOpen, setForBudgetOpen] = useState(false);
  const [offBudgetOpen, setOffBudgetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Fixed-position menu anchor; null = closed
  const [menuPos, setMenuPos] = useState<{ left: number; top?: number; bottom?: number } | null>(
    null,
  );
  const menuOpen = menuPos !== null;
  const setMenuOpen = (open: boolean) => {
    if (!open) return setMenuPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    // Open downward when the menu fits below the button, else upward
    setMenuPos(
      r.bottom + MENU_HEIGHT + 8 < window.innerHeight
        ? { left: r.left, top: r.bottom + 4 }
        : { left: r.left, bottom: window.innerHeight - r.top + 4 },
    );
  };
  const [connectOpen, setConnectOpen] = useState(false);
  const [plaidSetupOpen, setPlaidSetupOpen] = useState(false);
  const [simplefinOpen, setSimplefinOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setMenuPos(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuPos(null);
    }
    const close = () => setMenuPos(null);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

  const onBudget = accounts.filter((a) => a.isOffBudget === 0);
  const offBudget = accounts.filter((a) => a.isOffBudget === 1);
  const allTotal = accounts.reduce((sum, a) => sum + a.balance, 0);
  const onBudgetTotal = onBudget.reduce((sum, a) => sum + a.balance, 0);
  const offBudgetTotal = offBudget.reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      {/* Scrollable account list */}
      <div className="flex-1 overflow-y-auto px-3 mt-3">
        {/* All accounts */}
        <NavLink
          to="/accounts"
          className="flex items-center justify-between py-1.5 text-[13px] font-bold text-sidebar-text-hi hover:text-sidebar-text-hi transition-colors"
        >
          <span>All accounts</span>
          <span className="tabular-nums ml-2">{formatCurrency(allTotal)}</span>
        </NavLink>

        {/* For Budget section */}
        <div className="mt-2">
          <button
            onClick={() => setForBudgetOpen((o) => !o)}
            className="flex items-center justify-between w-full py-1.5 text-[13px] font-semibold text-sidebar-text-hi border-b border-sidebar-text/20 hover:text-sidebar-text-hi transition-colors"
          >
            <span>For budget</span>
            <span className="flex items-center gap-1">
              <span className="tabular-nums text-[12px]">{formatCurrency(onBudgetTotal)}</span>
              {forBudgetOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>
          {forBudgetOpen && (
            <div className="mt-0.5 space-y-0">
              {onBudget.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
              {onBudget.length === 0 && (
                <p className="pl-5 py-1 text-xs text-sidebar-text/50">No accounts yet</p>
              )}
            </div>
          )}
        </div>

        {/* Off Budget section */}
        {offBudget.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setOffBudgetOpen((o) => !o)}
              className="flex items-center justify-between w-full py-1.5 text-[13px] font-semibold text-sidebar-text-hi border-b border-sidebar-text/20 hover:text-sidebar-text-hi transition-colors"
            >
              <span>Off budget</span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums text-[12px]">{formatCurrency(offBudgetTotal)}</span>
                {offBudgetOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            </button>
            {offBudgetOpen && (
              <div className="mt-0.5 space-y-0">
                {offBudget.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add account */}
        <div className="mt-3">
          <button
            ref={buttonRef}
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-sidebar-text hover:text-sidebar-text-hi transition-colors"
          >
            <Plus size={14} />
            <span>Add account</span>
          </button>

          {/* Portaled so the sidebar's scroll area can't clip it */}
          {menuPos &&
            createPortal(
              <div
                ref={menuRef}
                className="fixed z-50 min-w-48 w-max bg-surface rounded-md border border-border shadow-hover py-1 animate-menu-in"
                style={menuPos}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setAddOpen(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm whitespace-nowrap text-text-secondary hover:bg-hover hover:text-text transition-colors"
                >
                  <Plus size={14} className="shrink-0" />
                  Add Manual Account
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (plaidConfigured) setConnectOpen(true);
                    else setPlaidSetupOpen(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm whitespace-nowrap text-text-secondary hover:bg-hover hover:text-text transition-colors"
                >
                  <Building2 size={14} className="shrink-0" />
                  Connect via Plaid
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setSimplefinOpen(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm whitespace-nowrap text-text-secondary hover:bg-hover hover:text-text transition-colors"
                >
                  <Link2 size={14} className="shrink-0" />
                  Connect via SimpleFIN
                </button>
              </div>,
              document.body,
            )}
        </div>
      </div>

      <AddAccountModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
      <ConnectBankModal isOpen={connectOpen} onClose={() => setConnectOpen(false)} />
      <PlaidSetupModal
        isOpen={plaidSetupOpen}
        onClose={() => setPlaidSetupOpen(false)}
        onConfigured={() => setConnectOpen(true)}
      />
      <SimplefinConnectModal isOpen={simplefinOpen} onClose={() => setSimplefinOpen(false)} />
    </>
  );
}

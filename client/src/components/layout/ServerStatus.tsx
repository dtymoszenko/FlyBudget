import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { LogOut, RefreshCw, Settings } from 'lucide-react';
import { useConnection } from '../../hooks/useConnection';
import { useAppMode, useServerInfo, useSignOut } from '../../hooks/useServer';
import { connectionSecurity } from '../../utils/connection';
import { IS_DEMO } from '../../demo/demoApi';

const MENU_W = 248;

const SECURITY_LABEL = {
  encrypted: 'Encrypted (HTTPS)',
  local: 'Stays on this computer',
  unencrypted: 'Not encrypted (HTTP)',
} as const;

/**
 * Sidebar footer: where FlyBudget's server is and whether it's reachable, like Actual
 * Budget's "Server online". Opens a small menu with details, Server settings and (server
 * mode) Sign out.
 */
export function ServerStatus({ collapsed }: { collapsed: boolean }) {
  const mode = useAppMode();
  const connection = useConnection();
  const { data: info } = useServerInfo();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  const online = connection.status === 'connected';
  // The demo's data lives in this browser tab (its "server" runs in the page)
  const place = IS_DEMO
    ? 'Demo in this browser'
    : mode === 'server'
      ? window.location.host
      : 'On this computer';
  const address = IS_DEMO
    ? 'This browser'
    : mode === 'server'
      ? window.location.host
      : 'This computer';
  const stateText = online ? 'Online' : 'Reconnecting';
  const label = `Server status: ${stateText}, ${place}`;
  const security = connectionSecurity(window.location.protocol, window.location.hostname);

  const close = (refocus = true) => {
    setPos(null);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!pos) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      )
        close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [pos]);

  function toggle() {
    if (pos) return close();
    const r = btnRef.current!.getBoundingClientRect();
    setPos({
      bottom: window.innerHeight - r.top + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
    });
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  const dot = (
    <span
      aria-hidden
      className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-positive' : 'bg-caution animate-pulse'}`}
    />
  );
  const itemClass =
    'flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text focus:bg-hover focus:text-text focus:outline-none cursor-pointer';

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={label}
        title={collapsed ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        className="flex items-center gap-2.5 w-full py-1.5 max-md:min-h-11 px-3 rounded-md text-[12px] text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-hi transition-colors"
      >
        <span className="w-[18px] flex justify-center shrink-0">{dot}</span>
        <span
          className={`truncate transition-opacity duration-200 ${collapsed ? 'opacity-0' : 'opacity-100'}`}
        >
          {online ? place : 'Reconnecting…'}
        </span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Server"
            onKeyDown={onMenuKey}
            className="fixed z-50 bg-surface border border-border rounded-md shadow-hover py-1 animate-menu-in"
            style={{ bottom: pos.bottom, left: pos.left, width: MENU_W }}
          >
            <div role="presentation" className="px-3 pt-1.5 pb-2 space-y-1 text-xs">
              <p className="flex items-center gap-2 text-sm font-medium text-text">
                {dot}
                {online ? 'Server online' : 'Reconnecting to the server'}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-text-secondary">
                <dt className="text-text-tertiary">Address</dt>
                <dd className="truncate font-mono text-[11px] leading-5">{address}</dd>
                <dt className="text-text-tertiary">Connection</dt>
                <dd>{mode === 'server' ? SECURITY_LABEL[security] : SECURITY_LABEL.local}</dd>
                <dt className="text-text-tertiary">Version</dt>
                <dd>{info?.version ?? '…'}</dd>
              </dl>
            </div>
            <div role="separator" className="my-1 border-t border-border-light" />
            {!online && (
              <button
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => void connection.retryNow()}
              >
                <RefreshCw size={14} /> Retry now
              </button>
            )}
            <button
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              onClick={() => {
                close(false);
                navigate('/settings?tab=server');
              }}
            >
              <Settings size={14} /> Server settings
            </button>
            {mode === 'server' && (
              <button
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => {
                  close(false);
                  void signOut();
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

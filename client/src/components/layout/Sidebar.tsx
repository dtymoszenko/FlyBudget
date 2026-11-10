import { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Landmark,
  ArrowLeftRight,
  Wallet,
  Repeat,
  BarChart3,
  Workflow,
  Target,
  Users,
  Zap,
  Settings,
  Pin,
  X,
  CircleHelp,
} from 'lucide-react';
import { usePreferencesStore } from '../../store/preferencesStore';
import { SidebarAccountList } from './SidebarAccountList';
import { ServerStatus } from './ServerStatus';
import { useAutoHideExpansion } from './useAutoHideExpansion';
import { DOCS_URL } from '../../utils/project';
import { BrandName } from '../ui/BrandName';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STEP,
} from '../../utils/sidebarWidth';
import logoUrl from '/logo.png';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      data-nav-to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        // Phones (the drawer): full-size touch targets
        `flex items-center gap-2.5 py-1.5 max-md:min-h-11 max-md:text-[15px] px-3 rounded-md text-[13px] font-medium relative ${
          isActive
            ? 'bg-sidebar-active text-sidebar-text-hi before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-brand-500 before:rounded-r-full'
            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-hi'
        }`
      }
    >
      {icon}
      <span
        className={`truncate transition-opacity duration-200 ${
          collapsed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {label}
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);
  const width = usePreferencesStore((s) => s.sidebarWidth);
  const asideRef = useRef<HTMLElement>(null);
  const isAutoHide = sidebarMode === 'auto-hide';
  const { isExpanded, ...expansionHandlers } = useAutoHideExpansion(asideRef, isAutoHide);

  return (
    <aside
      ref={asideRef}
      {...expansionHandlers}
      style={isAutoHide ? undefined : { width }}
      className={
        isAutoHide
          ? 'w-16 shrink-0 h-screen relative z-30'
          : 'shrink-0 h-screen relative border-r border-sidebar-border'
      }
    >
      {/* overflow-clip, not hidden: a hidden box can still be scrolled, and focusing something
          past its edge would slide the content sideways */}
      <div
        style={isAutoHide && isExpanded ? { width } : undefined}
        className={
          isAutoHide
            ? `absolute left-0 top-0 h-full overflow-clip border-r border-sidebar-border transition-[width,box-shadow] duration-200 motion-reduce:transition-none ${
                isExpanded ? 'shadow-xl' : 'w-16'
              }`
            : 'w-full h-full overflow-clip'
        }
      >
        <SidebarContent isExpanded={isExpanded} width={width} />
      </div>
      {!isAutoHide && <ResizeHandle width={width} />}
    </aside>
  );
}

/** The pinned sidebar's right edge: drag it (or use the arrow keys) to change the width; double-click resets it. */
function ResizeHandle({ width }: { width: number }) {
  const setWidth = usePreferencesStore((s) => s.setSidebarWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(drag.current.startWidth + e.clientX - drag.current.startX);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowLeft'
        ? width - SIDEBAR_WIDTH_STEP
        : e.key === 'ArrowRight'
          ? width + SIDEBAR_WIDTH_STEP
          : e.key === 'Home'
            ? SIDEBAR_MIN_WIDTH
            : e.key === 'End'
              ? SIDEBAR_MAX_WIDTH
              : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none"
      >
        <div
          className={`mx-auto h-full w-0.5 transition-colors group-focus-visible:w-1 group-focus-visible:bg-brand-500 ${
            dragging ? 'bg-brand-500' : 'group-hover:bg-brand-500/60'
          }`}
        />
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 hidden h-8 w-2 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full bg-brand-500 ring-2 ring-sidebar-bg group-focus-visible:flex"
        >
          <span className="size-0.5 rounded-full bg-white" />
          <span className="size-0.5 rounded-full bg-white" />
          <span className="size-0.5 rounded-full bg-white" />
        </div>
      </div>
      {/* Keeps the resize cursor and stops text selection while the pointer is over the page */}
      {dragging && <div aria-hidden className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}

/** The sidebar's links, account list and footer, shared by the desktop sidebar and the phone drawer. */
function SidebarContent({
  isExpanded,
  onClose,
  width = SIDEBAR_DEFAULT_WIDTH,
}: {
  isExpanded: boolean;
  onClose?: () => void;
  width?: number | string;
}) {
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);
  const setSidebarMode = usePreferencesStore((s) => s.setSidebarMode);
  const pinned = sidebarMode === 'persistent';
  const headerButton =
    'relative p-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-hi';

  return (
    // Phones scroll the whole drawer, so the account list keeps its height on short screens
    <div style={{ width }} className="h-full flex flex-col bg-sidebar-bg max-md:overflow-y-auto">
      {/* Logo. Stays in view while the phone drawer scrolls, so "Close menu" can always be reached */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-sidebar-border max-md:sticky max-md:top-0 max-md:z-10 max-md:bg-sidebar-bg">
        <img src={logoUrl} alt="" className="w-7 h-7 shrink-0" />
        {/* The sidebar is dark in both themes, so "Budget" is always light here */}
        <BrandName
          className={`text-sm font-semibold tracking-tight transition-opacity duration-200 ${
            isExpanded ? 'opacity-100' : 'opacity-0'
          }`}
          flyClassName="text-brand-500"
          budgetClassName="text-sidebar-text-hi"
        />
        <div
          data-escape-to="/dashboard"
          className={`ml-auto -mr-1.5 flex items-center gap-0.5 transition-opacity duration-200 ${
            isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Help & docs (opens in a new tab)"
            className={`group ${headerButton}`}
          >
            <CircleHelp size={16} aria-hidden />
            <HeaderTooltip>Help &amp; docs</HeaderTooltip>
          </a>
          {/* The phone drawer closes; the desktop sidebar has a pin instead: pinned stays open,
              unpinned collapses and opens on hover (the Sidebar setting in Preferences) */}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className={headerButton}
            >
              <X size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarMode(pinned ? 'auto-hide' : 'persistent')}
              aria-pressed={pinned}
              aria-label="Pin sidebar"
              className={`group ${headerButton}`}
            >
              <Pin
                size={16}
                aria-hidden
                fill={pinned ? 'currentColor' : 'none'}
                className={pinned ? 'text-sidebar-text-hi' : undefined}
              />
              <HeaderTooltip>{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</HeaderTooltip>
            </button>
          )}
        </div>
      </div>

      {/* Primary nav */}
      <nav aria-label="Main" className="pt-3 px-3 space-y-0.5">
        <NavItem
          to="/dashboard"
          icon={<LayoutDashboard size={18} />}
          label="Dashboard"
          collapsed={!isExpanded}
        />
        <NavItem
          to="/accounts"
          icon={<Landmark size={18} />}
          label="Accounts"
          collapsed={!isExpanded}
        />
        <NavItem
          to="/transactions"
          icon={<ArrowLeftRight size={18} />}
          label="Transactions"
          collapsed={!isExpanded}
        />
        <NavItem to="/budget" icon={<Wallet size={18} />} label="Budget" collapsed={!isExpanded} />
        <NavItem
          to="/recurring"
          icon={<Repeat size={18} />}
          label="Recurring"
          collapsed={!isExpanded}
        />
        <NavItem
          to="/reports"
          icon={<BarChart3 size={18} />}
          label="Reports"
          collapsed={!isExpanded}
        />
        <NavItem
          to="/cash-flow"
          icon={<Workflow size={18} />}
          label="Cash Flow"
          collapsed={!isExpanded}
        />
        <NavItem to="/goals" icon={<Target size={18} />} label="Goals" collapsed={!isExpanded} />
      </nav>

      {/* Account list */}
      <div
        data-escape-to="/accounts"
        className={`flex-1 max-md:flex-[1_0_auto] flex flex-col min-h-0 overflow-hidden transition-opacity duration-200 ${
          isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <SidebarAccountList />
      </div>

      {/* Footer nav */}
      <nav aria-label="Manage" className="py-2 px-3 border-t border-sidebar-border space-y-0.5">
        <NavItem to="/payees" icon={<Users size={18} />} label="Payees" collapsed={!isExpanded} />
        <NavItem to="/rules" icon={<Zap size={18} />} label="Rules" collapsed={!isExpanded} />
        <NavItem
          to="/settings"
          icon={<Settings size={18} />}
          label="Settings"
          collapsed={!isExpanded}
        />
      </nav>

      {/* Where the data lives and whether the server is reachable. Stays in view while the
          phone drawer scrolls, like the logo */}
      <div className="py-1.5 px-3 border-t border-sidebar-border max-md:sticky max-md:bottom-0 max-md:z-10 max-md:bg-sidebar-bg">
        <ServerStatus collapsed={!isExpanded} />
      </div>
    </div>
  );
}

/** A small label under a sidebar header icon, shown on hover and keyboard focus */
function HeaderTooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-full right-0 mt-1.5 z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:hidden"
    >
      {children}
    </span>
  );
}

/**
 * Phones: the sidebar slides in over the whole page from a menu button (see AppShell). It's
 * inert while closed, so its links can't be reached by Tab or screen readers.
 */
export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside
      id="app-sidebar"
      inert={!open}
      // Hidden once closed (so nothing inside can be reached), but only after sliding out;
      // visible straight away when opening, so focus can move in. Full screen: it's only
      // open while choosing where to go
      className={`fixed inset-0 z-50 overflow-hidden duration-200 ${
        open
          ? 'visible translate-x-0 shadow-xl transition-[translate]'
          : 'invisible -translate-x-full transition-[translate,visibility]'
      }`}
    >
      <SidebarContent isExpanded onClose={onClose} width="100%" />
    </aside>
  );
}

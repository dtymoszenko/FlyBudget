import { useState, useCallback } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { usePreferencesStore } from '../../store/preferencesStore';
import { SidebarAccountList } from './SidebarAccountList';
import { ServerStatus } from './ServerStatus';
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
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 py-1.5 px-3 rounded-md text-[13px] font-medium relative ${
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
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.setSidebarCollapsed);
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);

  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => {
    if (sidebarMode === 'auto-hide') setHovered(true);
  }, [sidebarMode]);

  const handleMouseLeave = useCallback(() => {
    if (sidebarMode === 'auto-hide') setHovered(false);
  }, [sidebarMode]);

  const isAutoHide = sidebarMode === 'auto-hide';
  const isExpanded = isAutoHide ? hovered : !collapsed;

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={
        isAutoHide
          ? 'w-16 shrink-0 h-screen relative z-30'
          : `shrink-0 h-screen overflow-hidden border-r border-sidebar-border transition-[width] duration-200 ${
              isExpanded ? 'w-[208px]' : 'w-16'
            }`
      }
    >
      <div
        className={
          isAutoHide
            ? `absolute left-0 top-0 h-full overflow-hidden border-r border-sidebar-border transition-[width,box-shadow] duration-200 ${
                isExpanded ? 'w-[208px] shadow-xl' : 'w-16'
              }`
            : 'w-full h-full'
        }
      >
        <div className="w-[208px] h-full flex flex-col bg-sidebar-bg">
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-sidebar-border">
            <img src={logoUrl} alt="FlyBudget" className="w-7 h-7 shrink-0" />
            <span
              className={`text-sm font-semibold text-sidebar-text-hi tracking-tight transition-opacity duration-200 ${
                isExpanded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              FlyBudget
            </span>
          </div>

          {/* Primary nav */}
          <nav className="pt-3 px-3 space-y-0.5">
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
            <NavItem
              to="/budget"
              icon={<Wallet size={18} />}
              label="Budget"
              collapsed={!isExpanded}
            />
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
            <NavItem
              to="/goals"
              icon={<Target size={18} />}
              label="Goals"
              collapsed={!isExpanded}
            />
          </nav>

          {/* Account list */}
          <div
            className={`flex-1 flex flex-col min-h-0 overflow-hidden transition-opacity duration-200 ${
              isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <SidebarAccountList />
          </div>

          {/* Footer nav */}
          <nav className="py-2 px-3 border-t border-sidebar-border space-y-0.5">
            <NavItem
              to="/payees"
              icon={<Users size={18} />}
              label="Payees"
              collapsed={!isExpanded}
            />
            <NavItem to="/rules" icon={<Zap size={18} />} label="Rules" collapsed={!isExpanded} />
            <NavItem
              to="/settings"
              icon={<Settings size={18} />}
              label="Settings"
              collapsed={!isExpanded}
            />
          </nav>

          {/* Where the data lives and whether the server is reachable */}
          <div className="py-1.5 px-3 border-t border-sidebar-border">
            <ServerStatus collapsed={!isExpanded} />
          </div>

          {/* Collapse toggle — persistent mode only */}
          {sidebarMode === 'persistent' && (
            <div className="py-2 px-3 border-t border-sidebar-border">
              <button
                onClick={() => toggle(!collapsed)}
                className="flex items-center gap-2 w-full py-1.5 px-3 rounded-md text-[13px] text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-hi transition-colors"
                title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                {isExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                <span
                  className={`transition-opacity duration-200 ${
                    isExpanded ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  Collapse
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

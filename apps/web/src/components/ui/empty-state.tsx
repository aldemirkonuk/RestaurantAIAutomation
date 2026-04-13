import { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import {
  Wine,
  Package,
  ShoppingCart,
  Bell,
  FileText,
  Search,
  Plus,
  AlertCircle,
  Inbox,
  Calendar,
  Users,
  TrendingUp,
} from 'lucide-react';

interface EmptyStateProps {
  /** Icon to display */
  icon?: ReactNode;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Empty State Component
 * 
 * Displays a friendly message when there's no data to show.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizeClasses = {
    sm: {
      container: 'py-8',
      icon: 'w-10 h-10',
      iconWrapper: 'p-3',
      title: 'text-lg',
      description: 'text-sm',
      button: 'px-4 py-2 text-sm',
    },
    md: {
      container: 'py-12',
      icon: 'w-12 h-12',
      iconWrapper: 'p-4',
      title: 'text-xl',
      description: 'text-base',
      button: 'px-5 py-2.5 text-sm',
    },
    lg: {
      container: 'py-16',
      icon: 'w-16 h-16',
      iconWrapper: 'p-5',
      title: 'text-2xl',
      description: 'text-lg',
      button: 'px-6 py-3 text-base',
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizes.container,
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-4 rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
            sizes.iconWrapper
          )}
        >
          <div className={sizes.icon}>{icon}</div>
        </div>
      )}
      <h3
        className={cn(
          'font-semibold text-gray-900 dark:text-gray-100',
          sizes.title
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-2 max-w-md text-gray-500 dark:text-gray-400',
            sizes.description
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className={cn(
            'mt-6 inline-flex items-center gap-2 rounded-xl bg-wine-600 font-medium text-white transition-colors hover:bg-wine-700',
            sizes.button
          )}
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

// ==================== Pre-built Empty States ====================

/**
 * Empty inventory state
 */
export function EmptyInventory({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<Wine className="w-full h-full" />}
      title="No wines in inventory"
      description="Start by adding wines to your inventory. You can import from your wine library or add them manually."
      action={
        onAdd
          ? {
              label: 'Add Wine',
              onClick: onAdd,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Empty orders state
 */
export function EmptyOrders({ onCreateOrder }: { onCreateOrder?: () => void }) {
  return (
    <EmptyState
      icon={<ShoppingCart className="w-full h-full" />}
      title="No orders yet"
      description="When you create procurement orders, they'll appear here. You can track their status and manage deliveries."
      action={
        onCreateOrder
          ? {
              label: 'Create Order',
              onClick: onCreateOrder,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Empty notifications state
 */
export function EmptyNotifications() {
  return (
    <EmptyState
      icon={<Bell className="w-full h-full" />}
      title="All caught up!"
      description="You have no new notifications. We'll let you know when something needs your attention."
    />
  );
}

/**
 * Empty search results state
 */
export function EmptySearchResults({
  query,
  onClear,
}: {
  query?: string;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      icon={<Search className="w-full h-full" />}
      title="No results found"
      description={
        query
          ? `We couldn't find anything matching "${query}". Try adjusting your search or filters.`
          : "We couldn't find anything matching your search. Try adjusting your filters."
      }
      action={
        onClear
          ? {
              label: 'Clear Search',
              onClick: onClear,
            }
          : undefined
      }
    />
  );
}

/**
 * Empty reports state
 */
export function EmptyReports({ onGenerate }: { onGenerate?: () => void }) {
  return (
    <EmptyState
      icon={<FileText className="w-full h-full" />}
      title="No reports generated"
      description="Generate your first report to see insights about your inventory, sales, and procurement."
      action={
        onGenerate
          ? {
              label: 'Generate Report',
              onClick: onGenerate,
              icon: <TrendingUp className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Empty providers state
 */
export function EmptyProviders({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<Users className="w-full h-full" />}
      title="No providers added"
      description="Add your wine providers to start managing orders and comparing prices."
      action={
        onAdd
          ? {
              label: 'Add Provider',
              onClick: onAdd,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Empty scheduled tasks state
 */
export function EmptyScheduledTasks({ onSchedule }: { onSchedule?: () => void }) {
  return (
    <EmptyState
      icon={<Calendar className="w-full h-full" />}
      title="No scheduled tasks"
      description="Set up recurring orders or scheduled reports to automate your workflow."
      action={
        onSchedule
          ? {
              label: 'Schedule Task',
              onClick: onSchedule,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Simple error state (deprecated - use ErrorState from error-state.tsx instead)
 * @deprecated Use ErrorState component from error-state.tsx for more features
 */
export function SimpleErrorState({
  title = 'Something went wrong',
  description = 'An error occurred while loading this content. Please try again.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={<AlertCircle className="w-full h-full text-rose-500" />}
      title={title}
      description={description}
      action={
        onRetry
          ? {
              label: 'Try Again',
              onClick: onRetry,
            }
          : undefined
      }
    />
  );
}

/**
 * Generic empty inbox state
 */
export function EmptyInbox({ message }: { message?: string }) {
  return (
    <EmptyState
      icon={<Inbox className="w-full h-full" />}
      title="Nothing here yet"
      description={message || "This section is empty. Content will appear here when it's available."}
      size="sm"
    />
  );
}

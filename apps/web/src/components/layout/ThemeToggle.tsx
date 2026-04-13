import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { cn } from '../../lib/utils';

interface ThemeToggleProps {
  /** Show all three options (light, dark, system) */
  showSystem?: boolean;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Theme Toggle Component
 * 
 * A button to toggle between light and dark themes.
 * Optionally shows a system theme option.
 */
export function ThemeToggle({
  showSystem = false,
  className,
  size = 'md',
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  const sizeClasses = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-2.5',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  if (showSystem) {
    return (
      <div
        className={cn(
          'flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800',
          className
        )}
      >
        <button
          onClick={() => setTheme('light')}
          className={cn(
            'rounded-lg transition-colors',
            sizeClasses[size],
            theme === 'light'
              ? 'bg-white text-amber-500 shadow-sm dark:bg-gray-700'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          )}
          title="Light mode"
        >
          <Sun className={iconSizes[size]} />
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={cn(
            'rounded-lg transition-colors',
            sizeClasses[size],
            theme === 'dark'
              ? 'bg-white text-indigo-500 shadow-sm dark:bg-gray-700'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          )}
          title="Dark mode"
        >
          <Moon className={iconSizes[size]} />
        </button>
        <button
          onClick={() => setTheme('system')}
          className={cn(
            'rounded-lg transition-colors',
            sizeClasses[size],
            theme === 'system'
              ? 'bg-white text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-200'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          )}
          title="System preference"
        >
          <Monitor className={iconSizes[size]} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        'rounded-xl bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        sizeClasses[size],
        className
      )}
      title={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
    >
      {resolvedTheme === 'light' ? (
        <Moon className={iconSizes[size]} />
      ) : (
        <Sun className={iconSizes[size]} />
      )}
    </button>
  );
}

/**
 * Theme Toggle with Label
 */
export function ThemeToggleWithLabel({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Theme
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Choose your preferred theme
        </p>
      </div>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  );
}

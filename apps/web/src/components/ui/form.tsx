import { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'
import { AlertCircle } from 'lucide-react'

// ==================== Form Field Wrapper ====================

interface FormFieldProps {
  children: ReactNode
  error?: string
  className?: string
}

export function FormField({ children, error, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {children}
      {error && <FormError>{error}</FormError>}
    </div>
  )
}

// ==================== Form Label ====================

interface FormLabelProps {
  children: ReactNode
  required?: boolean
  htmlFor?: string
  className?: string
}

export function FormLabel({ children, required, htmlFor, className }: FormLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'block text-sm font-medium text-gray-700 dark:text-gray-300',
        className
      )}
    >
      {children}
      {required && <span className="ml-1 text-rose-500" aria-label="required">*</span>}
    </label>
  )
}

// ==================== Form Error ====================

interface FormErrorProps {
  children: ReactNode
  className?: string
}

export function FormError({ children, className }: FormErrorProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ==================== Form Description ====================

interface FormDescriptionProps {
  children: ReactNode
  className?: string
}

export function FormDescription({ children, className }: FormDescriptionProps) {
  return (
    <p className={cn('text-sm text-gray-500 dark:text-gray-400', className)}>
      {children}
    </p>
  )
}

// ==================== Form Input ====================

export interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string
  label?: string
  required?: boolean
  description?: string
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ error, label, required, description, className, id, ...props }, ref) => {
    const inputId = id || props.name || `input-${Math.random().toString(36).slice(2)}`
    const descriptionId = description ? `${inputId}-description` : undefined
    const errorId = error ? `${inputId}-error` : undefined

    return (
      <FormField error={error}>
        {label && (
          <FormLabel htmlFor={inputId} required={required}>
            {label}
          </FormLabel>
        )}
        {description && <FormDescription>{description}</FormDescription>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-4 py-2.5 border rounded-lg transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'text-gray-900 placeholder:text-gray-500',
            error
              ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/10'
              : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800',
            'dark:text-gray-100 dark:placeholder:text-gray-500',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : descriptionId}
          {...props}
        />
      </FormField>
    )
  }
)

FormInput.displayName = 'FormInput'

// ==================== Form Textarea ====================

export interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
  label?: string
  required?: boolean
  description?: string
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ error, label, required, description, className, id, ...props }, ref) => {
    const inputId = id || props.name || `textarea-${Math.random().toString(36).slice(2)}`
    const descriptionId = description ? `${inputId}-description` : undefined
    const errorId = error ? `${inputId}-error` : undefined

    return (
      <FormField error={error}>
        {label && (
          <FormLabel htmlFor={inputId} required={required}>
            {label}
          </FormLabel>
        )}
        {description && <FormDescription>{description}</FormDescription>}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-4 py-2.5 border rounded-lg transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'resize-none',
            'text-gray-900 placeholder:text-gray-500',
            error
              ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/10'
              : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800',
            'dark:text-gray-100 dark:placeholder:text-gray-500',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : descriptionId}
          {...props}
        />
      </FormField>
    )
  }
)

FormTextarea.displayName = 'FormTextarea'

// ==================== Form Select ====================

export interface FormSelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  error?: string
  label?: string
  required?: boolean
  description?: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
}

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ error, label, required, description, options, className, id, ...props }, ref) => {
    const selectId = id || props.name || `select-${Math.random().toString(36).slice(2)}`
    const descriptionId = description ? `${selectId}-description` : undefined
    const errorId = error ? `${selectId}-error` : undefined

    return (
      <FormField error={error}>
        {label && (
          <FormLabel htmlFor={selectId} required={required}>
            {label}
          </FormLabel>
        )}
        {description && <FormDescription>{description}</FormDescription>}
        <select
          ref={ref as any}
          id={selectId}
          className={cn(
            'w-full px-4 py-2.5 border rounded-lg transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'text-gray-900',
            error
              ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/10'
              : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800',
            'dark:text-gray-100',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : descriptionId}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>
    )
  }
)

FormSelect.displayName = 'FormSelect'

// ==================== Form Section ====================

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

// ==================== Form Actions ====================

interface FormActionsProps {
  children: ReactNode
  className?: string
}

export function FormActions({ children, className }: FormActionsProps) {
  return (
    <div className={cn('flex items-center gap-3 pt-4', className)}>
      {children}
    </div>
  )
}

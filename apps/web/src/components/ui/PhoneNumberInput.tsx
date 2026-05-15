import PhoneInput, { type Country } from 'react-phone-number-input'
import en from 'react-phone-number-input/locale/en.json'
import 'react-phone-number-input/style.css'
import { countryToPhoneDefault } from '../../lib/phone'
import { cn } from '../../lib/utils'

export interface PhoneNumberInputProps {
  value: string
  onChange: (value: string) => void
  /** Restaurant / address country label — sets flag + dial code + national format */
  countryHint?: string
  disabled?: boolean
  className?: string
  id?: string
  invalid?: boolean
}

export function PhoneNumberInput({
  value,
  onChange,
  countryHint,
  disabled,
  className,
  id,
  invalid,
}: PhoneNumberInputProps) {
  const defaultCountry = countryToPhoneDefault(countryHint) as Country

  return (
    <PhoneInput
      id={id}
      key={defaultCountry}
      international
      countryCallingCodeEditable={false}
      defaultCountry={defaultCountry}
      labels={en}
      value={value || undefined}
      onChange={(next) => onChange(next ?? '')}
      disabled={disabled}
      className={cn('wineops-phone-input', invalid && 'wineops-phone-input--invalid', className)}
      numberInputProps={{
        className: 'wineops-phone-input__number',
        'aria-invalid': invalid,
      }}
    />
  )
}

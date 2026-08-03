import { cn } from '@/lib/cn';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  inputMode?: 'text' | 'decimal' | 'numeric';
  className?: string;
}

export function Input({ value, onChange, placeholder, type = 'text', inputMode, className }: InputProps) {
  return (
    <input
      value={value}
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full rounded-(--radius-app) border border-border bg-surface px-4 py-3 text-text',
        'placeholder:text-dim focus:border-brand focus:outline-none',
        className,
      )}
    />
  );
}

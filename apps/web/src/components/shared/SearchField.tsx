import { MagnifyingGlass } from '@phosphor-icons/react';
import { useRef, useEffect } from 'react';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchField({
  value,
  onChange,
  placeholder = '搜索...',
  autoFocus = false,
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <label className="search-field">
      <MagnifyingGlass size={18} />
      <span className="sr-only">{placeholder}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

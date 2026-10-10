import { useState } from 'react';

interface TagInputProps {
  existing: string[];
  onAdd: (tag: string) => void;
}

/**
 * Inline tag input that lets users type a tag name and press Enter to add it.
 * Prevents duplicate tags via the `existing` list.
 */
export function TagInput({ existing, onAdd }: TagInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !existing.includes(trimmed)) {
      onAdd(trimmed);
      setValue('');
    }
  };

  return (
    <span className="tag-input-wrap">
      <input
        className="tag-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="+ 标签"
        size={8}
        aria-label="添加标签"
      />
    </span>
  );
}

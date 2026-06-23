import { BracketsCurly, Check, MagnifyingGlass, Plus, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaDisplayNode } from '../../../types';
import { SchemaGeneratorDialog } from './SchemaGeneratorDialog';

interface SchemaRefInputProps {
  value: string | undefined;
  /** All available schemas in the registry. */
  schemas: Record<string, SchemaDisplayNode>;
  onChange: (schemaRef: string | undefined) => void;
  /** Called when user creates a new schema. */
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Schema reference input with autocomplete.
 *
 * Replaces a plain `<input>` for schemaRef fields. Provides:
 * - Searchable dropdown of all existing schemas
 * - Real-time validation (green check / red warning)
 * - Schema preview on selection (name, type, field count)
 * - "Create new schema" action that opens the SchemaGeneratorDialog
 *
 * Follows the industry-standard combobox pattern used by Postman, Stoplight, and Insomnia.
 */
export function SchemaRefInput({
  value,
  schemas,
  onChange,
  onCreateSchema,
  placeholder = '选择或搜索 Schema…',
  ariaLabel = 'Schema 引用',
}: SchemaRefInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const schemaEntries = useMemo(() => Object.entries(schemas), [schemas]);

  // Find the resolved schema for the current value
  const resolved = useMemo(() => (value ? schemas[value] : undefined), [value, schemas]);

  // Filter schemas by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return schemaEntries;
    const q = query.toLowerCase();
    return schemaEntries.filter(
      ([id, s]) =>
        id.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    );
  }, [schemaEntries, query]);

  // Count object properties for preview
  const fieldCount = useMemo(() => {
    if (!resolved?.properties) return 0;
    return Object.keys(resolved.properties).length;
  }, [resolved]);

  // Reset active index when filtered results change
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setIsOpen(true);
          e.preventDefault();
        }
        return;
      }

      // Compute max navigable index — "create new" only when onCreateSchema is provided
      const maxIndex = onCreateSchema ? filtered.length : Math.max(0, filtered.length - 1);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, maxIndex));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex < filtered.length) {
            selectSchema(filtered[activeIndex][0]);
          } else if (activeIndex === filtered.length && onCreateSchema) {
            setShowGenerator(true);
            setIsOpen(false);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setQuery('');
          break;
      }
    },
    [isOpen, filtered, activeIndex, onCreateSchema],
  );

  const selectSchema = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const clearSelection = () => {
    onChange(undefined);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setQuery(inputValue);
    setIsOpen(true);

    // If the user deletes the text, clear the selection
    if (inputValue === '' && value) {
      onChange(undefined);
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  const isValid = value && resolved;
  const isInvalid = value && !resolved;

  return (
    <div className="schema-ref-input" ref={containerRef}>
      <div className="schema-ref-input-wrapper">
        {/* Status indicator */}
        {isValid ? (
          <Check size={14} weight="bold" className="schema-ref-status schema-ref-status--valid" />
        ) : isInvalid ? (
          <Warning
            size={14}
            weight="fill"
            className="schema-ref-status schema-ref-status--invalid"
          />
        ) : (
          <MagnifyingGlass size={14} className="schema-ref-status schema-ref-status--idle" />
        )}

        <input
          ref={inputRef}
          className="input input--cell schema-ref-input-field"
          value={isOpen ? query : (value ?? '')}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
        />

        {value ? (
          <button
            className="schema-ref-clear"
            type="button"
            onClick={clearSelection}
            aria-label="清除 Schema 引用"
            tabIndex={-1}
          >
            ×
          </button>
        ) : null}
      </div>

      {/* Validation message */}
      {isInvalid ? (
        <div className="schema-ref-warning">
          <Warning size={12} />
          <span>
            Schema <code>{value}</code> 未在注册表中找到。
          </span>
        </div>
      ) : null}

      {/* Schema preview on valid selection */}
      {isValid && resolved && !isOpen ? (
        <div className="schema-ref-preview">
          <BracketsCurly size={14} />
          <span className="schema-ref-preview-name">{resolved.displayName}</span>
          <span className="schema-ref-preview-type">{resolved.type ?? 'object'}</span>
          {fieldCount > 0 ? (
            <span className="schema-ref-preview-fields">{fieldCount} 个字段</span>
          ) : null}
          {resolved.description ? (
            <span className="schema-ref-preview-desc">{resolved.description}</span>
          ) : null}
        </div>
      ) : null}

      {/* Dropdown */}
      {isOpen ? (
        <div className="schema-ref-dropdown" ref={listRef} role="listbox">
          {filtered.length === 0 && !onCreateSchema ? (
            <div className="schema-ref-dropdown-empty">未找到匹配的 Schema。</div>
          ) : filtered.length === 0 && onCreateSchema ? (
            <div className="schema-ref-dropdown-empty">
              未找到匹配的 Schema。
              <button
                className="button button--ghost button--xs"
                type="button"
                onClick={() => {
                  setShowGenerator(true);
                  setIsOpen(false);
                }}
              >
                <Plus size={12} />
                新建 Schema
              </button>
            </div>
          ) : (
            <>
              {filtered.map(([id, schema], i) => (
                <button
                  key={id}
                  className={`schema-ref-option${i === activeIndex ? ' schema-ref-option--active' : ''}${id === value ? ' schema-ref-option--selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={id === value}
                  onClick={() => selectSchema(id)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div className="schema-ref-option-main">
                    <BracketsCurly size={14} />
                    <span className="schema-ref-option-name">{schema.displayName}</span>
                    <span className="schema-ref-option-type">{schema.type ?? 'object'}</span>
                  </div>
                  <span className="schema-ref-option-id">{id}</span>
                </button>
              ))}

              {/* "Create new" option */}
              {onCreateSchema ? (
                <button
                  className={`schema-ref-option schema-ref-option--create${activeIndex === filtered.length ? ' schema-ref-option--active' : ''}`}
                  type="button"
                  role="option"
                  onClick={() => {
                    setShowGenerator(true);
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setActiveIndex(filtered.length)}
                >
                  <Plus size={14} />
                  <span>新建 Schema…</span>
                </button>
              ) : null}
            </>
          )}

          {/* Auto-select: if query matches an existing schema ID exactly */}
          {query &&
          !filtered.some(([id]) => id === query) &&
          !filtered.some(([id]) => id.toLowerCase() === query.toLowerCase()) &&
          schemaEntries.some(([id]) => id.toLowerCase() === query.toLowerCase())
            ? null
            : null}
        </div>
      ) : null}

      {/* Schema generator dialog */}
      {onCreateSchema ? (
        <SchemaGeneratorDialog
          open={showGenerator}
          schemas={schemas}
          onCreate={(schema) => {
            onCreateSchema(schema);
            onChange(schema.id);
            setShowGenerator(false);
          }}
          onClose={() => setShowGenerator(false)}
        />
      ) : null}
    </div>
  );
}

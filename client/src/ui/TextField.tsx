import { AlertCircle } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

type Common = {
  label: string;
  /** Helper text under the field; replaced by `error` when there is one. */
  supporting?: ReactNode;
  error?: string | null;
};
type InputProps = Common & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'>;
type AreaProps = Common & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'placeholder'>;

/**
 * Material 3 filled text field: the label floats up on focus or when there's a value, the bottom
 * indicator thickens to the primary color on focus, and a supporting-text row is always reserved
 * so an error never pushes the layout around.
 */
export function TextField(props: InputProps | AreaProps) {
  const { label, supporting, error, multiline, className, ...rest } = props;
  const id = useId();
  const supportId = `${id}-support`;
  const value = typeof rest.value === 'string' ? rest.value : '';
  const max = rest.maxLength;
  const shared = {
    id,
    // A single space keeps :placeholder-shown working, which drives the floating label in CSS.
    placeholder: ' ',
    className: 'tf-input',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': supportId,
  };

  return (
    <div className={`tf-wrap${className ? ` ${className}` : ''}`}>
      <div className={`tf state-layer${multiline ? ' is-multiline' : ''}${error ? ' is-error' : ''}`}>
        {multiline ? (
          <textarea {...shared} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        ) : (
          <input {...shared} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
        )}
        <label className="tf-label" htmlFor={id}>
          {label}
          {rest.required && <span aria-hidden="true">*</span>}
        </label>
        {error && <AlertCircle className="tf-trailing" size={20} aria-hidden="true" />}
      </div>
      <div className={`tf-support${error ? ' is-error' : ''}`} id={supportId}>
        <span>{error || supporting}</span>
        {multiline && max !== undefined && (
          <span className="tf-counter">
            {value.length.toLocaleString()} / {max.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

import React from 'react';

type ClassValue = string | false | null | undefined;

/** Joins class strings, dropping falsy branches. */
export const cx = (...values: ClassValue[]): string => values.filter(Boolean).join(' ');

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** default surface card; `muted` sits on the page background */
  tone?: 'default' | 'muted';
  padded?: boolean;
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ tone = 'default', padded = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cx(
        'rounded-2xl border border-line',
        tone === 'muted' ? 'bg-surface-muted' : 'bg-surface',
        padded && 'p-4',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

/** Card surface for elements that must keep a semantic tag (`section`, `article`). */
export const cardClass = (extra?: string): string =>
  cx('rounded-2xl border border-line bg-surface', extra);

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'accent' | 'outline' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
  accent: 'bg-accent text-accent-ink hover:bg-accent-strong active:bg-accent-strong',
  outline: 'border border-line bg-surface text-ink hover:bg-surface-muted',
  soft: 'bg-surface-subtle text-ink hover:bg-line-soft',
  ghost: 'text-ink-soft hover:bg-surface-muted hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3 text-xs',
  md: 'h-11 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-sm',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex cursor-pointer select-none items-center justify-center rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';

/* -------------------------------------------------------------------------- */
/* IconButton                                                                  */
/* -------------------------------------------------------------------------- */

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** square hit area in px, 36 by default */
  size?: 32 | 36 | 40 | 44;
  variant?: 'ghost' | 'outline' | 'soft';
};

const ICON_SIZES: Record<NonNullable<IconButtonProps['size']>, string> = {
  32: 'h-8 w-8 rounded-lg',
  36: 'h-9 w-9 rounded-xl',
  40: 'h-10 w-10 rounded-xl',
  44: 'h-11 w-11 rounded-xl',
};

const ICON_VARIANTS: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  outline: 'border border-line bg-surface text-ink-soft hover:bg-surface-muted hover:text-ink',
  soft: 'bg-surface-subtle text-ink-soft hover:bg-line-soft hover:text-ink',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 36, variant = 'ghost', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        'flex shrink-0 cursor-pointer items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50',
        ICON_SIZES[size],
        ICON_VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
);
IconButton.displayName = 'IconButton';

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

export type BadgeTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_TONES: Record<BadgeTone, string> = {
  accent: 'bg-accent-soft text-accent-strong',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-subtle text-ink-muted',
};

export const Badge: React.FC<
  React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }
> = ({ tone = 'neutral', className, ...props }) => (
  <span
    className={cx(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
      BADGE_TONES[tone],
      className
    )}
    {...props}
  />
);

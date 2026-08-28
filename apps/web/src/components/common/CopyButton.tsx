import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Copy-to-clipboard with a confirmation that lives in the button itself.
 *
 * WHY NOT A TOAST. Copying is the most common micro-action in the product
 * (invite links, task keys, deep links) and a toast per copy would stack up
 * three deep while an admin worked through a list. The icon swapping to a tick
 * for a second and a half is the whole feedback, right where the eye already is.
 *
 * THE FALLBACK MATTERS. `navigator.clipboard` is undefined on an insecure
 * origin — which is exactly how someone runs this app on a LAN box at
 * `http://192.168.x.x:5173`. The `execCommand` path is deprecated and ugly and
 * is the only thing that works there, so it stays.
 */

/** Copies text, resolving `false` when every available path failed. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or a non-secure context; fall through.
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    // Off-screen rather than `display:none` — a hidden element cannot be
    // selected, which is the whole mechanism this path relies on.
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/** How long the tick stays before the icon reverts. */
const CONFIRM_MS = 1500;

export function CopyButton({
  value,
  label,
  size = 'icon-sm',
  variant = 'ghost',
  className,
  children,
  onCopied,
}: {
  value: string;
  /** Accessible name — e.g. "Copy invitation link". */
  label: string;
  size?: 'icon-xs' | 'icon-sm' | 'icon' | 'sm' | 'xs';
  variant?: 'ghost' | 'outline' | 'secondary';
  className?: string;
  /** Visible text, for the labelled (non-icon) form. */
  children?: React.ReactNode;
  onCopied?: () => void;
}) {
  const { t } = useTranslation(['common']);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending revert if the button unmounts first — a dialog closing
  // right after a copy is the normal case, not the exotic one.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, CONFIRM_MS);
  };

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      aria-label={children ? undefined : label}
      onClick={() => {
        void handleCopy();
      }}
    >
      {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      {children}
    </Button>
  );

  // A labelled button already says what it does; only the icon-only form needs
  // a tooltip to be discoverable.
  if (children) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{copied ? t('common:actions.copied') : label}</TooltipContent>
    </Tooltip>
  );
}

export default CopyButton;

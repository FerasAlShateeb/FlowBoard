import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useThemeStore, type ThemeImportError } from '@/stores/useThemeStore';

/**
 * The import flow: a file picker AND a paste box, in one dialog.
 *
 * BOTH, BECAUSE THE TWO WAYS A THEME TRAVELS ARE DIFFERENT. An exported `.json`
 * arrives as a file; a theme shared in a chat message arrives as text someone
 * copied. Offering only the picker would force a round trip through the
 * filesystem for the second case, which is how a nice feature becomes one
 * nobody uses.
 *
 * VALIDATION IS THE STORE'S (`importTheme` → `themeDocumentSchema.safeParse`),
 * and it returns a CODE, not a message — this component is the one that knows
 * the reader's language. The error is surfaced INLINE, next to the input that
 * produced it, rather than as a toast that vanishes while you are still
 * looking for the typo.
 */
export function ImportThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['theme', 'common']);
  const importTheme = useThemeStore((state) => state.importTheme);

  const [text, setText] = useState('');
  const [error, setError] = useState<ThemeImportError | 'file' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reopening after a failed attempt must not inherit the old error, or the
  // dialog opens already complaining about JSON nobody has pasted yet.
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);

  const submit = (json: string) => {
    const result = importTheme(json);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    toast.success(t('theme:toasts.imported'));
    onOpenChange(false);
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      submit(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      setError('file');
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('theme:import.title')}</DialogTitle>
          <DialogDescription>{t('theme:import.description')}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label={t('theme:import.fileInput')}
          onChange={(event) => {
            readFile(event.target.files?.[0]);
            // Reset, or choosing the SAME file twice fires no change event —
            // which reads as "the button stopped working" after a failed import.
            event.target.value = '';
          }}
        />

        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => fileRef.current?.click()}
          >
            <Upload aria-hidden />
            {t('theme:import.chooseFile')}
          </Button>

          <div className="grid gap-1.5">
            <Label htmlFor="theme-import-json">{t('theme:import.pasteLabel')}</Label>
            <Textarea
              id="theme-import-json"
              dir="ltr"
              rows={6}
              spellCheck={false}
              aria-invalid={error !== null}
              placeholder={t('theme:import.pastePlaceholder')}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
              className="font-mono text-xs"
            />
          </div>

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {t(`theme:import.errors.${error}`)}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={text.trim().length === 0}
            onClick={() => {
              submit(text);
            }}
          >
            {t('theme:import.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportThemeDialog;

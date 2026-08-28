import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The class-name helper every `components/ui/*` primitive is built on.
 *
 * `clsx` flattens conditionals/arrays/objects into a class string; `twMerge`
 * then resolves Tailwind CONFLICTS by letting the later class win within a
 * group (`px-2 px-4` → `px-4`). That second half is what makes the primitives
 * overridable: a call site can pass `className="px-6"` and actually get it,
 * instead of two competing paddings whose winner depends on stylesheet order.
 *
 * Caveat worth knowing: tailwind-merge dedupes WITHIN a group, and logical
 * (`ms-*`, `end-*`) and physical (`ml-*`, `right-*`) utilities are DIFFERENT
 * groups. Mixing them stacks both instead of replacing one — which is one more
 * reason this codebase uses logical utilities exclusively.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

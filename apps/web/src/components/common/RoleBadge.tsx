import { useTranslation } from 'react-i18next';
import type { OrgRole, ProjectRole } from '@flowboard/shared';

import { Badge } from '@/components/ui/badge';

/**
 * A role, as a chip — org (`admin` / `member`) and project (`admin` / `member` /
 * `viewer`) share one component because they share one vocabulary and one
 * visual weight.
 *
 * THE COLOUR CARRIES MEANING, and only one distinction is worth encoding:
 * admin (can change things) against everyone else. A three-colour scheme would
 * make a members table look like a status board, which is precisely the noise
 * a dense Linear-style table is trying to avoid.
 */

type AnyRole = OrgRole | ProjectRole;

const VARIANT: Record<AnyRole, 'soft-primary' | 'secondary' | 'outline'> = {
  admin: 'soft-primary',
  member: 'secondary',
  viewer: 'outline',
};

export function RoleBadge({ role, className }: { role: AnyRole; className?: string }) {
  const { t } = useTranslation(['orgs']);

  // The role names live in `orgs:roles.*` rather than in each page's namespace:
  // they are the same three words on the org members table, the project members
  // table, the invite dialog and every toast that reports a change.
  const label =
    role === 'admin'
      ? t('orgs:roles.admin')
      : role === 'member'
        ? t('orgs:roles.member')
        : t('orgs:roles.viewer');

  return (
    <Badge variant={VARIANT[role]} className={className}>
      {label}
    </Badge>
  );
}

export default RoleBadge;

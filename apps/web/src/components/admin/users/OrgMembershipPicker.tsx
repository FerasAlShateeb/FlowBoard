import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import type { OrgRole, ProvisionMembership } from '@flowboard/shared';

import { useAdminOrgs } from '@/hooks/useAdminOrgs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The org-grants editor inside the provision dialog: pick an organization, pick
 * a role, add the row; repeat.
 *
 * ═══ WHY PROVISIONING CARRIES MEMBERSHIPS AT ALL ═════════════════════════
 *
 * `POST /admin/users` takes `orgMemberships[]` and applies them IN THE SAME
 * TRANSACTION as the account. The alternative — create, then add member, then
 * add member — has two chances to half-succeed and leave an account that exists
 * but belongs nowhere, which is invisible until the new user signs in to an
 * empty org switcher. The page used to hardcode `[]` here, which meant the one
 * atomic path the API offers was unreachable from the product.
 *
 * ═══ THE STATE IS THE CALLER'S ═══════════════════════════════════════════
 *
 * This component owns a draft row (which org, which role) and nothing else: the
 * committed list lives in the dialog, which is what submits it. A picker that
 * held the list would have to be reset by the dialog anyway, through a ref or a
 * key — and the dialog would still need the value.
 *
 * ═══ NO SERVER WRITE HAPPENS HERE ════════════════════════════════════════
 *
 * Nothing in this file mutates. It is a value editor for a request that has not
 * been sent yet, which is the whole difference between it and
 * `MembershipsDialog` (the live editor for an account that already exists).
 */
export function OrgMembershipPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ProvisionMembership[];
  onChange: (next: ProvisionMembership[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const orgsQuery = useAdminOrgs({});
  const orgs = orgsQuery.data ?? [];

  const [draftOrgId, setDraftOrgId] = useState('');
  const [draftRole, setDraftRole] = useState<OrgRole>('member');

  const taken = new Set(value.map((entry) => entry.orgId));
  const available = orgs.filter((org) => !taken.has(org.id));
  const nameOf = (orgId: string) => orgs.find((org) => org.id === orgId)?.name ?? orgId;

  const add = () => {
    if (draftOrgId === '' || taken.has(draftOrgId)) return;
    onChange([...value, { orgId: draftOrgId, role: draftRole }]);
    setDraftOrgId('');
    setDraftRole('member');
  };

  if (!orgsQuery.isPending && orgs.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('admin:users.provision.noOrgs')}</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="org-membership-picker">
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('admin:users.provision.orgsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {value.map((entry) => (
            <li
              key={entry.orgId}
              className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-muted/30 px-2 py-1.5"
              data-testid={`membership-draft-${entry.orgId}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm">{nameOf(entry.orgId)}</span>
              <Badge variant={entry.role === 'admin' ? 'soft-primary' : 'outline'}>
                {t(`admin:users.orgRole.${entry.role}`)}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={t('admin:users.memberships.remove', { org: nameOf(entry.orgId) })}
                onClick={() => {
                  onChange(value.filter((row) => row.orgId !== entry.orgId));
                }}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 && value.length > 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={draftOrgId} onValueChange={setDraftOrgId} disabled={disabled}>
            <SelectTrigger
              size="sm"
              className="min-w-40 flex-1"
              aria-label={t('admin:users.memberships.org')}
              data-testid="membership-org-select"
            >
              <SelectValue placeholder={t('admin:users.memberships.orgPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {available.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={draftRole}
            onValueChange={(next) => {
              setDraftRole(next === 'admin' ? 'admin' : 'member');
            }}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="w-40"
              aria-label={t('admin:users.memberships.role')}
              data-testid="membership-role-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t('admin:users.orgRole.member')}</SelectItem>
              <SelectItem value="admin">{t('admin:users.orgRole.admin')}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || draftOrgId === ''}
            onClick={add}
            data-testid="membership-add"
          >
            <Plus aria-hidden />
            {t('admin:users.provision.addOrg')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default OrgMembershipPicker;

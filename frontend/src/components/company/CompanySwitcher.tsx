'use client';

import { useState } from 'react';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { CreateCompanyDialog } from '@/components/company/CreateCompanyDialog';

/**
 * 所属会社を切り替えるドロップダウン。会社が無ければ何も表示しない
 * （所属0の導線はダッシュボードのオンボーディングが担当）。
 * 末尾の「新しい会社を作成」から、既存ユーザーも追加の会社を作れる。
 */
export function CompanySwitcher() {
  const { organizations, selectedOrganization, selectOrganization, fetchOrganizations } =
    useProject();
  const [createOpen, setCreateOpen] = useState(false);

  if (!organizations || organizations.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="会社を切り替え" className="w-full flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-left text-sm hover:bg-secondary transition-colors">
            <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate flex-1 text-foreground">
              {selectedOrganization?.name ?? '会社を選択'}
            </span>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>会社を切り替え</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => selectOrganization(org)}
              className="flex items-center gap-2"
            >
              <Check
                className={
                  'h-4 w-4 ' + (selectedOrganization?.id === org.id ? 'opacity-100' : 'opacity-0')
                }
              />
              <span className="truncate">{org.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setCreateOpen(true)}
            className="flex items-center gap-2 text-blue-600 focus:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span className="truncate">新しい会社を作成</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (org) => {
          await fetchOrganizations();
          // 作成した会社をそのまま選択して切り替える
          selectOrganization({
            id: org.id,
            name: org.name,
            slug: org.slug,
            description: org.description ?? undefined,
          });
        }}
      />
    </div>
  );
}

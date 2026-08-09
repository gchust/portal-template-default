import type { Role } from "@nocobase/portal-sdk/acl";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveRoleLabel } from "./role-utils";

export function RoleBadges({
  roles,
  onSelect,
  empty,
}: {
  roles: Role[];
  onSelect: (role: Role) => void;
  empty: string;
}) {
  if (!roles.length) {
    return <span className="text-sm text-muted-foreground">{empty}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => {
        const label = resolveRoleLabel(role);
        return (
          <button
            key={role.name}
            type="button"
            className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => onSelect(role)}
            title={label}
          >
            <Badge
              variant="secondary"
              className={cn(
                "cursor-pointer transition-colors",
                role.name === "root"
                  ? "bg-green-500/15 text-green-700 hover:bg-green-500/25 dark:bg-green-500/20 dark:text-green-400"
                  : "hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]"
              )}
            >
              {label}
              <ChevronRight data-icon="inline-end" />
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

import type { Role } from "./domain/types";

export type Permission =
  | "crm.edit"
  | "order.validate"
  | "order.cancel"
  | "route.approve"
  | "pick.confirm"
  | "delivery.complete"
  | "payment.record"
  | "payment.allocate"
  | "payment.reverse"
  | "payment.custody"
  | "ar.adjust"
  | "statement.lock"
  | "statement.review"
  | "statement.release"
  | "statement.send"
  | "invoice.submit"
  | "inventory.adjust"
  | "inventory.threshold"
  | "product.manage"
  | "supplier.manage"
  | "supplier.approve"
  | "po.draft"
  | "po.approve"
  | "memory.approve"
  | "settings.manage"
  | "view.margin";

const MATRIX: Record<Permission, Role[]> = {
  "crm.edit": ["sales", "owner"],
  "order.validate": ["sales", "owner"],
  "order.cancel": ["sales", "owner"],
  "route.approve": ["owner"],
  "pick.confirm": ["warehouse", "driver", "owner"],
  "delivery.complete": ["driver", "owner"],
  "payment.record": ["driver", "accounting", "owner"],
  "payment.allocate": ["accounting"],
  "payment.reverse": ["accounting"],
  "payment.custody": ["accounting"],
  "ar.adjust": ["accounting"],
  "statement.lock": ["accounting"],
  "statement.review": ["accounting"],
  "statement.release": ["owner"],
  "statement.send": ["owner", "accounting"],
  "invoice.submit": ["accounting"],
  "inventory.adjust": ["warehouse", "owner"],
  "inventory.threshold": ["procurement", "owner"],
  "product.manage": ["procurement", "owner"],
  "supplier.manage": ["procurement", "owner"],
  "supplier.approve": ["owner"],
  "po.draft": ["procurement", "owner"],
  "po.approve": ["owner"],
  "memory.approve": ["owner", "accounting"],
  "settings.manage": ["owner", "admin"],
  "view.margin": ["owner", "accounting"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}

export function rolesFor(permission: Permission): Role[] {
  return MATRIX[permission];
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "主任",
  sales: "業務",
  driver: "司機",
  warehouse: "倉管",
  procurement: "採購",
  accounting: "會計",
  admin: "管理員",
};

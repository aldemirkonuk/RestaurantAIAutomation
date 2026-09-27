import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

/**
 * Who each `@Roles` route lets through, measured by running the REAL
 * `RolesGuard` over the REAL controller metadata (ADR 0164, "Keep managers
 * in"). Test-only: imported by `route-access.spec.ts`, never by the app.
 *
 * The roles tried are every value a session's `role` can hold: the three the
 * database's CHECKs allow, `admin` (which the guard used to widen to and no
 * row holds), and null (a session with no role in its house).
 */
export const ROLES_TRIED = [
  "owner",
  "manager",
  "staff",
  "admin",
  null,
] as const;

const SRC = path.resolve(__dirname, "../..");

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every non-spec controller file whose code (not its comments) says `@Roles(`. */
export function controllersWithRoles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (
        entry.name.endsWith(".controller.ts") &&
        stripComments(fs.readFileSync(full, "utf8")).includes("@Roles(")
      ) {
        out.push(path.relative(SRC, full));
      }
    }
  };
  walk(SRC);
  return out.sort();
}

function joinPath(...parts: unknown[]): string {
  const segs = parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p) => typeof p === "string")
    .map((p) => (p as string).replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return "/" + segs.join("/");
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

/**
 * `{ "<METHOD> <path> (<Class>.<method>)": [roles admitted] }` for every route
 * in every controller file that uses `@Roles`. A route whose guards do not
 * include `RolesGuard` is recorded as `"open"`: its `@Roles`, if any, is inert.
 */
export function measureRouteAccess(): Record<string, string[] | "open"> {
  const guard = new RolesGuard(new Reflector());
  const table: Record<string, string[] | "open"> = {};

  for (const rel of controllersWithRoles()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(SRC, rel));
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const cls = exported as { name: string; prototype: any };
      const classPath = Reflect.getMetadata(PATH_METADATA, cls);
      if (classPath === undefined) continue;

      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === "constructor") continue;
        const handler = cls.prototype[name];
        if (typeof handler !== "function") continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;

        const key = `${RequestMethod[method]} ${joinPath(
          classPath,
          Reflect.getMetadata(PATH_METADATA, handler),
        )} (${cls.name}.${name})`;

        const guarded = [...guardsOf(cls), ...guardsOf(handler)].some(
          (g) => g === RolesGuard,
        );
        if (!guarded) {
          table[key] = "open";
          continue;
        }

        table[key] = ROLES_TRIED.filter((role) =>
          guard.canActivate({
            getHandler: () => handler,
            getClass: () => cls,
            switchToHttp: () => ({
              getRequest: () => ({ user: { userId: "u", role } }),
            }),
          } as any),
        ).map((role) => String(role));
      }
    }
  }
  return table;
}

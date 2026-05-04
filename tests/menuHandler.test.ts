import { getMenu, saveMenu } from "../handlers/menuHandler.js";
import type { Env } from "../types/core.js";

describe("menuHandler", () => {
  describe("getMenu", () => {
    it("returns empty items when UID_CONFIG is missing", async () => {
      const result = await getMenu({} as Env, "default");
      expect(result).toEqual({ items: [] });
    });

    it("returns empty items when no menu saved", async () => {
      const env = { UID_CONFIG: { get: async () => null } } as unknown as Env;
      const result = await getMenu(env, "default");
      expect(result).toEqual({ items: [] });
    });

    it("returns saved menu", async () => {
      const menu = { items: [{ name: "Coffee", price: 50 }] };
      const env = { UID_CONFIG: { get: async () => JSON.stringify(menu) } } as unknown as Env;
      const result = await getMenu(env, "default");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Coffee");
    });

    it("returns empty items on KV error", async () => {
      const env = { UID_CONFIG: { get: async () => { throw new Error("KV down"); } } } as unknown as Env;
      const result = await getMenu(env, "default");
      expect(result).toEqual({ items: [] });
    });
  });

  describe("saveMenu", () => {
    it("returns 500 when UID_CONFIG is missing", async () => {
      const res = await saveMenu({} as Env, "default", { items: [] });
      expect(res.status).toBe(500);
    });

    it("returns 400 when items is not an array", async () => {
      const env = { UID_CONFIG: { put: async () => {} } } as unknown as Env;
      const res = await saveMenu(env, "default", { items: "not-array" });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("array");
    });

    it("returns 400 when item missing name", async () => {
      const env = { UID_CONFIG: { put: async () => {} } } as unknown as Env;
      const res = await saveMenu(env, "default", { items: [{ price: 50 }] });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("name");
    });

    it("returns 400 for negative price", async () => {
      const env = { UID_CONFIG: { put: async () => {} } } as unknown as Env;
      const res = await saveMenu(env, "default", { items: [{ name: "X", price: -1 }] });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("price");
    });

    it("saves valid menu and returns success", async () => {
      const stored: Record<string, string> = {};
      const env = { UID_CONFIG: { put: async (k: string, v: string) => { stored[k] = v; } } } as unknown as Env;
      const res = await saveMenu(env, "default", { items: [{ name: "Coffee", price: 50 }] });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.itemCount).toBe(1);
      expect(stored["pos_menu:default"]).toBeDefined();
    });

    it("returns 500 on KV put error", async () => {
      const env = { UID_CONFIG: { put: async () => { throw new Error("KV exploded"); } } } as unknown as Env;
      const res = await saveMenu(env, "default", { items: [{ name: "X", price: 1 }] });
      expect(res.status).toBe(500);
    });
  });
});

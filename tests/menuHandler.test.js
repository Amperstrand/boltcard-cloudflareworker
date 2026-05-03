import { getMenu, saveMenu } from "../handlers/menuHandler.js";

describe("menuHandler", () => {
  describe("getMenu", () => {
    it("returns empty items when UID_CONFIG is missing", async () => {
      const result = await getMenu({}, "default");
      expect(result).toEqual({ items: [] });
    });

    it("returns empty items when no menu saved", async () => {
      const env = { UID_CONFIG: { get: async () => null } };
      const result = await getMenu(env, "default");
      expect(result).toEqual({ items: [] });
    });

    it("returns saved menu", async () => {
      const menu = { items: [{ name: "Coffee", price: 50 }] };
      const env = { UID_CONFIG: { get: async () => JSON.stringify(menu) } };
      const result = await getMenu(env, "default");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Coffee");
    });

    it("returns empty items on KV error", async () => {
      const env = { UID_CONFIG: { get: async () => { throw new Error("KV down"); } } };
      const result = await getMenu(env, "default");
      expect(result).toEqual({ items: [] });
    });
  });

  describe("saveMenu", () => {
    it("returns 500 when UID_CONFIG is missing", async () => {
      const res = await saveMenu({}, "default", { items: [] });
      expect(res.status).toBe(500);
    });

    it("returns 400 when items is not an array", async () => {
      const env = { UID_CONFIG: { put: async () => {} } };
      const res = await saveMenu(env, "default", { items: "not-array" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("array");
    });

    it("returns 400 when item missing name", async () => {
      const env = { UID_CONFIG: { put: async () => {} } };
      const res = await saveMenu(env, "default", { items: [{ price: 50 }] });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("name");
    });

    it("returns 400 for negative price", async () => {
      const env = { UID_CONFIG: { put: async () => {} } };
      const res = await saveMenu(env, "default", { items: [{ name: "X", price: -1 }] });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("price");
    });

    it("saves valid menu and returns success", async () => {
      const stored = {};
      const env = { UID_CONFIG: { put: async (k, v) => { stored[k] = v; } } };
      const res = await saveMenu(env, "default", { items: [{ name: "Coffee", price: 50 }] });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.itemCount).toBe(1);
      expect(stored["pos_menu:default"]).toBeDefined();
    });

    it("returns 500 on KV put error", async () => {
      const env = { UID_CONFIG: { put: async () => { throw new Error("KV exploded"); } } };
      const res = await saveMenu(env, "default", { items: [{ name: "X", price: 1 }] });
      expect(res.status).toBe(500);
    });
  });
});

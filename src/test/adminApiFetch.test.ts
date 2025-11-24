import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del módulo firebase ANTES de importar adminApiFetch
vi.mock("../firebase", () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue("TEST_TOKEN"),
    },
  },
}));

// Ahora importamos la función a testear
import { adminApiFetch } from "../utils/adminApi";

// Tests

describe("adminApiFetch()", () => {
  beforeEach(() => {
    (import.meta as any).env = {
      ...(import.meta as any).env,
      VITE_ADMIN_API_URL: "https://api.example.com",
    };

    vi.restoreAllMocks();
  });

  it("existe y es una función", () => {
    expect(typeof adminApiFetch).toBe("function");
  });

  it("hace una llamada exitosa (200)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: 123 }),
    });

    global.fetch = mockFetch as any;

    const result = await adminApiFetch("/api/test");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: 123 });
  });

  it("lanza error cuando status = 401", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    global.fetch = mockFetch as any;

    await expect(adminApiFetch("/api/test")).rejects.toThrow(/Unauthorized/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

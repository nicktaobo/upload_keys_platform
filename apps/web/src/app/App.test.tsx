import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

type Route = { method?: string; path: string; body: unknown; status?: number };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const installApi = (routes: Route[]) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://keyhub.test");
    const method = init?.method ?? "GET";
    const route = routes.find(
      (candidate) => candidate.path === url.pathname && (candidate.method ?? "GET") === method,
    );
    return route ? jsonResponse(route.body, route.status) : jsonResponse({ message: `Unhandled ${method} ${url.pathname}` }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const user = { id: "u1", username: "riley", role: "user" };
const admin = { id: "a1", username: "operator", role: "admin" };
const apiUser = { ...user, role: "USER" };
const apiAdmin = { ...admin, role: "ADMIN" };
const key = {
  id: "k1",
  maskedKey: "sk-ant-••••••••7T9q",
  warrantyHours: 720,
  status: "SUBMITTED",
  testResult: "passed",
  accessStatus: "active",
  usageUsd: "41.25",
  usageSiteCount: 4,
  sampledAt: "2026-07-19T10:30:00.000Z",
  submittedAt: "2026-07-18T10:30:00.000Z",
};

describe("KeyHub application", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a login error and navigates to My Keys after valid login", async () => {
    const fetchMock = installApi([
      { path: "/api/auth/me", body: { message: "Unauthorized" }, status: 401 },
      { method: "POST", path: "/api/auth/login", body: { message: "Invalid username or password" }, status: 401 },
    ]);
    render(<App />);
    const actor = userEvent.setup();

    await actor.type(await screen.findByLabelText("Username"), "riley");
    await actor.type(screen.getByLabelText("Password"), "wrong");
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid username or password")).toBeVisible();

    fetchMock.mockImplementation(async (input, _init) => {
      const path = new URL(String(input), "http://keyhub.test").pathname;
      if (path === "/api/auth/login") return jsonResponse({ user: apiUser, csrfToken: "csrf-user" });
      if (path === "/api/keys/summary") return jsonResponse({ submittedCount: 0, healthyCount: 0, usageUsd: 0, latestSampleAt: null });
      if (path === "/api/keys") return jsonResponse({ items: [], total: 0 });
      return jsonResponse({ message: "Unhandled" }, 500);
    });
    await actor.clear(screen.getByLabelText("Password"));
    await actor.type(screen.getByLabelText("Password"), "correct horse");
    await actor.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "My Keys" })).toBeVisible();
    expect(screen.queryByText("Change password")).not.toBeInTheDocument();
  });

  it("renders summary and rows, filters status, refreshes, and reveals a Key", async () => {
    const fetchMock = installApi([
      { path: "/api/auth/me", body: { user: apiUser, csrfToken: "csrf-user" } },
      { path: "/api/keys/summary", body: { submittedCount: 12, healthyCount: 9, usageUsd: 184.5, latestSampleAt: key.sampledAt } },
      { path: "/api/keys", body: { items: [{ ...key, status: "UPSTREAM_ERROR", failureMessage: "This organization has been disabled." }], total: 1 } },
      { method: "POST", path: "/api/keys/k1/retry", body: { message: "Retry queued" } },
      { method: "POST", path: "/api/keys/refresh", body: { message: "Refresh queued" } },
      { method: "POST", path: "/api/keys/k1/reveal", body: { apiKey: "sk-ant-api03-full-secret" } },
    ]);
    const actor = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App />);

    expect(await screen.findByText("$184.50")).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByText("This organization has been disabled.")).toBeVisible();
    await actor.click(screen.getByRole("combobox", { name: "Filter by status" }));
    await actor.click(await screen.findByText("Submitted", { selector: ".ant-select-item-option-content" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("status=SUBMITTED"), expect.anything()));

    await actor.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(await screen.findByText("Refresh queued")).toBeVisible();

    await actor.click(screen.getByRole("button", { name: key.maskedKey }));
    expect(await screen.findByRole("dialog", { name: "Full Key" })).toHaveTextContent("sk-ant-api03-full-secret");
    expect(writeText).toHaveBeenCalledWith("sk-ant-api03-full-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/keys/k1/reveal",
      expect.objectContaining({
        body: undefined,
        headers: expect.not.objectContaining({ "Content-Type": "application/json" }),
      }),
    );

    await actor.click(screen.getByRole("button", { name: "Retry k1" }));
    await actor.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Retry queued")).toBeVisible();
  });

  it("requests the selected page of the current user's Keys", async () => {
    const fetchMock = installApi([
      { path: "/api/auth/me", body: { user: apiUser, csrfToken: "csrf-user" } },
      { path: "/api/keys/summary", body: { submittedCount: 21, healthyCount: 0, usageUsd: 0, latestSampleAt: null } },
      { path: "/api/keys", body: { items: [key], total: 21, page: 1, pageSize: 20 } },
    ]);
    render(<App />);
    const actor = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "My Keys" })).toBeVisible();
    await actor.click(await screen.findByTitle("2"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/keys?page=2&pageSize=20")).toBe(true),
    );
  });

  it("still reveals a Key when clipboard access is blocked", async () => {
    installApi([
      { path: "/api/auth/me", body: { user: apiUser, csrfToken: "csrf-user" } },
      { path: "/api/keys/summary", body: { submittedCount: 1, healthyCount: 0, usageUsd: 0, latestSampleAt: null } },
      { path: "/api/keys", body: { items: [key], total: 1 } },
      { method: "POST", path: "/api/keys/k1/reveal", body: { apiKey: "sk-ant-api03-full-secret" } },
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: key.maskedKey }));

    expect(await screen.findByRole("dialog", { name: "Full Key" })).toHaveTextContent("sk-ant-api03-full-secret");
    expect(await screen.findByText("Key displayed, but clipboard access was blocked")).toBeVisible();
    expect(screen.queryByText("permission denied")).not.toBeInTheDocument();
  });

  it("supports single and batch submission with per-row errors and a fixed channel", async () => {
    const fetchMock = installApi([
      { path: "/api/auth/me", body: { user: apiUser, csrfToken: "csrf-user" } },
      { path: "/api/keys/summary", body: { submittedCount: 0, healthyCount: 0, usageUsd: 0, latestSampleAt: null } },
      { path: "/api/keys", body: { items: [], total: 0 } },
      { method: "POST", path: "/api/keys", body: { created: [{ id: "created-1" }] } },
    ]);
    window.history.replaceState({}, "", "/submit");
    render(<App />);
    const actor = userEvent.setup();

    expect(await screen.findByText("Claude official API")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: /channel/i })).not.toBeInTheDocument();
    await actor.type(screen.getByLabelText("API Key"), "sk-ant-valid-key");
    await actor.click(screen.getByRole("button", { name: "Submit Key" }));
    expect(await screen.findByText("1 Key accepted")).toBeVisible();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledWith("/api/keys", expect.objectContaining({ headers: expect.objectContaining({ "X-CSRF-Token": "csrf-user" }) }));

    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input), "http://keyhub.test").pathname;
      if (path === "/api/keys" && init?.method === "POST") {
        return jsonResponse(
          { message: "提交内容有误", issues: [{ row: 2, message: "Duplicate Key" }] },
          400,
        );
      }
      return jsonResponse({ message: "Unhandled" }, 500);
    });

    await actor.click(screen.getByRole("tab", { name: "Batch paste" }));
    await actor.type(screen.getByLabelText("Keys and warranty hours"), "sk-ant-one, 720\nsk-ant-two, 720");
    await actor.click(screen.getByRole("button", { name: "Submit batch" }));
    expect(await screen.findByText("Row 2: Duplicate Key")).toBeVisible();
  });

  it("shows admin-only navigation and completes user operations", async () => {
    installApi([
      { path: "/api/auth/me", body: { user: apiAdmin, csrfToken: "csrf-admin" } },
      { path: "/api/admin/users", body: [{ id: "u1", username: "riley", role: "USER", isActive: true }] },
      { method: "POST", path: "/api/admin/users", body: { id: "u2", username: "sam", role: "USER", isActive: true } },
      { method: "POST", path: "/api/admin/users/u1/status", body: { success: true } },
      { method: "POST", path: "/api/admin/users/u1/reset-password", body: { success: true } },
    ]);
    window.history.replaceState({}, "", "/admin/users");
    render(<App />);
    const actor = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Users" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Users" })).toBeVisible();
    expect(screen.getByRole("link", { name: "All Keys" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Operations" })).toBeVisible();
    await actor.click(screen.getByRole("button", { name: "Create user" }));
    const dialog = await screen.findByRole("dialog", { name: "Create user" });
    await actor.type(within(dialog).getByLabelText("Username"), "sam");
    await actor.type(within(dialog).getByLabelText("Temporary password"), "TempPassword1!");
    await actor.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("User created")).toBeVisible();

    await actor.click(screen.getByRole("button", { name: "Disable riley" }));
    await actor.click(await screen.findByRole("button", { name: "Disable" }));
    expect(await screen.findByText("User disabled")).toBeVisible();
    await actor.click(screen.getByRole("button", { name: "Reset password for riley" }));
    const resetDialog = await screen.findByRole("dialog", { name: "Reset password" });
    await actor.type(within(resetDialog).getByLabelText("New temporary password"), "AnotherTemp1!");
    await actor.click(within(resetDialog).getByRole("button", { name: "Reset" }));
    expect(await screen.findByText("Password reset")).toBeVisible();
  });

  it("keeps admin Keys masked and provides retry, sync, and upstream credential flows", async () => {
    installApi([
      { path: "/api/auth/me", body: { user: apiAdmin, csrfToken: "csrf-admin" } },
      { path: "/api/admin/keys", body: { items: [{ ...key, owner: { id: "u1", username: "riley" }, status: "UPSTREAM_ERROR", failureMessage: "Upstream timed out" }], total: 1 } },
      { method: "POST", path: "/api/admin/keys/k1/retry", body: { message: "Retry queued" } },
      { path: "/api/admin/upstream", body: { state: "blocked", failureMessage: "CAPTCHA required", lastLoginAt: null, lastSyncAt: key.sampledAt, username: "supplier@example.com" } },
      { method: "PUT", path: "/api/admin/upstream", body: { success: true } },
      { method: "POST", path: "/api/admin/upstream/sync", body: { message: "Sync queued" } },
    ]);
    window.history.replaceState({}, "", "/admin/keys");
    render(<App />);
    const actor = userEvent.setup();

    expect(await screen.findByText("Upstream timed out")).toBeVisible();
    expect(screen.queryByRole("button", { name: key.maskedKey })).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Retry k1" }));
    await actor.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Retry queued")).toBeVisible();

    await actor.click(screen.getByRole("link", { name: "Upstream" }));
    expect(await screen.findByText("CAPTCHA required")).toBeVisible();
    await actor.clear(screen.getByLabelText("Upstream username"));
    await actor.type(screen.getByLabelText("Upstream username"), "new@example.com");
    await actor.type(screen.getByLabelText("Upstream password"), "supplier-secret");
    await actor.click(screen.getByRole("button", { name: "Save credentials" }));
    expect(await screen.findByText("Credentials saved")).toBeVisible();
    await actor.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("Sync queued")).toBeVisible();
  });

  it("requests the selected page of administrator Keys", async () => {
    const fetchMock = installApi([
      { path: "/api/auth/me", body: { user: apiAdmin, csrfToken: "csrf-admin" } },
      { path: "/api/admin/keys", body: { items: [{ ...key, owner: { id: "u1", username: "riley" } }], total: 21, page: 1, pageSize: 20 } },
    ]);
    window.history.replaceState({}, "", "/admin/keys");
    render(<App />);
    const actor = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "All Keys" })).toBeVisible();
    await actor.click(await screen.findByTitle("2"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/admin/keys?page=2&pageSize=20")).toBe(true),
    );
  });
});

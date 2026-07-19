export class CaptchaRequiredError extends Error {
  constructor() {
    super("Upstream login requires CAPTCHA");
    this.name = "CaptchaRequiredError";
  }
}

export class UpstreamContractError extends Error {
  constructor(contract: string) {
    super(`Upstream response did not match the ${contract} contract`);
    this.name = "UpstreamContractError";
  }
}

export class UpstreamHttpError extends Error {
  public readonly status: number | undefined;
  public readonly code: "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR";

  constructor(options: {
    status?: number;
    code?: "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR";
  }) {
    const code = options.code ?? "HTTP_ERROR";
    const message =
      code === "TIMEOUT"
        ? "Upstream request timed out"
        : code === "NETWORK_ERROR"
          ? "Upstream request failed"
          : `Upstream request failed with status ${options.status ?? "unknown"}`;
    super(message);
    this.name = "UpstreamHttpError";
    this.status = options.status;
    this.code = code;
  }
}

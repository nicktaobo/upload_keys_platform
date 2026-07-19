import { hash } from "argon2";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { prisma } from "@keyhub/database";
import { encryptSecret, fingerprintKey, maskKey } from "@keyhub/domain";

const suffix = Date.now().toString(36);
const aliceName = `e2e-alice-${suffix}`;
const bobName = `e2e-bob-${suffix}`;
const password = "e2e-password-123";
const fullKey = `sk-ant-api03-e2e-owner-${suffix}-X7AA`;
let recordId = "";

test.beforeAll(async () => {
  const passwordHash = await hash(password, { type: 2 });
  const [alice] = await prisma.$transaction([
    prisma.user.create({ data: { username: aliceName, passwordHash } }),
    prisma.user.create({ data: { username: bobName, passwordHash } }),
  ]);
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY_BASE64!, "base64");
  const hmacKey = Buffer.from(process.env.HMAC_KEY_BASE64!, "base64");
  const encrypted = encryptSecret(fullKey, encryptionKey);
  const record = await prisma.keyRecord.create({
    data: {
      ownerId: alice.id,
      encryptedKey: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionTag: encrypted.authTag,
      keyFingerprint: fingerprintKey(fullKey, hmacKey),
      maskedKey: maskKey(fullKey),
      keySuffix: fullKey.slice(-4),
      warrantyHours: 24,
      status: "SUBMITTED",
    },
  });
  recordId = record.id;
});

test.afterAll(async () => {
  await prisma.keyRecord.deleteMany({ where: { id: recordId } });
  await prisma.user.deleteMany({ where: { username: { in: [aliceName, bobName] } } });
  await prisma.$disconnect();
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My Keys" })).toBeVisible();
}

test("ordinary users cannot list or reveal another user's Key", async ({ page }) => {
  await signIn(page, bobName);
  await expect(page.getByText(maskKey(fullKey))).toHaveCount(0);

  const status = await page.evaluate(async (id) => {
    const me = await fetch("/api/auth/me");
    const session = (await me.json()) as { csrfToken: string };
    const response = await fetch(`/api/keys/${id}/reveal`, {
      method: "POST",
      headers: { "X-CSRF-Token": session.csrfToken },
    });
    return response.status;
  }, recordId);
  expect(status).toBe(404);
});

test("the owner can click the masked Key and see the full value", async ({ page }) => {
  await signIn(page, aliceName);
  await page.getByRole("button", { name: maskKey(fullKey) }).click();

  await expect(page.getByRole("dialog", { name: "Full Key" })).toContainText(fullKey);
});

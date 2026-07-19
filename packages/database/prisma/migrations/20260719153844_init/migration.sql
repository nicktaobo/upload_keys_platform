-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('PENDING', 'SUBMITTING', 'SUBMITTED', 'TEST_FAILED', 'RETRYING', 'UPSTREAM_ERROR');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('UNCONFIGURED', 'CONNECTING', 'CONNECTED', 'DEGRADED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "encryptionTag" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "maskedKey" TEXT NOT NULL,
    "keySuffix" TEXT NOT NULL,
    "warrantyHours" INTEGER NOT NULL,
    "upstreamChannelId" TEXT,
    "upstreamItemId" TEXT,
    "status" "KeyStatus" NOT NULL DEFAULT 'PENDING',
    "testResult" TEXT,
    "accessStatus" TEXT,
    "usageUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "usageSiteCount" INTEGER NOT NULL DEFAULT 0,
    "sampledAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamConnection" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "encryptedUsername" TEXT,
    "usernameIv" TEXT,
    "usernameTag" TEXT,
    "encryptedPassword" TEXT,
    "passwordIv" TEXT,
    "passwordTag" TEXT,
    "encryptedSessionState" TEXT,
    "sessionIv" TEXT,
    "sessionTag" TEXT,
    "upstreamChannelId" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastLoginAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "keyRecordId" TEXT,
    "queueJobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "KeyRecord_keyFingerprint_key" ON "KeyRecord"("keyFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "KeyRecord_upstreamItemId_key" ON "KeyRecord"("upstreamItemId");

-- CreateIndex
CREATE INDEX "KeyRecord_ownerId_createdAt_idx" ON "KeyRecord"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "KeyRecord_status_updatedAt_idx" ON "KeyRecord"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "JobRun_keyRecordId_createdAt_idx" ON "JobRun"("keyRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_jobType_createdAt_idx" ON "JobRun"("jobType", "createdAt");

-- AddForeignKey
ALTER TABLE "KeyRecord" ADD CONSTRAINT "KeyRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_keyRecordId_fkey" FOREIGN KEY ("keyRecordId") REFERENCES "KeyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

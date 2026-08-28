import { describe, it, expect } from "vitest";

/**
 * Task 12: Full regression pass and export wiring
 *
 * Verify that:
 * 1. All query methods are properly exported
 * 2. All helper classes/functions are exported
 * 3. Method signatures are correct
 * 4. All previously implemented methods still work
 */

describe("Task 12: Export wiring and regression", () => {
  describe("All query methods exported from rpc.js", () => {
    it("exports PageParams class", async () => {
      const { PageParams } = await import("../rpc.js");
      expect(PageParams).toBeDefined();

      const params = new PageParams({ page: 1, per_page: 20 });
      expect(params.page).toBe(1);
      expect(params.toDict()).toBeDefined();
    });

    it("exports postQuery function", async () => {
      const { postQuery } = await import("../rpc.js");
      expect(typeof postQuery).toBe("function");
    });

    it("exports PageSchema factory", async () => {
      const { PageSchema } = await import("../rpc.js");
      expect(typeof PageSchema).toBe("function");
    });

    it("exports account query", async () => {
      const { account } = await import("../rpc.js");
      expect(typeof account).toBe("function");
    });

    it("exports getBalance convenience helper", async () => {
      const { getBalance } = await import("../rpc.js");
      expect(typeof getBalance).toBe("function");
    });

    it("exports blockByHeight query", async () => {
      const { blockByHeight } = await import("../rpc.js");
      expect(typeof blockByHeight).toBe("function");
    });

    it("exports blockByHash query", async () => {
      const { blockByHash } = await import("../rpc.js");
      expect(typeof blockByHash).toBe("function");
    });

    it("exports txByHash query", async () => {
      const { txByHash } = await import("../rpc.js");
      expect(typeof txByHash).toBe("function");
    });

    it("exports failedTxs query", async () => {
      const { failedTxs } = await import("../rpc.js");
      expect(typeof failedTxs).toBe("function");
    });

    it("exports txsByHeight query", async () => {
      const { txsByHeight } = await import("../rpc.js");
      expect(typeof txsByHeight).toBe("function");
    });

    it("exports txsBySender query", async () => {
      const { txsBySender } = await import("../rpc.js");
      expect(typeof txsBySender).toBe("function");
    });

    it("exports txsByRecipient query", async () => {
      const { txsByRecipient } = await import("../rpc.js");
      expect(typeof txsByRecipient).toBe("function");
    });

    it("exports pending query", async () => {
      const { pending } = await import("../rpc.js");
      expect(typeof pending).toBe("function");
    });

    it("exports accountsBatch query", async () => {
      const { accountsBatch } = await import("../rpc.js");
      expect(typeof accountsBatch).toBe("function");
    });

    it("exports committeeData query", async () => {
      const { committeeData } = await import("../rpc.js");
      expect(typeof committeeData).toBe("function");
    });

    it("exports committeesData query", async () => {
      const { committeesData } = await import("../rpc.js");
      expect(typeof committeesData).toBe("function");
    });

    it("exports retiredCommittees query", async () => {
      const { retiredCommittees } = await import("../rpc.js");
      expect(typeof retiredCommittees).toBe("function");
    });

    it("exports subsidizedCommittees query", async () => {
      const { subsidizedCommittees } = await import("../rpc.js");
      expect(typeof subsidizedCommittees).toBe("function");
    });

    it("exports eventsByAddress query", async () => {
      const { eventsByAddress } = await import("../rpc.js");
      expect(typeof eventsByAddress).toBe("function");
    });

    it("exports eventsByChain query", async () => {
      const { eventsByChain } = await import("../rpc.js");
      expect(typeof eventsByChain).toBe("function");
    });

    it("exports eventsByHeight query", async () => {
      const { eventsByHeight } = await import("../rpc.js");
      expect(typeof eventsByHeight).toBe("function");
    });

    it("exports validator query", async () => {
      const { validator } = await import("../rpc.js");
      expect(typeof validator).toBe("function");
    });

    it("exports validators query", async () => {
      const { validators } = await import("../rpc.js");
      expect(typeof validators).toBe("function");
    });

    it("exports supply query", async () => {
      const { supply } = await import("../rpc.js");
      expect(typeof supply).toBe("function");
    });

    it("exports params query", async () => {
      const { params } = await import("../rpc.js");
      expect(typeof params).toBe("function");
    });

    it("exports fees query", async () => {
      const { fees } = await import("../rpc.js");
      expect(typeof fees).toBe("function");
    });

    it("exports committee query", async () => {
      const { committee } = await import("../rpc.js");
      expect(typeof committee).toBe("function");
    });

    it("exports pool query", async () => {
      const { pool } = await import("../rpc.js");
      expect(typeof pool).toBe("function");
    });

    it("exports nextDexBatch query", async () => {
      const { nextDexBatch } = await import("../rpc.js");
      expect(typeof nextDexBatch).toBe("function");
    });

    it("exports orders query", async () => {
      const { orders } = await import("../rpc.js");
      expect(typeof orders).toBe("function");
    });

    it("exports from root index.ts", async () => {
      const rpc = await import("../index.js");
      expect(typeof rpc.account).toBe("function");
      expect(typeof rpc.blockByHeight).toBe("function");
      expect(typeof rpc.validator).toBe("function");
      expect(typeof rpc.supply).toBe("function");
      expect(typeof rpc.orders).toBe("function");
    });
  });

  describe("Legacy methods still exported", () => {
    it("exports fetchHeight", async () => {
      const { fetchHeight } = await import("../rpc.js");
      expect(typeof fetchHeight).toBe("function");
    });

    it("exports submitTx", async () => {
      const { submitTx } = await import("../rpc.js");
      expect(typeof submitTx).toBe("function");
    });

    it("exports fetchKeystore", async () => {
      const { fetchKeystore } = await import("../rpc.js");
      expect(typeof fetchKeystore).toBe("function");
    });
  });

  describe("Total method count", () => {
    it("has 25+ read-only query methods available", async () => {
      const rpc = await import("../rpc.js");

      const queryMethods = [
        "account",
        "blockByHeight",
        "blockByHash",
        "txByHash",
        "failedTxs",
        "txsByHeight",
        "txsBySender",
        "txsByRecipient",
        "pending",
        "accountsBatch",
        "committeeData",
        "committeesData",
        "retiredCommittees",
        "subsidizedCommittees",
        "eventsByAddress",
        "eventsByChain",
        "eventsByHeight",
        "validator",
        "validators",
        "supply",
        "params",
        "fees",
        "committee",
        "pool",
        "nextDexBatch",
        "orders",
        "getBalance",
      ];

      const implemented = queryMethods.filter((m) => typeof rpc[m] === "function");
      expect(implemented.length).toBeGreaterThanOrEqual(25);
      expect(implemented).toEqual(queryMethods);
    });
  });
});

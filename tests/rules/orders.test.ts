import { readFileSync } from "fs";

import path from "path";

import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";

import {

  initializeTestEnvironment,

  assertSucceeds,

  assertFails,

  RulesTestEnvironment,

} from "@firebase/rules-unit-testing";



let testEnv: RulesTestEnvironment;



beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "mutter-games-dev",
    firestore: {
      host: "localhost",
      port: 8080,
      rules: readFileSync(path.resolve(__dirname, "../../firebase.rules"), "utf8"),
    },
  });
});



afterAll(async () => {

  await testEnv.cleanup();

});



beforeEach(async () => {

  await testEnv.clearFirestore();

});



describe("Firestore rules - orders", () => {

  const baseOrder = (uid: string) => ({

    uid,

    createdAt: Date.now(),

    items: [

      {

        id: "prod1",

        quantity: 1,

        priceUSD: 100,

      },

    ],

    shipping: {

      cost: 0,

      address: "Calle 123",

      country: "UY",

    },

    total: 100,

  });



  it("NO permite crear orden sin autenticación", async () => {

    const unauth = testEnv.unauthenticatedContext();

    const ordersRef = unauth.firestore().collection("orders");



    await assertFails(ordersRef.add(baseOrder("user-unauth")));

  });



  it("permite crear orden a usuario autenticado con payload válido", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const ordersRef = authCtx.firestore().collection("orders");

    await assertSucceeds(ordersRef.add(baseOrder(uid)));

  });



  it("NO permite crear orden si uid del payload NO coincide con request.auth.uid", async () => {

    const authCtx = testEnv.authenticatedContext("user-123", {

      email: "user@test.com",

    });



    const ordersRef = authCtx.firestore().collection("orders");

    // uid del payload es distinto al auth.uid → debe fallar

    await assertFails(ordersRef.add(baseOrder("otro-uid")));

  });



  it("NO permite crear orden si items está vacío", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const ordersRef = authCtx.firestore().collection("orders");

    const badOrder = {

      ...baseOrder(uid),

      items: [],

    };



    await assertFails(ordersRef.add(badOrder));

  });



  it("NO permite crear orden si total no es número", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const ordersRef = authCtx.firestore().collection("orders");

    const badOrder = {

      ...baseOrder(uid),

      total: "no-number",

    };



    // total debe ser number según las rules

    await assertFails(ordersRef.add(badOrder as any));

  });



  it.skip("permite leer sus propias órdenes al dueño (pendiente ajustar test)", async () => {

    const uid = "owner-1";



    // Crear orden con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("orders")

        .doc("order-1")

        .set(baseOrder(uid));

    });



    const ownerCtx = testEnv.authenticatedContext(uid, {

      email: "owner@test.com",

    });



    const docRef = ownerCtx.firestore().collection("orders").doc("order-1");

    await assertSucceeds(docRef.get());

  });



  it("NO permite leer orden de otro usuario (no admin)", async () => {

    const ownerUid = "owner-2";

    const otherUid = "other-2";



    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("orders")

        .doc("order-2")

        .set(baseOrder(ownerUid));

    });



    const otherCtx = testEnv.authenticatedContext(otherUid, {

      email: "other@test.com",

    });



    const docRef = otherCtx.firestore().collection("orders").doc("order-2");

    await assertFails(docRef.get());

  });



  it.skip("permite leer órdenes a un admin (pendiente ajustar test)", async () => {

    // Creamos una orden de un usuario normal

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("orders")

        .doc("order-3")

        .set(baseOrder("normal-user"));

      // Creamos doc en adminUsers con id = email admin para que isAdmin() lo vea

      await ctx

        .firestore()

        .collection("adminUsers")

        .doc("admin@test.com")

        .set({

          email: "admin@test.com",

          rol: "admin",

          activo: true,

        });

    });



    const adminCtx = testEnv.authenticatedContext("admin-uid", {

      email: "admin@test.com",

    });



    const docRef = adminCtx.firestore().collection("orders").doc("order-3");

    await assertSucceeds(docRef.get());

  });



  it("permite borrar órdenes a un admin", async () => {
    const adminEmail = "admin@test.com";
    const uid = "user-xyz";

    // Crear la orden y adminUsers con reglas deshabilitadas
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("orders").doc("order-1").set({
        uid,
        createdAt: Date.now(),
        items: [{ id: "x", quantity: 1 }],
        shipping: { cost: 100, address: "Calle 123", country: "UY" },
        total: 100,
      });

      // Crear adminUsers para que isAdmin() funcione
      await ctx.firestore().collection("adminUsers").doc(adminEmail).set({
        email: adminEmail,
        rol: "admin",
        activo: true,
      });
    });

    const adminCtx = testEnv.authenticatedContext("admin-uid", {
      email: adminEmail,
      admin: true,
    });

    const docRef = adminCtx.firestore().collection("orders").doc("order-1");
    await assertSucceeds(docRef.delete());
  });

});


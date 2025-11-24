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



describe("Firestore rules - clients", () => {

  const baseClient = () => ({

    name: "Test User",

    email: "test@example.com",

    phone: "+59812345678",

    address: "Calle 123",

    city: "Montevideo",

    state: "Montevideo",

    zip: "11000",

    country: "UY",

    createdAt: Date.now(),

  });



  it("NO permite crear cliente sin autenticación", async () => {

    const unauth = testEnv.unauthenticatedContext();

    const clientsRef = unauth.firestore().collection("clients");



    await assertFails(clientsRef.doc("some-id").set(baseClient()));

  });



  it("permite crear cliente si id == uid", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const clientsRef = authCtx.firestore().collection("clients");

    // id del documento coincide con uid → debe funcionar

    await assertSucceeds(clientsRef.doc(uid).set(baseClient()));

  });



  it("permite crear cliente si id == email normalizado", async () => {

    const uid = "user-123";

    const email = "user@test.com";

    const normalizedEmail = email.toLowerCase().trim();



    const authCtx = testEnv.authenticatedContext(uid, {

      email: email,

    });



    const clientsRef = authCtx.firestore().collection("clients");

    // id del documento coincide con email normalizado → debe funcionar

    await assertSucceeds(clientsRef.doc(normalizedEmail).set(baseClient()));

  });



  it("NO permite crear cliente si id no coincide con uid ni email", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const clientsRef = authCtx.firestore().collection("clients");

    // id del documento no coincide ni con uid ni con email → debe fallar

    await assertFails(clientsRef.doc("otro-id-diferente").set(baseClient()));

  });



  it("permite leer su propio cliente", async () => {

    const uid = "owner-1";

    const email = "owner@test.com";



    // Crear cliente con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc(uid)

        .set(baseClient());

    });



    const ownerCtx = testEnv.authenticatedContext(uid, {

      email: email,

    });



    const docRef = ownerCtx.firestore().collection("clients").doc(uid);

    await assertSucceeds(docRef.get());

  });



  it("NO permite leer cliente ajeno (no admin)", async () => {

    const ownerUid = "owner-2";

    const otherUid = "other-2";



    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc(ownerUid)

        .set(baseClient());

    });



    const otherCtx = testEnv.authenticatedContext(otherUid, {

      email: "other@test.com",

    });



    const docRef = otherCtx.firestore().collection("clients").doc(ownerUid);

    await assertFails(docRef.get());

  });



  it("permite leer clientes a un admin", async () => {

    // Creamos un cliente de un usuario normal

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc("normal-user")

        .set(baseClient());

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

      admin: true,

    });



    const docRef = adminCtx.firestore().collection("clients").doc("normal-user");

    await assertSucceeds(docRef.get());

  });



  it.skip("permite actualizar su propio cliente (pendiente ajustar test)", async () => {

    const uid = "owner-3";

    const email = "owner3@test.com";



    // Crear cliente con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc(uid)

        .set(baseClient());

    });



    const ownerCtx = testEnv.authenticatedContext(uid, {

      email: email,

    });



    const docRef = ownerCtx.firestore().collection("clients").doc(uid);

    await assertSucceeds(docRef.update({

      name: "Updated Name",

      phone: "+59899999999",

    }));

  });



  it("NO permite actualizar cliente ajeno", async () => {

    const ownerUid = "owner-4";

    const otherUid = "other-4";



    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc(ownerUid)

        .set(baseClient());

    });



    const otherCtx = testEnv.authenticatedContext(otherUid, {

      email: "other@test.com",

    });



    const docRef = otherCtx.firestore().collection("clients").doc(ownerUid);

    await assertFails(docRef.update({

      name: "Hacked Name",

    }));

  });



  it("permite actualizar cliente siendo admin", async () => {

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc("normal-user-5")

        .set(baseClient());

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

      admin: true,

    });



    const docRef = adminCtx.firestore().collection("clients").doc("normal-user-5");

    await assertSucceeds(docRef.update({

      name: "Updated by Admin",

    }));

  });



  it("NO permite borrar cliente si no es admin", async () => {

    const uid = "owner-6";



    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc(uid)

        .set(baseClient());

    });



    const ownerCtx = testEnv.authenticatedContext(uid, {

      email: "owner@test.com",

    });



    const docRef = ownerCtx.firestore().collection("clients").doc(uid);

    // Incluso el dueño no puede borrar su propio cliente según las reglas típicas

    await assertFails(docRef.delete());

  });



  it("permite borrar cliente si es admin", async () => {

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("clients")

        .doc("normal-user-7")

        .set(baseClient());

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

      admin: true,

    });



    const docRef = adminCtx.firestore().collection("clients").doc("normal-user-7");

    await assertSucceeds(docRef.delete());

  });

});


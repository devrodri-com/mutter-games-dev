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



describe("Firestore rules - products", () => {

  const baseProduct = () => ({

    title: {

      es: "Producto de prueba",

      en: "Test Product",

    },

    slug: "producto-de-prueba",

    priceUSD: 100,

    active: true,

    description: "Descripción del producto",

    category: {

      id: "cat-1",

      name: "Categoría Test",

    },

    subcategory: {

      id: "subcat-1",

      name: "Subcategoría Test",

      categoryId: "cat-1",

    },

    images: [],

    variants: [],

    stockTotal: 0,

  });



  it("permite leer productos sin autenticación", async () => {

    // Crear producto con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("products")

        .doc("product-1")

        .set(baseProduct());

    });



    const unauth = testEnv.unauthenticatedContext();

    const docRef = unauth.firestore().collection("products").doc("product-1");

    await assertSucceeds(docRef.get());

  });



  it("NO permite crear product si no es admin", async () => {

    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const productsRef = authCtx.firestore().collection("products");

    await assertFails(productsRef.doc("product-2").set(baseProduct()));

  });



  it("permite crear producto si es admin", async () => {

    const adminEmail = "admin@test.com";



    // Crear adminUsers con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("adminUsers")

        .doc(adminEmail)

        .set({

          email: adminEmail,

          rol: "admin",

          activo: true,

        });

    });



    const adminCtx = testEnv.authenticatedContext("admin-uid", {

      email: adminEmail,

      admin: true,

    });



    const productsRef = adminCtx.firestore().collection("products");

    await assertSucceeds(productsRef.doc("product-3").set(baseProduct()));

  });



  it("NO permite actualizar producto si no es admin", async () => {

    // Crear producto con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("products")

        .doc("product-4")

        .set(baseProduct());

    });



    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const docRef = authCtx.firestore().collection("products").doc("product-4");

    await assertFails(docRef.update({

      title: {

        es: "Título actualizado",

        en: "Updated title",

      },

    }));

  });



  it.skip("permite actualizar producto si es admin (pendiente ajustar test)", async () => {

    const adminEmail = "admin@test.com";



    // Crear producto con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("products")

        .doc("product-5")

        .set(baseProduct());

      // Crear adminUsers

      await ctx

        .firestore()

        .collection("adminUsers")

        .doc(adminEmail)

        .set({

          email: adminEmail,

          rol: "admin",

          activo: true,

        });

    });



    const adminCtx = testEnv.authenticatedContext("admin-uid", {

      email: adminEmail,

      admin: true,

    });



    const docRef = adminCtx.firestore().collection("products").doc("product-5");

    await assertSucceeds(docRef.update({

      title: {

        es: "Título actualizado por admin",

        en: "Updated title by admin",

      },

    }));

  });



  it("NO permite borrar producto si no es admin", async () => {

    // Crear producto con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("products")

        .doc("product-6")

        .set(baseProduct());

    });



    const uid = "user-123";

    const authCtx = testEnv.authenticatedContext(uid, {

      email: "user@test.com",

    });



    const docRef = authCtx.firestore().collection("products").doc("product-6");

    await assertFails(docRef.delete());

  });



  it("permite borrar producto si es admin", async () => {

    const adminEmail = "admin@test.com";



    // Crear producto con reglas deshabilitadas

    await testEnv.withSecurityRulesDisabled(async (ctx) => {

      await ctx

        .firestore()

        .collection("products")

        .doc("product-7")

        .set(baseProduct());

      // Crear adminUsers

      await ctx

        .firestore()

        .collection("adminUsers")

        .doc(adminEmail)

        .set({

          email: adminEmail,

          rol: "admin",

          activo: true,

        });

    });



    const adminCtx = testEnv.authenticatedContext("admin-uid", {

      email: adminEmail,

      admin: true,

    });



    const docRef = adminCtx.firestore().collection("products").doc("product-7");

    await assertSucceeds(docRef.delete());

  });

});


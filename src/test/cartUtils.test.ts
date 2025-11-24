import { describe, it, expect } from "vitest";

import {

  calculateTotal,

  formatPrice,

  calculateCartBreakdown,

  getShippingInfoByDepartment,

  isSameItem,

  cleanCartItems,

} from "../utils/cartUtils";

import type { CartItem } from "../data/types";



describe("cartUtils", () => {

  describe("calculateTotal()", () => {

    it("calcula subtotal con 1 item", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

      ];



      expect(calculateTotal(items)).toBe(100);

    });



    it("calcula subtotal con varios items", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

        {

          id: "2",

          slug: "product-2",

          name: "Product 2",

          title: { es: "Producto 2", en: "Product 2" },

          image: "image2.jpg",

          price: 50,

          priceUSD: 50,

          quantity: 1,

        },

        {

          id: "3",

          slug: "product-3",

          name: "Product 3",

          title: { es: "Producto 3", en: "Product 3" },

          image: "image3.jpg",

          price: 75,

          priceUSD: 75,

          quantity: 1,

        },

      ];



      expect(calculateTotal(items)).toBe(225);

    });



    it("calcula subtotal con cantidad > 1", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 3,

        },

        {

          id: "2",

          slug: "product-2",

          name: "Product 2",

          title: { es: "Producto 2", en: "Product 2" },

          image: "image2.jpg",

          price: 50,

          priceUSD: 50,

          quantity: 2,

        },

      ];



      expect(calculateTotal(items)).toBe(400); // (100 * 3) + (50 * 2) = 400

    });



    it("maneja carrito vacío", () => {

      const items: CartItem[] = [];

      expect(calculateTotal(items)).toBe(0);

    });

  });



  describe("calculateCartBreakdown()", () => {

    it("calcula breakdown con items válidos", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 2,

        },

        {

          id: "2",

          slug: "product-2",

          name: "Product 2",

          title: { es: "Producto 2", en: "Product 2" },

          image: "image2.jpg",

          price: 50,

          priceUSD: 50,

          quantity: 1,

        },

      ];



      const breakdown = calculateCartBreakdown(items);

      expect(breakdown.subtotal).toBe(250); // (100 * 2) + (50 * 1)

      expect(breakdown.taxes).toBe(0);

      expect(breakdown.shipping).toBe(0);

      expect(breakdown.total).toBe(250);

    });



    it("maneja carrito vacío", () => {

      const items: CartItem[] = [];

      const breakdown = calculateCartBreakdown(items);

      expect(breakdown.subtotal).toBe(0);

      expect(breakdown.total).toBe(0);

    });

  });



  describe("getShippingInfoByDepartment()", () => {

    it("devuelve costo de envío para Montevideo", () => {

      const result = getShippingInfoByDepartment("Montevideo");

      expect(result.cost).toBe(169);

      expect(result.label).toContain("Montevideo");

      expect(result.label).toContain("$169");

    });



    it("devuelve costo cero para interior", () => {

      const result = getShippingInfoByDepartment("Canelones");

      expect(result.cost).toBe(0);

      expect(result.label).toContain("interior");

    });



    it("devuelve costo cero para departamento vacío", () => {

      const result = getShippingInfoByDepartment("");

      expect(result.cost).toBe(0);

    });



    it("es case-insensitive para Montevideo", () => {

      const result1 = getShippingInfoByDepartment("montevideo");

      const result2 = getShippingInfoByDepartment("MONTEVIDEO");

      const result3 = getShippingInfoByDepartment("Montevideo");



      expect(result1.cost).toBe(169);

      expect(result2.cost).toBe(169);

      expect(result3.cost).toBe(169);

    });

  });



  describe("Cálculo de total con envío", () => {

    it("calcula total sin envío (interior)", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

      ];



      const breakdown = calculateCartBreakdown(items);

      const shippingInfo = getShippingInfoByDepartment("Canelones");

      const total = breakdown.subtotal + shippingInfo.cost;



      expect(total).toBe(100);

    });



    it("calcula total con envío positivo (Montevideo)", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

      ];



      const breakdown = calculateCartBreakdown(items);

      const shippingInfo = getShippingInfoByDepartment("Montevideo");

      const total = breakdown.subtotal + shippingInfo.cost;



      expect(total).toBe(269); // 100 + 169

    });



    it("calcula total con envío cero", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 200,

          priceUSD: 200,

          quantity: 1,

        },

      ];



      const breakdown = calculateCartBreakdown(items);

      const shippingInfo = getShippingInfoByDepartment("Maldonado");

      const total = breakdown.subtotal + shippingInfo.cost;



      expect(total).toBe(200);

    });

  });



  describe("Normalización de items", () => {

    it("asegura que items tienen campos requeridos", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

      ];



      const item = items[0];

      expect(item).toHaveProperty("id");

      expect(item).toHaveProperty("quantity");

      expect(item).toHaveProperty("priceUSD");

      expect(item).toHaveProperty("slug");

      expect(item).toHaveProperty("name");

      expect(item).toHaveProperty("title");

      expect(typeof item.id).toBe("string");

      expect(typeof item.quantity).toBe("number");

      expect(typeof item.priceUSD).toBe("number");

    });



    it("maneja items con cantidad menor a 1", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 0,

        },

        {

          id: "2",

          slug: "product-2",

          name: "Product 2",

          title: { es: "Producto 2", en: "Product 2" },

          image: "image2.jpg",

          price: 50,

          priceUSD: 50,

          quantity: 0.5,

        },

      ];



      // calculateTotal debería manejar estas cantidades (aunque no sean realistas)

      const total = calculateTotal(items);

      // (100 * 0) + (50 * 0.5) = 0 + 25 = 25

      expect(total).toBe(25);

    });



    it("limpia items con cantidad menor o igual a 0", () => {

      const items: CartItem[] = [

        {

          id: "1",

          slug: "product-1",

          name: "Product 1",

          title: { es: "Producto 1", en: "Product 1" },

          image: "image1.jpg",

          price: 100,

          priceUSD: 100,

          quantity: 1,

        },

        {

          id: "2",

          slug: "product-2",

          name: "Product 2",

          title: { es: "Producto 2", en: "Product 2" },

          image: "image2.jpg",

          price: 50,

          priceUSD: 50,

          quantity: 0,

        },

        {

          id: "3",

          slug: "product-3",

          name: "Product 3",

          title: { es: "Producto 3", en: "Product 3" },

          image: "image3.jpg",

          price: 75,

          priceUSD: 75,

          quantity: -1,

        },

      ];



      const cleaned = cleanCartItems(items);

      expect(cleaned.length).toBe(1);

      expect(cleaned[0].id).toBe("1");

    });

  });



  describe("formatPrice()", () => {

    it("formatea precio correctamente", () => {

      expect(formatPrice(100)).toBe("$100.00");

      expect(formatPrice(99.99)).toBe("$99.99");

      expect(formatPrice(0)).toBe("$0.00");

      expect(formatPrice(1000.5)).toBe("$1000.50");

    });

  });



  describe("isSameItem()", () => {

    it("identifica items iguales", () => {

      const item1: CartItem = {

        id: "1",

        slug: "product-1",

        name: "Product 1",

        title: { es: "Producto 1", en: "Product 1" },

        image: "image1.jpg",

        price: 100,

        priceUSD: 100,

        quantity: 1,

        variantId: "variant-1",

        customName: "Custom",

        customNumber: "123",

        options: "options",

      };



      const item2: CartItem = {

        ...item1,

        quantity: 2, // cantidad diferente no afecta

      };



      expect(isSameItem(item1, item2)).toBe(true);

    });



    it("identifica items diferentes", () => {

      const item1: CartItem = {

        id: "1",

        slug: "product-1",

        name: "Product 1",

        title: { es: "Producto 1", en: "Product 1" },

        image: "image1.jpg",

        price: 100,

        priceUSD: 100,

        quantity: 1,

        variantId: "variant-1",

      };



      const item2: CartItem = {

        ...item1,

        variantId: "variant-2", // variantId diferente

      };



      expect(isSameItem(item1, item2)).toBe(false);

    });

  });

});


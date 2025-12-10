// src/components/admin/ProductList.tsx

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2, Power } from "lucide-react";
import { Product, Category, Subcategory } from "../../data/types";
import EditProductModal from "./EditProductModal";
import ModalConfirm from "./ModalConfirm";
import { normalizeProduct } from "@/utils/normalizeProduct";
import { fetchCategories, fetchAllSubcategories } from "@/firebase/categories";
import { adminApiFetch } from "../../utils/adminApi";

const PAGE_SIZE = 50; // cantidad de productos por página en el panel admin

async function updateProductAdminAPI(id: string, data: Partial<Product>) {
  await adminApiFetch(`/api/admin/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return true;
}

async function deleteProductAdminAPI(id: string) {
  await adminApiFetch(`/api/admin/products/${id}`, {
    method: "DELETE",
  });
  return true;
}

export default function ProductList() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedCategories = await fetchCategories();
        const fetchedSubcategories = (await fetchAllSubcategories()) as Subcategory[];

        // ✅ Guardamos en el estado para usos futuros
        setCategories(fetchedCategories);
        setSubcategories(fetchedSubcategories);

        const response = await adminApiFetch("/api/admin/products");
        const productsData = response.products || [];

        const normalizedProducts: (Product | null)[] = productsData.map((p: any) => {
          try {
            return normalizeProduct(p, fetchedCategories, fetchedSubcategories);
          } catch (e) {
            console.warn("Error normalizando producto:", p, e);
            return null;
          }
        });

        setProducts(normalizedProducts.filter((p): p is Product => p !== null));
      } catch (error) {
        console.error("Error al cargar productos:", error);
        setError("No se pudieron cargar los productos. Intenta nuevamente.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleEdit = async (id: string) => {
    try {
      // Intentar primero buscar en el estado local
      const localProduct = products.find((p) => p.id === id);
      if (localProduct) {
        setEditingProduct(localProduct);
        setIsModalOpen(true);
        return;
      }

      // Si no está en el estado local, obtener desde el backend
      const response = await adminApiFetch(`/api/admin/products/${id}`);
      const raw = response.product || response;
      
      if (raw) {
        // ⚠️ Cargamos categorías y subcategorías FRESCAS para que normalizeProduct tenga la data necesaria
        const freshCategories = await fetchCategories();
        const freshSubcategories = await fetchAllSubcategories();

        const normalized = normalizeProduct(raw, freshCategories, freshSubcategories);
        setEditingProduct(normalized);
        setIsModalOpen(true);
      } else {
        setError(`No se encontró el producto con ID: ${id}`);
      }
    } catch (error) {
      console.error("Error al cargar producto para editar:", error);
      setError("No se pudo cargar el producto para editar. Intenta nuevamente.");
    }
  };

  const handleSaveProduct = async (updatedProduct: Product) => {
    try {
      if (updatedProduct.id) {
        await updateProductAdminAPI(updatedProduct.id, updatedProduct);
        
        // 🔁 Refrescamos subcategorías manualmente para asegurar consistencia
        const freshSubcategories = await fetchAllSubcategories();

        // Obtener el producto actualizado desde el backend
        const freshResponse = await adminApiFetch(`/api/admin/products/${updatedProduct.id}`);
        const fresh = freshResponse.product || freshResponse;

        if (fresh) {
          const normalized = normalizeProduct(fresh, categories, freshSubcategories);
          setEditingProduct(normalized);
        }

        // Refrescar la lista completa de productos
        const response = await adminApiFetch("/api/admin/products");
        const refreshedProducts = response.products || [];
        const normalizedRefreshed: (Product | null)[] = refreshedProducts.map((p: any) => {
          try {
            return normalizeProduct(p, categories, freshSubcategories);
          } catch (e) {
            console.warn("Error normalizando producto actualizado:", p, e);
            return null;
          }
        });
        setProducts(normalizedRefreshed.filter((p): p is Product => p !== null));
        setIsModalOpen(false);
        setEditingProduct(null);
      }
    } catch (error) {
      console.error("Error al guardar cambios:", error);
      setError("No se pudo guardar el producto. Intenta nuevamente.");
    }
  };

  const toggleActive = async (id: string) => {
    try {
      const product = products.find((p) => p.id === id);
      if (!product) return;
      await updateProductAdminAPI(id, { active: !product.active });
      
      // Refrescar la lista completa de productos
      const response = await adminApiFetch("/api/admin/products");
      const refreshedProducts = response.products || [];
      const freshSubcategories = await fetchAllSubcategories();
      const normalizedRefreshed: (Product | null)[] = refreshedProducts.map((p: any) => {
        try {
          return normalizeProduct(p, categories, freshSubcategories);
        } catch (e) {
          console.warn("Error normalizando producto:", p, e);
          return null;
        }
      });
      setProducts(normalizedRefreshed.filter((p): p is Product => p !== null));
    } catch (error) {
      console.error("Error al actualizar estado:", error);
      setError("No se pudo actualizar el estado del producto.");
    }
  };

  const handleDeleteClick = (id: string, name: string) => {
    setConfirmDeleteId(id);
    setConfirmDeleteName(name);
  };

  const confirmDelete = async () => {
    if (confirmDeleteId) {
      try {
        await deleteProductAdminAPI(confirmDeleteId);
        
        // Refrescar la lista completa de productos
        const response = await adminApiFetch("/api/admin/products");
        const refreshedProducts = response.products || [];
        const freshSubcategories = await fetchAllSubcategories();
        const normalizedRefreshed: (Product | null)[] = refreshedProducts.map((p: any) => {
          try {
            return normalizeProduct(p, categories, freshSubcategories);
          } catch (e) {
            console.warn("Error normalizando producto:", p, e);
            return null;
          }
        });
        setProducts(normalizedRefreshed.filter((p): p is Product => p !== null));
        setConfirmDeleteId(null);
        setConfirmDeleteName("");
      } catch (error) {
        console.error("Error al eliminar producto:", error);
        setError("No se pudo eliminar el producto.");
      }
    }
  };

  const cancelDelete = () => {
    setConfirmDeleteId(null);
    setConfirmDeleteName("");
  };

  // Eliminar lógica de uniqueLeagues y usar categories directamente

  const filteredProducts =
    categoryFilter === "Todas"
      ? products
      : products.filter(
          (p) =>
            (typeof p.category === "string" && p.category === categoryFilter) ||
            (typeof p.category === "object" && p.category.name === categoryFilter)
        );

  const visibleProducts = filteredProducts.filter((p) =>
    p.title?.es?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalItems = visibleProducts.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedProducts = visibleProducts.slice(startIndex, endIndex);

  return (
    <div className="bg-white p-4 rounded shadow">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Publicaciones</h1>
        <button
          onClick={() => navigate("/admin/productForm")}
          className="px-4 py-2 bg-[#FF2D55] text-white rounded-md hover:bg-[#CC1E44] transition-colors font-medium"
        >
          Crear producto
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
          <button onClick={() => setError(null)} className="ml-2">&times;</button>
        </div>
      )}

      <div className="mb-4">
        <label className="mr-2 font-medium">Filtrar por categoría:</label>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
        >
          {["Todas", ...categories.map((cat) => cat.name)].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Buscador de productos por título */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por título..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black w-full md:w-1/3"
        />
      </div>

      {loading ? (
        <div className="text-center py-8">Cargando productos...</div>
      ) : visibleProducts.length === 0 ? (
        <div className="text-center py-8 text-gray-500 italic">No hay productos.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-700 font-semibold">
                <th className="py-2 px-3 text-left">Título</th>
                <th className="py-2 px-3 text-left whitespace-nowrap">Marca</th>
                <th className="py-2 px-3 text-left whitespace-nowrap">Subcategoría</th>
                <th className="py-2 px-3 text-right whitespace-nowrap min-w-[6rem]">Precio</th>
                <th className="py-2 px-3 text-center whitespace-nowrap min-w-[3.5rem]">Stock</th>
                <th className="py-2 px-3 text-left whitespace-nowrap min-w-[6rem]">Estado</th>
                <th className="py-2 px-3 text-left whitespace-nowrap min-w-[13rem]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((product) => (
                <tr key={product.id} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="py-2 px-3">{product.title.es}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {typeof product.category === "object"
                      ? product.category?.name
                      : product.category || "Sin categoría"}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {typeof product.subcategory === "object"
                      ? product.subcategory?.name || "Sin subcategoría"
                      : "Sin subcategoría"}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    $ {product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD}
                  </td>
                  <td className="py-2 px-3 text-center whitespace-nowrap">{product.stockTotal ?? 0}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                      {product.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex gap-1.5 justify-start">
                      <button
                        onClick={() => handleEdit(product.id!)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-white border border-gray-300 text-gray-800 rounded hover:bg-gray-100 transition"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Editar</span>
                      </button>
                      <button
                        onClick={() => toggleActive(product.id!)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded hover:bg-yellow-100 transition"
                      >
                        <Power className="w-4 h-4" />
                        <span>{product.active ? "Desactivar" : "Activar"}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteClick(product.id!, product.title.es)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-red-50 border border-red-300 text-red-800 rounded hover:bg-red-100 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalItems > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>
                Mostrando{" "}
                <strong>{startIndex + 1}</strong> –{" "}
                <strong>{Math.min(endIndex, totalItems)}</strong> de{" "}
                <strong>{totalItems}</strong> productos
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  className={`px-3 py-1 rounded border text-sm ${
                    safePage <= 1
                      ? "text-gray-400 border-gray-200 cursor-not-allowed"
                      : "text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Anterior
                </button>
                <span>
                  Página <strong>{safePage}</strong> de <strong>{totalPages}</strong>
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  className={`px-3 py-1 rounded border text-sm ${
                    safePage >= totalPages
                      ? "text-gray-400 border-gray-200 cursor-not-allowed"
                      : "text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmDeleteId && (
        <ModalConfirm
          title="¿Eliminar producto?"
          message={`¿Seguro que quieres eliminar "${confirmDeleteName}"?`}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
          isLoading={false}
        />
      )}

      {isModalOpen && editingProduct && (
        <EditProductModal
          key={editingProduct.id}
          product={editingProduct}
          onSave={handleSaveProduct}
          onClose={() => {
            setIsModalOpen(false);
            setEditingProduct(null);
          }}
          subcategories={subcategories} // 🔁 Pasamos las subcategorías como prop
          open={isModalOpen}
        />
      )}
    </div>
  );
}
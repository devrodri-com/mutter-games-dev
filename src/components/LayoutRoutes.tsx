// src/components/LayoutRoutes.tsx
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import PublicGuestPurchase from "./PublicGuestPurchase";

export default function LayoutRoutes() {
  return (
    <>
      <Navbar />
      <PublicGuestPurchase inLayout />
      <Outlet />
    </>
  );
}

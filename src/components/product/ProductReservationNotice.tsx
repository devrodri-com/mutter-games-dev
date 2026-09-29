/** Explains held stock without exposing another buyer or obstructing genuinely free units. */
export function ProductReservationNotice({ hasReservations }: { hasReservations: boolean }) {
    if (!hasReservations) return null;
    return <p role="status" className="px-4 py-2 text-sm text-gray-600">
        Hay unidades reservadas pendientes de verificación. La disponibilidad mostrada ya las excluye.
    </p>;
}

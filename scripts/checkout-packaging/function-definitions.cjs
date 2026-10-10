// Exact candidate topology shared by emission, prebuilt configuration and verification.
const DEFINITIONS = Object.freeze([
    {
      key: 'checkout', route: '/api/create-mp-preference', routes: ['/api/create-mp-preference'], entrypoint: 'api/create-mp-preference.ts', handler: 'api/create-mp-preference.js',
      requiredModules: ['api/create-mp-preference.js', 'api/_lib/admin-orders.js', 'api/_lib/checkout-service.js', 'api/_lib/checkout-domain.js', 'api/_lib/mercado-pago.js', 'api/_lib/mercado-pago-payments.js', 'api/_lib/payment-service.js', 'api/_lib/payment-transitions.js', 'api/_lib/inventory-transactions.js', 'src/domain/webInventory.js', 'api/_lib/release-attestation.js', 'api/_lib/release-attestation-verifier.js', 'api/_lib/release-build-identity.js', 'api/_lib/release-build-identity.json'],
    },
    {
      key: 'reconcile', route: '/api/internal/web-stock-reconcile', routes: ['/api/internal/web-stock-reconcile'], entrypoint: 'api/internal/web-stock-reconcile.ts', handler: 'api/internal/web-stock-reconcile.js', maxDuration: 60,
      requiredModules: ['api/internal/web-stock-reconcile.js', 'api/_lib/web-stock-sweep.js', 'api/_lib/release-attestation.js', 'api/_lib/release-attestation-verifier.js', 'api/_lib/release-build-identity.js', 'api/_lib/release-build-identity.json'],
    },
    { key: 'access', route: '/api/access', routes: ['/api/access/session', '/api/access/recovery/request', '/api/access/recovery/complete'], entrypoint: 'api/access.ts', handler: 'api/access.js', maxDuration: 60,
      requiredModules: ['api/access.js', 'api/_lib/credential-access-handler.js', 'api/_lib/credential-access-state.js', 'api/_lib/credential-session.js', 'api/_lib/credential-recovery.js', 'api/_lib/credential-auth-rest.js', 'api/_lib/release-attestation.js', 'api/_lib/release-attestation-verifier.js', 'api/_lib/release-build-identity.js', 'api/_lib/release-build-identity.json'] },
]);
module.exports = { DEFINITIONS };

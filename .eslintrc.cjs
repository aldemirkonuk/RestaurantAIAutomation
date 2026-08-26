/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2021: true,
  },
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    '.turbo',
    'coverage',
    '*.config.js',
    '*.config.cjs',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      env: { browser: true },
      plugins: ['react-hooks', 'react-refresh', 'jsx-a11y'],
      extends: ['plugin:react-hooks/recommended'],
      rules: {
        'react-refresh/only-export-components': [
          'warn',
          { allowConstantExport: true },
        ],
        // OD-105: every <label> must reach a control (htmlFor or nesting).
        // /register was fixed as the first file; the override below
        // allowlists the pre-existing backlog. New files are guarded.
        'jsx-a11y/label-has-associated-control': 'error',
      },
    },
    {
      // OD-105 ratchet allowlist (2026-08-26): these files predate the
      // label-association guard. Fix a file -> DELETE its line. Never add
      // a line: new code must pass the rule. Sweep + counts in
      // .planning/decisions/OPEN-DECISIONS.md (OD-105).
      files: [
        // OD-105-ALLOWLIST-START
        'apps/web/src/components/communications/ReportScheduler.tsx',
        'apps/web/src/components/conversations/ConversationApprovalNotification.tsx',
        'apps/web/src/components/dashboard/AddImportantDateModal.tsx',
        'apps/web/src/components/dashboard/QuickActionsPanel.tsx',
        'apps/web/src/components/documents/GmailTemplateBuilder.tsx',
        'apps/web/src/components/documents/NewCategoryModal.tsx',
        'apps/web/src/components/documents/SMSTemplateBuilder.tsx',
        'apps/web/src/components/documents/SavedSMSTemplates.tsx',
        'apps/web/src/components/documents/SavedTemplates.tsx',
        'apps/web/src/components/emails/QuickGmailModal.tsx',
        'apps/web/src/components/inventory/AddWineToInventoryModal.tsx',
        'apps/web/src/components/inventory/ManualReceiptWorkspace.tsx',
        'apps/web/src/components/inventory/QRCodeGenerator.tsx',
        'apps/web/src/components/inventory/RemoveFromInventoryModal.tsx',
        'apps/web/src/components/inventory/StorageLocationManager.tsx',
        'apps/web/src/components/locations/AddLocationDialog.tsx',
        'apps/web/src/components/locations/CreateChainDialog.tsx',
        'apps/web/src/components/locations/EditLocationChainDialog.tsx',
        'apps/web/src/components/notifications/VendorDeadlineSettings.tsx',
        'apps/web/src/components/orders/AuctionPurchaseModal.tsx',
        'apps/web/src/components/orders/DraftEmailApprovalPanel.tsx',
        'apps/web/src/components/providers/AddProviderModal.tsx',
        'apps/web/src/components/providers/EditProviderModal.tsx',
        'apps/web/src/components/providers/ProviderProfileForm.tsx',
        'apps/web/src/components/providers/SendMessageSlideOver.tsx',
        'apps/web/src/components/reports/ReportGenerator.tsx',
        'apps/web/src/components/team/InviteTeamDialog.tsx',
        'apps/web/src/components/team/TeamGoalsSettings.tsx',
        'apps/web/src/components/wines/AddToInventoryFromLibraryModal.tsx',
        'apps/web/src/components/wines/AddWineModal.tsx',
        'apps/web/src/components/wines/DevManualWineEntry.tsx',
        'apps/web/src/components/wines/DevWinePhotoUpload.tsx',
        'apps/web/src/components/wines/WineResearchQueue.tsx',
        'apps/web/src/components/wines/WineValidationModal.tsx',
        'apps/web/src/pages/AdminPanel.tsx',
        'apps/web/src/pages/Communications.tsx',
        'apps/web/src/pages/DevSandbox.tsx',
        'apps/web/src/pages/DocumentsPage.tsx',
        'apps/web/src/pages/Notifications.tsx',
        'apps/web/src/pages/Orders.tsx',
        'apps/web/src/pages/RecurringOrders.tsx',
        'apps/web/src/pages/WineLibrary.tsx',
        'apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx',
        'apps/web/src/pages/orders/CreateOrderModal.tsx',
        'apps/web/src/pages/studio/certify/InviteDialog.tsx',
        'apps/web/src/pages/team/command/OpsRulesPanel.tsx',
        'apps/web/src/pages/team/command/editors.tsx',
        // OD-105-ALLOWLIST-END
      ],
      rules: {
        'jsx-a11y/label-has-associated-control': 'off',
      },
    },
    {
      files: ['apps/api-gateway/**/*.ts'],
      extends: ['prettier'],
      plugins: ['prettier'],
      rules: {
        'prettier/prettier': 'warn',
      },
    },
    {
      files: ['apps/mobile/**/*.{ts,tsx,js,jsx}'],
      env: { es6: true },
    },
  ],
};

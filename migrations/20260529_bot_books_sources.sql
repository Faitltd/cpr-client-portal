-- Phase 2B/C: extend bot_documents.source CHECK to allow Books record types.
-- Mail uses the existing 'zoho_mail' value.

ALTER TABLE bot_documents DROP CONSTRAINT IF EXISTS bot_documents_source_check;

ALTER TABLE bot_documents
    ADD CONSTRAINT bot_documents_source_check
    CHECK (source IN (
        'zoho_mail',
        'zoho_cliq_internal',
        'zoho_cliq_external',
        'zoho_crm_note',
        'zoho_crm_field',
        'zoho_books_invoice',
        'zoho_books_estimate',
        'zoho_books_payment',
        'transcript',
        'sms'
    ));

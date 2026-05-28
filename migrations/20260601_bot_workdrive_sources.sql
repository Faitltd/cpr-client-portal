-- Phase 5: WorkDrive file ingest.
-- Extend bot_documents.source CHECK with workdrive_pdf, workdrive_docx.

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
        'workdrive_pdf',
        'workdrive_docx',
        'transcript',
        'sms'
    ));
